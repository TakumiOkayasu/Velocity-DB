#pragma once

#include <string>
#include <vector>
#include <memory>
#include <Windows.h>
#include <sql.h>
#include <sqlext.h>

namespace predategrip {

struct ColumnInfo {
    std::string name;
    std::string type;
    int size;
    bool nullable;
    bool isPrimaryKey;
};

struct ResultRow {
    std::vector<std::string> values;
};

struct ResultSet {
    std::vector<ColumnInfo> columns;
    std::vector<ResultRow> rows;
    int64_t affectedRows;
    double executionTimeMs;
};

class SQLServerDriver {
public:
    SQLServerDriver();
    ~SQLServerDriver();

    SQLServerDriver(const SQLServerDriver&) = delete;
    SQLServerDriver& operator=(const SQLServerDriver&) = delete;

    bool connect(const std::string& connectionString);
    void disconnect();
    bool isConnected() const;

    ResultSet execute(const std::string& sql);
    void cancel();

    std::string getLastError() const;

private:
    void checkError(SQLRETURN ret, SQLSMALLINT handleType, SQLHANDLE handle);

    SQLHENV m_env = SQL_NULL_HENV;
    SQLHDBC m_dbc = SQL_NULL_HDBC;
    SQLHSTMT m_stmt = SQL_NULL_HSTMT;
    bool m_connected = false;
    std::string m_lastError;
};

}  // namespace predategrip
