#include "odbc_driver_detector.h"

#include <Windows.h>
#include <sql.h>
#include <sqlext.h>

#include <array>
#include <format>

namespace predategrip {

namespace {

// Cache the detected driver to avoid repeated registry lookups
std::string g_cachedDriver;
bool g_driverDetected = false;

bool isDriverAvailable(const std::string& driverName) {
    SQLHENV env = SQL_NULL_HENV;

    if (SQLAllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &env) != SQL_SUCCESS) {
        return false;
    }

    if (SQLSetEnvAttr(env, SQL_ATTR_ODBC_VERSION, reinterpret_cast<SQLPOINTER>(SQL_OV_ODBC3), 0) != SQL_SUCCESS) {
        SQLFreeHandle(SQL_HANDLE_ENV, env);
        return false;
    }

    std::array<SQLCHAR, 256> driverDesc{};
    std::array<SQLCHAR, 256> driverAttr{};
    SQLSMALLINT descLen = 0;
    SQLSMALLINT attrLen = 0;

    SQLUSMALLINT direction = SQL_FETCH_FIRST;
    bool found = false;

    while (SQLDriversA(env, direction, driverDesc.data(), static_cast<SQLSMALLINT>(driverDesc.size()), &descLen, driverAttr.data(), static_cast<SQLSMALLINT>(driverAttr.size()), &attrLen) ==
           SQL_SUCCESS) {
        if (std::string(reinterpret_cast<char*>(driverDesc.data())) == driverName) {
            found = true;
            break;
        }
        direction = SQL_FETCH_NEXT;
    }

    SQLFreeHandle(SQL_HANDLE_ENV, env);
    return found;
}

}  // namespace

std::string detectBestSqlServerDriver() {
    if (g_driverDetected) {
        return g_cachedDriver;
    }

    // Try drivers in order of preference (newest first)
    static const std::array<std::string, 4> drivers = {"ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "ODBC Driver 13 for SQL Server", "SQL Server"};

    for (const auto& driver : drivers) {
        if (isDriverAvailable(driver)) {
            g_cachedDriver = driver;
            g_driverDetected = true;
            return g_cachedDriver;
        }
    }

    // Fallback to generic driver name (may not work)
    g_cachedDriver = "SQL Server";
    g_driverDetected = true;
    return g_cachedDriver;
}

std::string buildDriverConnectionPrefix(std::string_view server, std::string_view database) {
    auto driver = detectBestSqlServerDriver();
    // ODBC Driver 18+ requires explicit SSL settings
    // TrustServerCertificate=yes allows self-signed certificates (common in dev environments)
    if (driver.find("18") != std::string::npos || driver.find("19") != std::string::npos || driver.find("20") != std::string::npos) {
        return std::format("Driver={{{}}};Server={};Database={};Encrypt=yes;TrustServerCertificate=yes;", driver, server, database);
    }
    return std::format("Driver={{{}}};Server={};Database={};", driver, server, database);
}

}  // namespace predategrip
