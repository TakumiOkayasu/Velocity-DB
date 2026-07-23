#pragma once

#include "../interfaces/block_detector.h"

#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

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
    [[nodiscard]] static ParsedSQL parseSQL(std::string_view sql);

    /// Check if the SQL statement is a USE statement
    [[nodiscard]] static bool isUseStatement(std::string_view sql);

    /// Extract the database name from a USE statement
    [[nodiscard]] static std::string extractDatabaseName(std::string_view sql);

    /// Check if the SQL starts with SELECT or WITH (i.e. read-only query).
    [[nodiscard]] static bool isReadOnlyQuery(std::string_view sql);

    /// Check if the SQL is a transaction control statement (BEGIN/COMMIT/ROLLBACK/START TRANSACTION)
    [[nodiscard]] static bool isTransactionControl(std::string_view sql);

    /// Split SQL text into individual statements (semicolon-delimited)
    /// No block detection — backward-compatible with existing callers
    [[nodiscard]] static std::vector<std::string> splitStatements(std::string_view sql);

    /// Split SQL text with block detection via injected detectors (OCP)
    /// @param detectors  Block detectors for multi-line constructs (e.g. COPY FROM stdin)
    [[nodiscard]] static std::vector<std::string> splitStatements(std::string_view sql, std::span<const IBlockDetector* const> detectors);

    /// Normalize a single SQL statement for use as a result-cache key (#511).
    /// Strips leading/trailing whitespace and trailing statement terminators (';').
    /// Deliberately conservative: no case folding or inner-whitespace collapsing,
    /// since string literals / quoted identifiers are case- and space-sensitive.
    /// Returns a subview of the input (no allocation).
    [[nodiscard]] static std::string_view normalizeForCacheKey(std::string_view sql);
};

}  // namespace velocitydb
