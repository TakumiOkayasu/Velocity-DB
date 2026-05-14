#include "postgresql_driver.h"

#include "copy_from_stdin_handler.h"
#include "pg_result_ptr.h"
#include "profile_gate.h"

#include <charconv>
#include <chrono>
#include <cstring>
#include <format>
#include <stdexcept>
#include <string>

namespace velocitydb {

/// Env var for the [pg-prof] gate. Kept resident so future SELECT-100万行
/// perf regressions can be split into libpq-internal vs driver-loop time
/// without rebuilding (see #579 close: binary protocol was infeasible
/// because libpq fetch alone was 4.7s for the bench fixture, 5x text mode —
/// the split needs to be re-checkable at any time). Lives in a named
/// namespace (external linkage) so it can be passed as a template NTTP to
/// profile::isEnabledOnce without relying on the C++20 P1907 relaxation
/// for internal-linkage pointer NTTPs.
inline constexpr char kPgProfileEnv[] = "VELOCITYDB_PG_PROFILE";

namespace {

/// Convert PostgreSQL OID to human-readable type name. Returns string_view
/// into a static literal for known OIDs (no allocation); the caller copies
/// into ColumnInfo::name only once per column. Unknown OIDs fall back to a
/// formatted std::string returned by oidToTypeNameFallback().
constexpr std::string_view oidToTypeName(Oid oid) noexcept {
    switch (oid) {
        case 16:
            return "boolean";
        case 17:
            return "bytea";
        case 18:
            return "char";
        case 20:
            return "bigint";
        case 21:
            return "smallint";
        case 23:
            return "integer";
        case 25:
            return "text";
        case 26:
            return "oid";
        case 114:
            return "json";
        case 142:
            return "xml";
        case 700:
            return "real";
        case 701:
            return "double precision";
        case 790:
            return "money";
        case 829:
            return "macaddr";
        case 869:
            return "inet";
        case 650:
            return "cidr";
        case 1042:
            return "char";
        case 1043:
            return "varchar";
        case 1082:
            return "date";
        case 1083:
            return "time";
        case 1114:
            return "timestamp";
        case 1184:
            return "timestamptz";
        case 1186:
            return "interval";
        case 1560:
            return "bit";
        case 1562:
            return "varbit";
        case 1700:
            return "numeric";
        case 2950:
            return "uuid";
        case 3802:
            return "jsonb";
        default:
            return {};  // sentinel: caller formats oid(N)
    }
}

}  // namespace

PostgreSqlDriver::PostgreSqlDriver() {
    m_handlers.push_back(std::make_unique<CopyFromStdinHandler>(m_conn));
}

PostgreSqlDriver::~PostgreSqlDriver() {
    disconnect();
}

bool PostgreSqlDriver::connect(std::string_view connectionString) {
    if (m_connected) {
        disconnect();
    }

    auto* conn = PQconnectdb(std::string(connectionString).c_str());
    if (PQstatus(conn) != CONNECTION_OK) {
        std::lock_guard lock(m_executeMutex);
        m_lastError = PQerrorMessage(conn);
        PQfinish(conn);
        return false;
    }

    PQsetClientEncoding(conn, "UTF8");
    auto timeoutSec = m_queryTimeoutSeconds.load(std::memory_order_relaxed);
    auto timeoutCmd = std::format("SET statement_timeout = '{}s'", timeoutSec);
    PQclear(PQexec(conn, timeoutCmd.c_str()));

    m_conn.store(conn, std::memory_order_release);
    m_connected.store(true, std::memory_order_release);
    return true;
}

void PostgreSqlDriver::disconnect() {
    std::lock_guard lock(m_executeMutex);
    if (!m_connected.exchange(false, std::memory_order_acq_rel))
        return;
    /// Hold m_connLifecycleMutex while nulling and PQfinish-ing so that a
    /// concurrent cancel() (which only takes this lifecycle lock) cannot
    /// observe a freed conn.
    std::lock_guard lifecycleLock(m_connLifecycleMutex);
    auto* conn = m_conn.exchange(nullptr, std::memory_order_acq_rel);
    if (conn)
        PQfinish(conn);
}

ResultSet PostgreSqlDriver::execute(std::string_view sql) {
    std::lock_guard lock(m_executeMutex);

    if (!m_connected.load(std::memory_order_acquire)) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    // OCP: handler chain — new protocols require only handler registration.
    // Handlers don't touch m_lastError (no implicit lock contract); the driver
    // catches their exceptions here (including from canHandle) and propagates
    // the message into the mutex-guarded last-error cache before re-throwing.
    // The catch-all branch defends against handlers that throw non-std types
    // so getLastError() never silently retains a stale message.
    for (auto& handler : m_handlers) {
        try {
            if (!handler->canHandle(sql))
                continue;
            return handler->execute(sql);
        } catch (const std::exception& e) {
            m_lastError = e.what();
            throw;
        } catch (...) {
            m_lastError = "Unknown handler error (non-std::exception)";
            throw;
        }
    }

    // Default: standard PQexec() path
    ResultSet result;
    const auto startTime = std::chrono::high_resolution_clock::now();

    auto* conn = m_conn.load(std::memory_order_acquire);
    const auto fetchStart = std::chrono::steady_clock::now();
    PGresultPtr pgResult(PQexec(conn, std::string(sql).c_str()));
    const auto fetchEnd = std::chrono::steady_clock::now();
    if (!pgResult) [[unlikely]] {
        m_lastError = PQerrorMessage(conn);
        throw std::runtime_error(m_lastError);
    }

    auto status = PQresultStatus(pgResult.get());

    // COPY FROM stdin that bypassed CopyFromStdinHandler — abort gracefully
    if (status == PGRES_COPY_IN) [[unlikely]] {
        PQputCopyEnd(conn, "COPY FROM stdin not supported without data block");
        PGresultPtr drain(PQgetResult(conn));
        m_lastError = "COPY FROM stdin requires data block (command + data + \\.)";
        throw std::runtime_error(m_lastError);
    }

    if (status != PGRES_TUPLES_OK && status != PGRES_COMMAND_OK) [[unlikely]] {
        m_lastError = PQresultErrorMessage(pgResult.get());
        if (m_lastError.empty())
            m_lastError = std::format("Query failed with status: {}", PQresStatus(status));
        throw std::runtime_error(m_lastError);
    }

    if (status == PGRES_TUPLES_OK) {
        // Cache raw PGresult* once: avoids repeated unique_ptr::get() in the
        // hot loop (numRows * numCols iterations) and lets the compiler keep
        // the pointer in a register.
        auto* const pg = pgResult.get();
        const int numCols = PQnfields(pg);
        const int numRows = PQntuples(pg);

        result.columns.reserve(static_cast<size_t>(numCols));
        for (int i = 0; i < numCols; ++i) {
            ColumnInfo col;
            col.name = PQfname(pg, i);
            const auto typeName = oidToTypeName(PQftype(pg, i));
            col.type = typeName.empty() ? std::format("oid({})", PQftype(pg, i)) : std::string{typeName};
            const int rawSize = PQfsize(pg, i);
            col.size = (rawSize > 0) ? rawSize : 0;
            col.nullable = true;
            col.isPrimaryKey = false;
            result.columns.push_back(std::move(col));
        }

        const auto loopStart = std::chrono::steady_clock::now();
        result.rows.reserve(static_cast<size_t>(numRows));
        for (int r = 0; r < numRows; ++r) {
            ResultRow row;
            row.values.reserve(static_cast<size_t>(numCols));
            row.nullFlags.reserve(static_cast<size_t>(numCols));
            for (int c = 0; c < numCols; ++c) {
                if (PQgetisnull(pg, r, c)) {
                    row.values.emplace_back();
                    row.nullFlags.push_back(true);
                } else {
                    // string_view directly into libpq's response buffer. The
                    // PGresult is kept alive via result.storage below, so the
                    // view stays valid for the lifetime of the ResultSet.
                    // PQgetlength is O(1) (libpq stores the length in its
                    // tuple table) — no strlen scan over the value.
                    const char* const v = PQgetvalue(pg, r, c);
                    const auto len = static_cast<size_t>(PQgetlength(pg, r, c));
                    row.values.emplace_back(v, len);
                    row.nullFlags.push_back(false);
                }
            }
            result.rows.push_back(std::move(row));
        }
        const auto loopEnd = std::chrono::steady_clock::now();

        if (profile::isEnabledOnce<kPgProfileEnv>()) [[unlikely]] {
            const auto fetchMs = std::chrono::duration_cast<std::chrono::milliseconds>(fetchEnd - fetchStart).count();
            const auto loopMs = std::chrono::duration_cast<std::chrono::milliseconds>(loopEnd - loopStart).count();
            profile::emit("[pg-prof] fetch={}ms loop={}ms rows={} cols={}", fetchMs, loopMs, numRows, numCols);
        }

        result.affectedRows = numRows;

        // Hand PGresult ownership to ResultSet via the type-erased storage
        // slot. PGresultPtr is a unique_ptr; release() transfers raw ownership
        // to the shared_ptr so its custom deleter (PQclear) runs at the right
        // time. ResultSet copies (e.g. result_cache) share this PGresult.
        result.storage = std::shared_ptr<PGresult>(pgResult.release(), &PQclear);
    } else if (status == PGRES_COMMAND_OK) {
        const char* cmdTuples = PQcmdTuples(pgResult.get());
        if (cmdTuples && cmdTuples[0] != '\0') {
            int64_t rows = 0;
            std::from_chars(cmdTuples, cmdTuples + std::strlen(cmdTuples), rows);
            result.affectedRows = rows;
        }
    }

    const auto endTime = std::chrono::high_resolution_clock::now();
    const auto duration = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime);
    result.executionTimeMs = static_cast<double>(duration.count()) / 1000.0;

