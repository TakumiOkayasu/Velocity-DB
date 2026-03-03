#include "sqlserver_driver.h"

#include "odbc_helpers.h"

#include <algorithm>
#include <array>
#include <chrono>
#include <stdexcept>
#include <vector>

namespace velocitydb {

SQLServerDriver::SQLServerDriver() {
    m_env = odbc::allocateEnvironment();
    m_dbc = odbc::allocateConnection(m_env);
}

SQLServerDriver::~SQLServerDriver() {
    disconnect();
    if (m_dbc != SQL_NULL_HDBC) {
        SQLFreeHandle(SQL_HANDLE_DBC, m_dbc);
    }
    if (m_env != SQL_NULL_HENV) {
        SQLFreeHandle(SQL_HANDLE_ENV, m_env);
    }
}

bool SQLServerDriver::connect(std::string_view connectionString) {
    if (m_connected) {
        disconnect();
    }

    odbc::setConnectionTimeout(m_dbc);

    std::string error;
    if (!odbc::connectWithString(m_dbc, connectionString, error)) {
        std::lock_guard lock(m_executeMutex);
        m_lastError = std::move(error);
        return false;
    }

    m_connected.store(true, std::memory_order_release);
    return true;
}

void SQLServerDriver::disconnect() {
    std::lock_guard lock(m_executeMutex);
    auto stmt = m_stmt.exchange(SQL_NULL_HSTMT, std::memory_order_acq_rel);
    if (stmt != SQL_NULL_HSTMT) {
        SQLFreeHandle(SQL_HANDLE_STMT, stmt);
    }
    if (m_connected.exchange(false, std::memory_order_acq_rel)) {
        odbc::disconnect(m_dbc);
    }
}

ResultSet SQLServerDriver::execute(std::string_view sql) {
    std::lock_guard lock(m_executeMutex);
    ResultSet result;

    if (!m_connected.load(std::memory_order_acquire)) [[unlikely]] {
        throw std::runtime_error("Not connected to database");
    }

    const auto startTime = std::chrono::high_resolution_clock::now();

    auto oldStmt = m_stmt.exchange(SQL_NULL_HSTMT, std::memory_order_acq_rel);
    if (oldStmt != SQL_NULL_HSTMT) {
        SQLFreeHandle(SQL_HANDLE_STMT, oldStmt);
    }

    SQLHSTMT stmt = SQL_NULL_HSTMT;
    SQLRETURN ret = SQLAllocHandle(SQL_HANDLE_STMT, m_dbc, &stmt);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) [[unlikely]] {
        m_stmt.store(SQL_NULL_HSTMT, std::memory_order_release);
        m_lastError = odbc::getDiagnosticMessage(ret, SQL_HANDLE_DBC, m_dbc);
        throw std::runtime_error(m_lastError);
    }

    // Publish new stmt so cancel() can see it immediately
    m_stmt.store(stmt, std::memory_order_release);

    auto queryTimeout = static_cast<SQLULEN>(m_queryTimeout.count());
    SQLSetStmtAttr(stmt, SQL_ATTR_QUERY_TIMEOUT, toSqlPointer(queryTimeout), 0);

