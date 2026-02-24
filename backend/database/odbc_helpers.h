#pragma once

/// ODBC common helpers (Platform Layer)
/// Shared free functions for ODBC environment, connection, and statement operations.
/// Used by SqlServerDriver, PostgreSqlDriver, and any future ODBC-based driver.

#include "odbc_unicode.h"

#include <Windows.h>
#include <sql.h>
#include <sqlext.h>

#include <string>
#include <string_view>

namespace velocitydb::odbc {

/// Allocate ODBC environment handle with ODBC3 version set.
/// Throws on failure.
[[nodiscard]] SQLHENV allocateEnvironment();

/// Allocate ODBC connection handle from environment.
/// Throws on failure. Frees environment on error.
[[nodiscard]] SQLHDBC allocateConnection(SQLHENV env);

/// Set login and connection timeout on a connection handle.
void setConnectionTimeout(SQLHDBC dbc, unsigned int timeoutSeconds = 30);

/// Connect using ODBC connection string (SQLDriverConnectW).
/// Returns true on success. On failure, stores error via getDiagnosticMessage.
[[nodiscard]] bool connectWithString(SQLHDBC dbc, std::string_view connectionString, std::string& outError);

/// Disconnect an ODBC connection handle.
void disconnect(SQLHDBC dbc);

/// Cancel the current operation on a statement handle (thread-safe).
void cancelStatement(SQLHSTMT stmt);

/// Extract ODBC diagnostic message from handle.
[[nodiscard]] std::string getDiagnosticMessage(SQLRETURN returnCode, SQLSMALLINT handleType, SQLHANDLE handle);

/// Convert ODBC SQL type to display name.
[[nodiscard]] std::string convertSQLTypeToDisplayName(SQLSMALLINT dataType);

}  // namespace velocitydb::odbc
