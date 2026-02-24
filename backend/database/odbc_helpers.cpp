#include "odbc_helpers.h"

#include <array>
#include <stdexcept>

namespace velocitydb::odbc {

SQLHENV allocateEnvironment() {
    SQLHENV env = SQL_NULL_HENV;
    SQLRETURN ret = SQLAllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &env);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) [[unlikely]] {
        throw std::runtime_error("Failed to allocate ODBC environment handle");
    }

    ret = SQLSetEnvAttr(env, SQL_ATTR_ODBC_VERSION, toSqlPointer(SQL_OV_ODBC3), 0);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) [[unlikely]] {
        SQLFreeHandle(SQL_HANDLE_ENV, env);
        throw std::runtime_error("Failed to set ODBC version");
    }

    return env;
}

SQLHDBC allocateConnection(SQLHENV env) {
    SQLHDBC dbc = SQL_NULL_HDBC;
    SQLRETURN ret = SQLAllocHandle(SQL_HANDLE_DBC, env, &dbc);
    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) [[unlikely]] {
        SQLFreeHandle(SQL_HANDLE_ENV, env);
        throw std::runtime_error("Failed to allocate ODBC connection handle");
    }
    return dbc;
}

void setConnectionTimeout(SQLHDBC dbc, unsigned int timeoutSeconds) {
    auto timeout = static_cast<SQLUINTEGER>(timeoutSeconds);
    SQLSetConnectAttr(dbc, SQL_ATTR_LOGIN_TIMEOUT, toSqlPointer(timeout), 0);
    SQLSetConnectAttr(dbc, SQL_ATTR_CONNECTION_TIMEOUT, toSqlPointer(timeout), 0);
}

bool connectWithString(SQLHDBC dbc, std::string_view connectionString, std::string& outError) {
    std::array<SQLWCHAR, 1024> outConnectionString{};
    SQLSMALLINT outConnectionStringLen = 0;

    auto wideConnStr = utf8ToWide(connectionString);
    SQLRETURN ret = SQLDriverConnectW(dbc, nullptr, toSqlWchar(wideConnStr.data()), SQL_NTS, outConnectionString.data(), static_cast<SQLSMALLINT>(outConnectionString.size()), &outConnectionStringLen,
                                      SQL_DRIVER_NOPROMPT);

    if (ret != SQL_SUCCESS && ret != SQL_SUCCESS_WITH_INFO) [[unlikely]] {
        outError = getDiagnosticMessage(ret, SQL_HANDLE_DBC, dbc);
        return false;
    }

    return true;
}

void disconnect(SQLHDBC dbc) {
    SQLDisconnect(dbc);
}

std::string convertSQLTypeToDisplayName(SQLSMALLINT dataType) {
    switch (dataType) {
        case SQL_CHAR:
        case SQL_VARCHAR:
        case SQL_LONGVARCHAR:
            return "VARCHAR";
        case SQL_WCHAR:
        case SQL_WVARCHAR:
        case SQL_WLONGVARCHAR:
            return "NVARCHAR";
        case SQL_INTEGER:
            return "INT";
        case SQL_BIGINT:
            return "BIGINT";
        case SQL_SMALLINT:
            return "SMALLINT";
        case SQL_FLOAT:
        case SQL_DOUBLE:
            return "FLOAT";
        case SQL_DECIMAL:
        case SQL_NUMERIC:
            return "DECIMAL";
        case SQL_TYPE_DATE:
            return "DATE";
        case SQL_TYPE_TIME:
            return "TIME";
        case SQL_TYPE_TIMESTAMP:
            return "DATETIME";
        case SQL_BIT:
            return "BIT";
        default:
            return "UNKNOWN";
    }
}

void cancelStatement(SQLHSTMT stmt) {
    if (stmt != SQL_NULL_HSTMT) {
        SQLCancel(stmt);
    }
}

std::string getDiagnosticMessage(SQLRETURN returnCode, SQLSMALLINT handleType, SQLHANDLE handle) {
    if (returnCode == SQL_SUCCESS || returnCode == SQL_SUCCESS_WITH_INFO) [[likely]] {
        return {};
    }

    std::array<SQLWCHAR, 6> sqlState{};
    SQLINTEGER nativeErrorCode = 0;
    std::array<SQLWCHAR, 1024> diagnosticMessage{};
    SQLSMALLINT messageLength = 0;

    SQLGetDiagRecW(handleType, handle, 1, sqlState.data(), &nativeErrorCode, diagnosticMessage.data(), static_cast<SQLSMALLINT>(diagnosticMessage.size()), &messageLength);

    return sqlWcharToUtf8(diagnosticMessage.data(), messageLength);
}

}  // namespace velocitydb::odbc