    return result;
}

void PostgreSqlDriver::setQueryTimeout(std::chrono::seconds timeout) {
    /// Lock encloses BOTH the atomic store and the SET statement_timeout side
    /// effect. Without this pairing, two concurrent setQueryTimeout calls
    /// could interleave such that the cached value reflects one writer while
    /// the live PostgreSQL session reflects the other (last-PQexec wins,
    /// last-store wins, but they need not agree).
    /// The lock also defends against disconnect() racing with the conn load
    /// (PQfinish would otherwise free conn from under us).
    std::lock_guard lock(m_executeMutex);
    BaseDriver::setQueryTimeout(timeout);
    auto* conn = m_conn.load(std::memory_order_acquire);
    if (!conn)
        return;
    auto cmd = std::format("SET statement_timeout = '{}s'", timeout.count());
    PQclear(PQexec(conn, cmd.c_str()));
}

void PostgreSqlDriver::cancel() {
    /// Snapshot a PGcancel under the lifecycle lock so disconnect() cannot
    /// PQfinish() the conn between our load and PQgetCancel(). PQgetCancel
    /// allocates an independent cancel object; once acquired, PQcancel /
    /// PQfreeCancel are safe to call without holding any lock (PQcancel is
    /// documented signal-handler-safe by libpq).
    PGcancel* cancelObj = nullptr;
    {
        std::lock_guard lifecycleLock(m_connLifecycleMutex);
        auto* conn = m_conn.load(std::memory_order_acquire);
        if (!conn)
            return;
        cancelObj = PQgetCancel(conn);
    }
    if (!cancelObj)
        return;
    char errbuf[256];
    PQcancel(cancelObj, errbuf, sizeof(errbuf));
    PQfreeCancel(cancelObj);
}

}  // namespace velocitydb
