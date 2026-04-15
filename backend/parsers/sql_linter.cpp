#include "sql_linter.h"

#include "../utils/logger.h"
#include "simdjson.h"

#include <algorithm>
#include <array>
#include <filesystem>
#include <format>
#include <memory>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace velocitydb {

namespace {

struct HandleCloser {
    void operator()(HANDLE h) const noexcept {
        if (h && h != INVALID_HANDLE_VALUE)
            CloseHandle(h);
    }
};
using UniqueHandle = std::unique_ptr<void, HandleCloser>;

[[nodiscard]] std::wstring toWide(std::string_view utf8) {
    if (utf8.empty())
        return {};
    int len = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
    std::wstring result(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), result.data(), len);
    return result;
}

/// Quote a CreateProcessW argument per MS C runtime parsing (2n+1 backslash rule).
[[nodiscard]] std::wstring quoteArg(std::wstring_view arg) {
    if (!arg.empty() && arg.find_first_of(L" \t\"") == std::wstring_view::npos)
        return std::wstring(arg);

    std::wstring quoted = L"\"";
    for (size_t i = 0; i < arg.size();) {
        size_t nSlashes = 0;
        while (i < arg.size() && arg[i] == L'\\') {
            ++nSlashes;
            ++i;
        }
        if (i == arg.size()) {
            quoted.append(nSlashes * 2, L'\\');
        } else if (arg[i] == L'"') {
            quoted.append(nSlashes * 2 + 1, L'\\');
            quoted.push_back(L'"');
            ++i;
        } else {
            quoted.append(nSlashes, L'\\');
            quoted.push_back(arg[i]);
            ++i;
        }
    }
    quoted.push_back(L'"');
    return quoted;
}

[[nodiscard]] std::filesystem::path moduleDir() {
    wchar_t buf[MAX_PATH] = {};
    GetModuleFileNameW(nullptr, buf, MAX_PATH);
    return std::filesystem::path(buf).parent_path();
}

}  // namespace

std::string mapDialectToSqruff(std::string_view dbType) {
    if (dbType == "sqlserver")
        return "tsql";
    if (dbType == "postgresql")
        return "postgres";
    if (dbType == "mysql")
        return "mysql";
    return {};
}

std::filesystem::path defaultSqruffBinary() {
    return moduleDir() / "sqruff" / "sqruff.exe";
}

std::filesystem::path defaultSqruffConfig() {
    return moduleDir() / "config" / "sqruff" / ".sqruff";
}

std::expected<std::vector<LintDiagnostic>, std::string> parseSqruffJson(std::string_view json) {
    // Empty or whitespace-only stdout is treated as "no diagnostics"
    bool allWhitespace = true;
    for (char c : json) {
        if (c != ' ' && c != '\n' && c != '\r' && c != '\t') {
            allWhitespace = false;
            break;
        }
    }
    if (allWhitespace)
        return std::vector<LintDiagnostic>{};

    thread_local static simdjson::dom::parser parser;
    auto doc = parser.parse(json.data(), json.size());
    if (doc.error())
        return std::unexpected(std::format("sqruff JSON parse error: {}", simdjson::error_message(doc.error())));

    std::vector<LintDiagnostic> diagnostics;
    auto obj = doc.value().get_object();
    if (obj.error())
        return std::unexpected("sqruff JSON top-level is not an object");

    for (auto [_, value] : obj.value()) {
        auto arr = value.get_array();
        if (arr.error())
            continue;
        for (auto entry : arr.value()) {
            auto codeRes = entry["code"].get_string();
            std::string code = codeRes.error() ? std::string{} : std::string(codeRes.value());
            // Filter: only parse-error rule codes (PRS*) are actionable blockers.
            if (code.size() < 3 || code.substr(0, 3) != "PRS")
                continue;

            LintDiagnostic d;
            d.code = std::move(code);

            if (auto msg = entry["message"].get_string(); !msg.error())
                d.message.assign(msg.value().data(), msg.value().size());

            auto rangeObj = entry["range"]["start"];
            if (auto ln = rangeObj["line"].get_int64(); !ln.error())
                d.line = std::max<int>(1, static_cast<int>(ln.value()));
            if (auto col = rangeObj["character"].get_int64(); !col.error())
                d.column = std::max<int>(1, static_cast<int>(col.value()));

            diagnostics.push_back(std::move(d));
        }
    }
    return diagnostics;
}