    auto wideSql = utf8ToWide(sql);
    ret = SQLExecDirectW(stmt, toSqlWchar(wideSql.data()), SQL_NTS);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO && ret != SQL_NO_DATA) [[unlikely]] {
        m_lastError = odbc::getDiagnosticMessage(ret, SQL_HANDLE_STMT, stmt);
        throw std::runtime_error(m_lastError);
    }

    SQLSMALLINT numCols = 0;
    ret = SQLNumResultCols(stmt, &numCols);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) [[unlikely]] {
        m_lastError = odbc::getDiagnosticMessage(ret, SQL_HANDLE_STMT, stmt);
        throw std::runtime_error(std::string("Failed to get column count: ") + m_lastError);
    }

    result.columns.reserve(static_cast<size_t>(numCols));
    for (SQLSMALLINT i = 1; i <= numCols; ++i) {
        std::array<SQLWCHAR, 256> colName{};
        SQLSMALLINT colNameLen = 0;
        SQLSMALLINT dataType = 0;
        SQLULEN colSize = 0;
        SQLSMALLINT decimalDigits = 0;
        SQLSMALLINT nullable = 0;

        ret = SQLDescribeColW(stmt, i, colName.data(), static_cast<SQLSMALLINT>(colName.size()), &colNameLen, &dataType, &colSize, &decimalDigits, &nullable);
        if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) [[unlikely]] {
            m_lastError = odbc::getDiagnosticMessage(ret, SQL_HANDLE_STMT, stmt);
            throw std::runtime_error(std::string("Failed to describe column: ") + m_lastError);
        }

        colNameLen = (std::min)(colNameLen, static_cast<SQLSMALLINT>(colName.size() - 1));
        auto columnName = sqlWcharToUtf8(colName.data(), static_cast<size_t>(colNameLen));

        if (columnName.empty()) {
            columnName = std::format("Column{}", i);
        }

        result.columns.push_back(
            {.name = columnName, .type = odbc::convertSQLTypeToDisplayName(dataType), .size = static_cast<int>(colSize), .nullable = (nullable == SQL_NULLABLE), .isPrimaryKey = false});
    }

    // Dynamic buffer for large column values
    constexpr size_t INITIAL_BUFFER_CHARS = 4096;
    std::vector<SQLWCHAR> buffer(INITIAL_BUFFER_CHARS);
    SQLLEN indicator = 0;

    while ((ret = SQLFetch(stmt)) == SQL_SUCCESS || ret == SQL_SUCCESS_WITH_INFO) {
        ResultRow row;
        row.values.reserve(static_cast<size_t>(numCols));
        row.nullFlags.reserve(static_cast<size_t>(numCols));

        for (SQLSMALLINT i = 1; i <= numCols; ++i) {
            ret = SQLGetData(stmt, i, SQL_C_WCHAR, buffer.data(), buffer.size() * sizeof(SQLWCHAR), &indicator);
            if (indicator == SQL_NULL_DATA) {
                row.values.emplace_back();
                row.nullFlags.push_back(true);
            } else if (ret == SQL_SUCCESS_WITH_INFO && indicator > static_cast<SQLLEN>((buffer.size() - 1) * sizeof(SQLWCHAR))) {
                size_t requiredChars = (static_cast<size_t>(indicator) / sizeof(SQLWCHAR)) + 1;
                std::vector<SQLWCHAR> largeBuffer(requiredChars);
                size_t alreadyReadChars = buffer.size() - 1;
                std::copy(buffer.begin(), buffer.begin() + static_cast<ptrdiff_t>(alreadyReadChars), largeBuffer.begin());
                SQLLEN remainingIndicator = 0;
                ret = SQLGetData(stmt, i, SQL_C_WCHAR, largeBuffer.data() + alreadyReadChars, (requiredChars - alreadyReadChars) * sizeof(SQLWCHAR), &remainingIndicator);
                size_t strLen = 0;
                for (size_t j = 0; j < largeBuffer.size() && largeBuffer[j] != 0; ++j) {
                    strLen = j + 1;
                }
                row.values.emplace_back(sqlWcharToUtf8(largeBuffer.data(), strLen));
                row.nullFlags.push_back(false);
            } else if (ret == SQL_SUCCESS || ret == SQL_SUCCESS_WITH_INFO) {
                size_t strLen = 0;
                for (size_t j = 0; j < buffer.size() && buffer[j] != 0; ++j) {
                    strLen = j + 1;
                }
                row.values.emplace_back(sqlWcharToUtf8(buffer.data(), strLen));
                row.nullFlags.push_back(false);
            } else {
                row.values.emplace_back();
                row.nullFlags.push_back(true);
            }
        }
        result.rows.push_back(std::move(row));
    }

    SQLLEN rowCount = 0;
    ret = SQLRowCount(stmt, &rowCount);
    if (ret == SQL_SUCCESS || ret == SQL_SUCCESS_WITH_INFO) {
        result.affectedRows = rowCount;
    } else {
        result.affectedRows = 0;
    }

    const auto endTime = std::chrono::high_resolution_clock::now();
    const auto duration = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime);
    result.executionTimeMs = static_cast<double>(duration.count()) / 1000.0;

    return result;
}

void SQLServerDriver::cancel() {
    odbc::cancelStatement(m_stmt.load(std::memory_order_acquire));
}

void SQLServerDriver::setQueryTimeout(std::chrono::seconds timeout) {
    std::lock_guard lock(m_executeMutex);
    m_queryTimeout = timeout;
}

std::chrono::seconds SQLServerDriver::queryTimeout() const noexcept {
    return m_queryTimeout;
}

std::string SQLServerDriver::getLastError() const {
    std::lock_guard lock(m_executeMutex);
    return m_lastError;
}

}  // namespace velocitydb
