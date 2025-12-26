#pragma once

#include <Windows.h>
#include <sql.h>
#include <sqlext.h>

#include <expected>
#include <string>
#include <string_view>
#include <vector>

namespace predategrip {

struct ColumnInfo {
    std::string name;
    std::string type;
    int size = 0;
    bool nullable = true;
    bool isPrimaryKey = false;
    std::string comment;
};

struct ResultRow {
    std::vector<std::string> values;
};

struct ResultSet {
    std::vector<ColumnInfo> columns;
    std::vector<ResultRow> rows;
    int64_t affectedRows = 0;
    double executionTimeMs = 0.0;
};

class SQLServerDriver {
public:
    SQLServerDriver();
    ~SQLServerDriver();

    SQLServerDriver(const SQLServerDriver&) = delete;
    SQLServerDriver& operator=(const SQLServerDriver&) = delete;
    SQLServerDriver(SQLServerDriver&&) = delete;
    SQLServerDriver& operator=(SQLServerDriver&&) = delete;

    [[nodiscard]] bool connect(std::string_view connectionString);
    void disconnect();
    [[nodiscard]] bool isConnected() const noexcept { return m_connected; }

    [[nodiscard]] ResultSet execute(std::string_view sql);
    void cancel();

    [[nodiscard]] std::string_view getLastError() const noexcept { return m_lastError; }

private:
    void storeODBCDiagnosticMessage(SQLRETURN returnCode, SQLSMALLINT odbcHandleType, SQLHANDLE odbcHandle);
    [[nodiscard]] static std::string convertSQLTypeToDisplayName(SQLSMALLINT dataType);

    SQLHENV m_env = SQL_NULL_HENV;
    SQLHDBC m_dbc = SQL_NULL_HDBC;
    SQLHSTMT m_stmt = SQL_NULL_HSTMT;
    bool m_connected = false;
    std::string m_lastError;
};

}  // namespace predategrip