std::expected<std::string, LintError> invokeSqruff(const SqlLinterConfig& cfg, std::string_view sql, std::string_view dialect) {
    std::error_code ec;
    if (!std::filesystem::exists(cfg.binary, ec)) {
        return std::unexpected(LintError{LintErrorKind::BinaryNotFound, std::format("sqruff.exe not found at: {}", cfg.binary.string())});
    }

    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;
    sa.lpSecurityDescriptor = nullptr;

    HANDLE stdinRead = nullptr, stdinWrite = nullptr;
    HANDLE stdoutRead = nullptr, stdoutWrite = nullptr;
    HANDLE stderrRead = nullptr, stderrWrite = nullptr;
    if (!CreatePipe(&stdinRead, &stdinWrite, &sa, 0))
        return std::unexpected(LintError{LintErrorKind::SpawnFailed, "CreatePipe(stdin) failed"});
    if (!SetHandleInformation(stdinWrite, HANDLE_FLAG_INHERIT, 0))
        return std::unexpected(LintError{LintErrorKind::SpawnFailed, "SetHandleInformation(stdin) failed"});
    if (!CreatePipe(&stdoutRead, &stdoutWrite, &sa, 0))
        return std::unexpected(LintError{LintErrorKind::SpawnFailed, "CreatePipe(stdout) failed"});
    if (!SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0))
        return std::unexpected(LintError{LintErrorKind::SpawnFailed, "SetHandleInformation(stdout) failed"});
    if (!CreatePipe(&stderrRead, &stderrWrite, &sa, 0))
        return std::unexpected(LintError{LintErrorKind::SpawnFailed, "CreatePipe(stderr) failed"});
    if (!SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0))
        return std::unexpected(LintError{LintErrorKind::SpawnFailed, "SetHandleInformation(stderr) failed"});

    UniqueHandle stdinReadG{stdinRead}, stdinWriteG{stdinWrite};
    UniqueHandle stdoutReadG{stdoutRead}, stdoutWriteG{stdoutWrite};
    UniqueHandle stderrReadG{stderrRead}, stderrWriteG{stderrWrite};

    // Build command line: sqruff.exe [--config X] lint - --dialect Y --format json --parsing-errors
    std::wstring cmdLine = quoteArg(cfg.binary.wstring());
    if (!cfg.configFile.empty() && std::filesystem::exists(cfg.configFile, ec)) {
        cmdLine += L" --config ";
        cmdLine += quoteArg(cfg.configFile.wstring());
    }
    cmdLine += L" --parsing-errors --dialect ";
    cmdLine += quoteArg(toWide(dialect));
    cmdLine += L" lint - --format json";

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdInput = stdinRead;
    si.hStdOutput = stdoutWrite;
    si.hStdError = stderrWrite;

    PROCESS_INFORMATION pi{};
    std::wstring cmdMutable = cmdLine;
    if (!CreateProcessW(nullptr, cmdMutable.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
        return std::unexpected(LintError{LintErrorKind::SpawnFailed, std::format("CreateProcessW failed (error={})", GetLastError())});
    }
    UniqueHandle processG{pi.hProcess};
    UniqueHandle threadG{pi.hThread};

    // Close child-side pipe ends in parent (otherwise reads/EOF hang)
    stdinReadG.reset();
    stdoutWriteG.reset();
    stderrWriteG.reset();

    // Write SQL to sqruff's stdin then close
    {
        size_t offset = 0;
        while (offset < sql.size()) {
            DWORD toWrite = static_cast<DWORD>(std::min<size_t>(sql.size() - offset, 65536));
            DWORD written = 0;
            if (!WriteFile(stdinWriteG.get(), sql.data() + offset, toWrite, &written, nullptr) || written == 0)
                break;
            offset += written;
        }
        stdinWriteG.reset();
    }

    // Drain stdout while process runs
    std::string stdoutBuf;
    {
        std::array<char, 4096> buf{};
        DWORD bytesRead = 0;
        while (ReadFile(stdoutReadG.get(), buf.data(), static_cast<DWORD>(buf.size()), &bytesRead, nullptr) && bytesRead > 0) {
            stdoutBuf.append(buf.data(), bytesRead);
        }
    }

    // Wait for exit (with timeout)
    DWORD waitMs = static_cast<DWORD>(cfg.timeout.count());
    DWORD waitRes = WaitForSingleObject(processG.get(), waitMs);
    if (waitRes == WAIT_TIMEOUT) {
        TerminateProcess(processG.get(), 1);
        WaitForSingleObject(processG.get(), 1000);
        return std::unexpected(LintError{LintErrorKind::Timeout, std::format("sqruff timed out after {}ms", waitMs)});
    }
    if (waitRes != WAIT_OBJECT_0) {
        return std::unexpected(LintError{LintErrorKind::SpawnFailed, std::format("WaitForSingleObject failed (res={})", waitRes)});
    }

    return stdoutBuf;
}

std::expected<std::vector<LintDiagnostic>, LintError> lintSqlForParseErrors(const SqlLinterConfig& cfg, std::string_view sql, std::string_view dialect) {
    auto stdoutRes = invokeSqruff(cfg, sql, dialect);
    if (!stdoutRes)
        return std::unexpected(stdoutRes.error());

    auto parsed = parseSqruffJson(*stdoutRes);
    if (!parsed)
        return std::unexpected(LintError{LintErrorKind::InvalidOutput, parsed.error()});
    return *parsed;
}

}  // namespace velocitydb
