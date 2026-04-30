#pragma once

#include <chrono>
#include <expected>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

/// One parse-error diagnostic from sqruff
struct LintDiagnostic {
    int line = 0;    // 1-based line number (Monaco-compatible)
    int column = 0;  // 1-based column number
    std::string code;
    std::string message;
};

enum class LintErrorKind {
    BinaryNotFound,  // sqruff.exe not located at expected path
    SpawnFailed,     // CreateProcessW failed
    Timeout,         // process did not exit within timeout
    InvalidOutput,   // JSON parse failure
};

struct LintError {
    LintErrorKind kind{};
    std::string message;
};

struct SqlLinterConfig {
    std::filesystem::path binary;
    std::filesystem::path configFile;
    std::chrono::milliseconds timeout{5000};
};

/// Map Velocity-DB DatabaseType to sqruff --dialect value.
/// Supported: "sqlserver" -> "tsql", "postgresql" -> "postgres", "mysql" -> "mysql".
/// Returns empty string for unsupported dbType.
[[nodiscard]] std::string mapDialectToSqruff(std::string_view dbType);

/// Parse sqruff JSON output ({"<path>":[Diagnostic,...]}) and filter to parse errors only.
/// Accepted entries: (a) code starts with "PRS" (sqlfluff-compat), or
///                   (b) code is null/missing AND message == "Unparsable section" (sqruff 0.38 native).
/// All other diagnostics (non-parse-errors) are discarded even if sqruff emits them.
[[nodiscard]] std::expected<std::vector<LintDiagnostic>, std::string> parseSqruffJson(std::string_view json);

/// Spawn sqruff.exe with the given SQL passed on stdin and return raw stdout JSON.
/// Runs: <binary> --config <configFile> lint - --dialect <dialect> --format json --parsing-errors
[[nodiscard]] std::expected<std::string, LintError> invokeSqruff(const SqlLinterConfig& cfg, std::string_view sql, std::string_view dialect);

/// Default binary path: <module dir>/sqruff/sqruff.exe
[[nodiscard]] std::filesystem::path defaultSqruffBinary();

/// Default config path: <module dir>/config/sqruff/.sqruff
[[nodiscard]] std::filesystem::path defaultSqruffConfig();

/// High-level convenience: invoke sqruff, parse JSON, filter to parse errors (PRS or Unparsable section).
/// Returns empty vector when SQL has no parse errors.
[[nodiscard]] std::expected<std::vector<LintDiagnostic>, LintError> lintSqlForParseErrors(const SqlLinterConfig& cfg, std::string_view sql, std::string_view dialect);

}  // namespace velocitydb
