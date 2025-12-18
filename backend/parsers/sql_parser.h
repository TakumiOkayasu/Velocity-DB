#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace predategrip {

/// Represents the type and metadata of a parsed SQL statement
struct ParsedSQL {
    std::string type;         ///< Statement type: "USE", "SELECT", "INSERT", "UPDATE", "DELETE", etc.
    std::string database;     ///< Database name for USE statements
    std::string originalSQL;  ///< Original SQL text
};

/// Simple SQL parser for detecting statement types and extracting metadata
class SQLParser {
public:
    /// Parse a SQL statement and return its type and metadata
    /// @param sql The SQL statement to parse
    /// @return ParsedSQL containing statement type and extracted metadata
    [[nodiscard]] static ParsedSQL parseSQL(std::string_view sql);

    /// Check if the SQL statement is a USE statement
    /// @param sql The SQL statement to check
    /// @return true if this is a USE statement, false otherwise
    [[nodiscard]] static bool isUseStatement(std::string_view sql);

    /// Extract the database name from a USE statement
    /// @param sql The USE statement to parse
    /// @return The database name, or empty string if not a valid USE statement
    [[nodiscard]] static std::string extractDatabaseName(std::string_view sql);

    /// Split SQL text into individual statements separated by semicolons
    /// @param sql The SQL text containing one or more statements
    /// @return Vector of individual SQL statements (trimmed, non-empty)
    [[nodiscard]] static std::vector<std::string> splitStatements(std::string_view sql);

private:
    /// Trim whitespace from both ends of a string view
    [[nodiscard]] static std::string_view trim(std::string_view str);

    /// Convert string to uppercase for case-insensitive comparison
    [[nodiscard]] static std::string toUpper(std::string_view str);
};

}  // namespace predategrip
