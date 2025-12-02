#include "sqlserver_driver.h"
#include <chrono>
#include <stdexcept>

namespace predategrip {

SQLServerDriver::SQLServerDriver() {
    SQLRETURN ret = SQLAllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &m_env);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) {
        throw std::runtime_error("Failed to allocate ODBC environment handle");
    }

    ret = SQLSetEnvAttr(m_env, SQL_ATTR_ODBC_VERSION, (SQLPOINTER)SQL_OV_ODBC3, 0);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) {
        SQLFreeHandle(SQL_HANDLE_ENV, m_env);
        throw std::runtime_error("Failed to set ODBC version");
    }

    ret = SQLAllocHandle(SQL_HANDLE_DBC, m_env, &m_dbc);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) {
        SQLFreeHandle(SQL_HANDLE_ENV, m_env);
        throw std::runtime_error("Failed to allocate ODBC connection handle");
    }
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

bool SQLServerDriver::connect(const std::string& connectionString) {
    if (m_connected) {
        disconnect();
    }

    SQLCHAR outConnectionString[1024];
    SQLSMALLINT outConnectionStringLen;

    SQLRETURN ret = SQLDriverConnectA(
        m_dbc,
        nullptr,
        (SQLCHAR*)connectionString.c_str(),
        SQL_NTS,
        outConnectionString,
        sizeof(outConnectionString),
        &outConnectionStringLen,
        SQL_DRIVER_NOPROMPT
    );

    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) {
        checkError(ret, SQL_HANDLE_DBC, m_dbc);
        return false;
    }

    m_connected = true;
    return true;
}

void SQLServerDriver::disconnect() {
    if (m_stmt != SQL_NULL_HSTMT) {
        SQLFreeHandle(SQL_HANDLE_STMT, m_stmt);
        m_stmt = SQL_NULL_HSTMT;
    }
    if (m_connected) {
        SQLDisconnect(m_dbc);
        m_connected = false;
    }
}

bool SQLServerDriver::isConnected() const {
    return m_connected;
}

ResultSet SQLServerDriver::execute(const std::string& sql) {
    ResultSet result;

    if (!m_connected) {
        throw std::runtime_error("Not connected to database");
    }

    auto startTime = std::chrono::high_resolution_clock::now();

    if (m_stmt != SQL_NULL_HSTMT) {
        SQLFreeHandle(SQL_HANDLE_STMT, m_stmt);
    }

    SQLRETURN ret = SQLAllocHandle(SQL_HANDLE_STMT, m_dbc, &m_stmt);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) {
        checkError(ret, SQL_HANDLE_DBC, m_dbc);
        throw std::runtime_error(m_lastError);
    }

    ret = SQLExecDirectA(m_stmt, (SQLCHAR*)sql.c_str(), SQL_NTS);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO && ret != SQL_NO_DATA) {
        checkError(ret, SQL_HANDLE_STMT, m_stmt);
        throw std::runtime_error(m_lastError);
    }

    // Get column info
    SQLSMALLINT numCols;
    SQLNumResultCols(m_stmt, &numCols);

    for (SQLSMALLINT i = 1; i <= numCols; i++) {
        SQLCHAR colName[256];
        SQLSMALLINT colNameLen;
        SQLSMALLINT dataType;
        SQLULEN colSize;
        SQLSMALLINT decimalDigits;
        SQLSMALLINT nullable;

        SQLDescribeColA(m_stmt, i, colName, sizeof(colName), &colNameLen,
                       &dataType, &colSize, &decimalDigits, &nullable);

        ColumnInfo col;
        col.name = std::string((char*)colName, colNameLen);
        col.size = static_cast<int>(colSize);
        col.nullable = (nullable == SQL_NULLABLE);
        col.isPrimaryKey = false;

        // Map SQL type to string
        switch (dataType) {
            case SQL_CHAR:
            case SQL_VARCHAR:
            case SQL_LONGVARCHAR:
                col.type = "VARCHAR";
                break;
            case SQL_WCHAR:
            case SQL_WVARCHAR:
            case SQL_WLONGVARCHAR:
                col.type = "NVARCHAR";
                break;
            case SQL_INTEGER:
                col.type = "INT";
                break;
            case SQL_BIGINT:
                col.type = "BIGINT";
                break;
            case SQL_SMALLINT:
                col.type = "SMALLINT";
                break;
            case SQL_FLOAT:
            case SQL_DOUBLE:
                col.type = "FLOAT";
                break;
            case SQL_DECIMAL:
            case SQL_NUMERIC:
                col.type = "DECIMAL";
                break;
            case SQL_TYPE_DATE:
                col.type = "DATE";
                break;
            case SQL_TYPE_TIME:
                col.type = "TIME";
                break;
            case SQL_TYPE_TIMESTAMP:
                col.type = "DATETIME";
                break;
            case SQL_BIT:
                col.type = "BIT";
                break;
            default:
                col.type = "UNKNOWN";
                break;
        }

        result.columns.push_back(col);
    }

    // Fetch rows
    SQLCHAR buffer[4096];
    SQLLEN indicator;

    while (SQLFetch(m_stmt) == SQL_SUCCESS) {
        ResultRow row;
        for (SQLSMALLINT i = 1; i <= numCols; i++) {
            ret = SQLGetData(m_stmt, i, SQL_C_CHAR, buffer, sizeof(buffer), &indicator);
            if (indicator == SQL_NULL_DATA) {
                row.values.push_back("");  // NULL represented as empty string
            } else {
                row.values.push_back(std::string((char*)buffer));
            }
        }
        result.rows.push_back(row);
    }

    // Get affected rows count
    SQLLEN rowCount;
    SQLRowCount(m_stmt, &rowCount);
    result.affectedRows = rowCount;

    auto endTime = std::chrono::high_resolution_clock::now();
    auto duration = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime);
    result.executionTimeMs = duration.count() / 1000.0;

    return result;
}

void SQLServerDriver::cancel() {
    if (m_stmt != SQL_NULL_HSTMT) {
        SQLCancel(m_stmt);
    }
}

std::string SQLServerDriver::getLastError() const {
    return m_lastError;
}

void SQLServerDriver::checkError(SQLRETURN ret, SQLSMALLINT handleType, SQLHANDLE handle) {
    if (ret == SQL_SUCCESS || ret == SQL_SUCCESS_WITH_INFO) {
        return;
    }

    SQLCHAR sqlState[6];
    SQLINTEGER nativeError;
    SQLCHAR messageText[1024];
    SQLSMALLINT textLength;

    SQLGetDiagRecA(handleType, handle, 1, sqlState, &nativeError,
                   messageText, sizeof(messageText), &textLength);

    m_lastError = std::string((char*)messageText, textLength);
}

}  // namespace predategrip
