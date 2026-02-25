#include "odbc_driver_detector.h"

#include "odbc_unicode.h"

#include <Windows.h>
#include <sql.h>
#include <sqlext.h>

#include <array>
#include <format>
#include <mutex>
#include <span>

namespace velocitydb {

namespace {

bool isDriverAvailable(std::string_view driverName) {
    SQLHENV env = SQL_NULL_HENV;

    if (SQLAllocHandle(SQL_HANDLE_ENV, SQL_NULL_HANDLE, &env) != SQL_SUCCESS) {
        return false;
    }

    if (SQLSetEnvAttr(env, SQL_ATTR_ODBC_VERSION, toSqlPointer(SQL_OV_ODBC3), 0) != SQL_SUCCESS) {
        SQLFreeHandle(SQL_HANDLE_ENV, env);
        return false;
    }

    std::array<SQLWCHAR, 256> driverDesc{};
    std::array<SQLWCHAR, 256> driverAttr{};
    SQLSMALLINT descLen = 0;
    SQLSMALLINT attrLen = 0;

    SQLUSMALLINT direction = SQL_FETCH_FIRST;
    bool found = false;

    auto wideDriverName = utf8ToWide(driverName);

    while (SQLDriversW(env, direction, driverDesc.data(), static_cast<SQLSMALLINT>(driverDesc.size()), &descLen, driverAttr.data(), static_cast<SQLSMALLINT>(driverAttr.size()), &attrLen) ==
           SQL_SUCCESS) {
        if (std::wstring_view(toWchar(driverDesc.data())) == wideDriverName) {
            found = true;
            break;
        }
        direction = SQL_FETCH_NEXT;
    }

    SQLFreeHandle(SQL_HANDLE_ENV, env);
    return found;
}

/// Finds the first available driver from a priority list, with optional fallback.
std::string findBestDriver(std::span<const char* const> candidates, std::string_view fallback = "") {
    for (const auto& name : candidates) {
        if (isDriverAvailable(name))
            return name;
    }
    return std::string(fallback);
}

}  // namespace

std::string detectBestSqlServerDriver() {
    static std::once_flag flag;
    static std::string cached;
    static constexpr std::array candidates = {"ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "ODBC Driver 13 for SQL Server", "SQL Server"};
    std::call_once(flag, [&] { cached = findBestDriver(candidates, "SQL Server"); });
    return cached;
}

std::string detectBestMySqlDriver() {
    static std::once_flag flag;
    static std::string cached;
    static constexpr std::array candidates = {"MySQL ODBC 9.2 Unicode Driver", "MySQL ODBC 9.1 Unicode Driver", "MySQL ODBC 9.0 Unicode Driver", "MySQL ODBC 8.4 Unicode Driver",
                                              "MySQL ODBC 8.0 Unicode Driver"};
    std::call_once(flag, [&] { cached = findBestDriver(candidates); });
    return cached;
}

std::string buildDriverConnectionPrefix(std::string_view server, std::string_view database) {
    auto driver = detectBestSqlServerDriver();
    // ODBC Driver 18+ requires explicit SSL settings
    // TrustServerCertificate=yes allows self-signed certificates (common in dev environments)
    if (driver.contains("18") || driver.contains("19") || driver.contains("20")) {
        return std::format("Driver={{{}}};Server={};Database={};Encrypt=yes;TrustServerCertificate=yes;", driver, server, database);
    }
    return std::format("Driver={{{}}};Server={};Database={};", driver, server, database);
}

}  // namespace velocitydb
