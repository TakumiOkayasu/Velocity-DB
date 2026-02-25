#include "postgresql_driver.h"

#include <charconv>
#include <chrono>
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

struct PGresultDeleter {
    void operator()(PGresult* r) const {
        if (r) {
            PQclear(r);
        }
    }
};
using PGresultPtr = std::unique_ptr<PGresult, PGresultDeleter>;

}  // namespace

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

    {
        std::lock_guard lock(m_executeMutex);
        m_conn = conn;
    }
    m_connected.store(true, std::memory_order_release);
    return true;
}

void PostgreSqlDriver::disconnect() {
    std::lock_guard lock(m_executeMutex);
    if (m_connected.exchange(false, std::memory_order_acq_rel)) {
        if (m_conn) {
            PQfinish(m_conn);
            m_conn = nullptr;
        }
    }
}

ResultSet PostgreSqlDriver::execute(std::string_view sql) {
    std::lock_guard lock(m_executeMutex);
    ResultSet result;

    if (!m_connected.load(std::memory_order_acquire)) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    const auto startTime = std::chrono::high_resolution_clock::now();

    PGresultPtr pgResult(PQexec(m_conn, std::string(sql).c_str()));
    if (!pgResult) [[unlikely]] {
        m_lastError = PQerrorMessage(m_conn);
        throw std::runtime_error(m_lastError);
    }

    auto status = PQresultStatus(pgResult.get());
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
            for (int c = 0; c < numCols; ++c) {
                if (PQgetisnull(pgResult.get(), r, c)) {
                    row.values.emplace_back();
                } else {
                    row.values.emplace_back(PQgetvalue(pgResult.get(), r, c));
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

void PostgreSqlDriver::cancel() {
    PGcancel* cancelObj = nullptr;
    {
        std::lock_guard lock(m_executeMutex);
        if (m_conn)
            cancelObj = PQgetCancel(m_conn);
    }
    if (cancelObj) {
        char errbuf[256];
        PQcancel(cancelObj, errbuf, sizeof(errbuf));
        PQfreeCancel(cancelObj);
    }
}

std::string PostgreSqlDriver::getLastError() const {
    std::lock_guard lock(m_executeMutex);
    return m_lastError;
}

}  // namespace velocitydb
