#include "postgresql_driver.h"

#include "copy_from_stdin_handler.h"
#include "pg_result_ptr.h"

#include <charconv>
#include <chrono>
#include <cstring>
#include <format>
#include <stdexcept>
#include <string>

namespace velocitydb {

namespace {

/// Convert PostgreSQL OID to human-readable type name.
std::string oidToTypeName(Oid oid) {
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
            return std::format("oid({})", oid);
    }
}

}  // namespace

PostgreSqlDriver::PostgreSqlDriver() {
    m_handlers.push_back(std::make_unique<CopyFromStdinHandler>(m_conn, m_lastError));
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

    // OCP: handler chain — new protocols require only handler registration
    for (auto& handler : m_handlers) {
        if (handler->canHandle(sql))
            return handler->execute(sql);
    }

    // Default: standard PQexec() path
    ResultSet result;
    const auto startTime = std::chrono::high_resolution_clock::now();

    auto* conn = m_conn.load(std::memory_order_acquire);
    PGresultPtr pgResult(PQexec(conn, std::string(sql).c_str()));
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
        int numCols = PQnfields(pgResult.get());
        int numRows = PQntuples(pgResult.get());

        result.columns.reserve(static_cast<size_t>(numCols));
        for (int i = 0; i < numCols; ++i) {
            ColumnInfo col;
            col.name = PQfname(pgResult.get(), i);
            col.type = oidToTypeName(PQftype(pgResult.get(), i));
            int rawSize = PQfsize(pgResult.get(), i);
            col.size = (rawSize > 0) ? rawSize : 0;
            col.nullable = true;
            col.isPrimaryKey = false;
            result.columns.push_back(std::move(col));
        }

        result.rows.reserve(static_cast<size_t>(numRows));
        for (int r = 0; r < numRows; ++r) {
            ResultRow row;
            row.values.reserve(static_cast<size_t>(numCols));
            row.nullFlags.reserve(static_cast<size_t>(numCols));
            for (int c = 0; c < numCols; ++c) {
                if (PQgetisnull(pgResult.get(), r, c)) {
                    row.values.emplace_back();
                    row.nullFlags.push_back(true);
                } else {
                    row.values.emplace_back(PQgetvalue(pgResult.get(), r, c));
                    row.nullFlags.push_back(false);
                }
            }
            result.rows.push_back(std::move(row));
        }

        result.affectedRows = numRows;
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
