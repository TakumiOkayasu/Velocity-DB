#include "psql_subprocess.h"

#include "../utils/logger.h"

#include <charconv>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <format>
#include <future>

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

namespace velocitydb {

namespace {

/// RAII wrapper for Win32 HANDLEs
struct HandleCloser {
    void operator()(HANDLE h) const {
        if (h && h != INVALID_HANDLE_VALUE)
            CloseHandle(h);
    }
};
using UniqueHandle = std::unique_ptr<void, HandleCloser>;

/// RAII wrapper for temporary file
struct TempFileGuard {
    std::filesystem::path path;

    ~TempFileGuard() {
        if (!path.empty()) {
            std::error_code ec;
            std::filesystem::remove(path, ec);
        }
    }
};

/// Convert UTF-8 string to wide string via Win32 API
[[nodiscard]] std::wstring toWide(std::string_view utf8) {
    if (utf8.empty())
        return {};
    int len = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
    std::wstring result(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), result.data(), len);
    return result;
}

/// Build environment block with PGPASSWORD set (case-insensitive filter)
[[nodiscard]] std::wstring buildEnvironmentBlock(std::string_view password) {
    std::wstring envBlock;

    auto* currentEnv = GetEnvironmentStringsW();
    if (currentEnv) {
        auto* p = currentEnv;
        while (*p) {
            std::wstring_view entry(p);
            // Case-insensitive skip of existing PGPASSWORD (Windows env vars are CI)
            bool isPgPassword = entry.size() >= 11 && _wcsnicmp(entry.data(), L"PGPASSWORD=", 11) == 0;
            if (!isPgPassword) {
                envBlock.append(entry);
                envBlock.push_back(L'\0');
            }
            p += entry.size() + 1;
        }
        FreeEnvironmentStringsW(currentEnv);
    }

    // Add PGPASSWORD with proper UTF-8 conversion
    envBlock += L"PGPASSWORD=";
    envBlock += toWide(password);
    envBlock.push_back(L'\0');

    // Double null terminator
    envBlock.push_back(L'\0');
    return envBlock;
}

/// Read all data from a pipe handle
[[nodiscard]] std::string readPipe(HANDLE pipe) {
    std::string output;
    char buffer[4096];
    DWORD bytesRead = 0;
    while (ReadFile(pipe, buffer, sizeof(buffer), &bytesRead, nullptr) && bytesRead > 0) {
        output.append(buffer, bytesRead);
    }
    return output;
}

/// Parse "COPY N" from psql stdout to extract affected rows
[[nodiscard]] int64_t parseCopyAffectedRows(std::string_view output) {
    int64_t totalRows = 0;
    size_t pos = 0;
    while ((pos = output.find("COPY ", pos)) != std::string_view::npos) {
        if (pos != 0 && output[pos - 1] != '\n') {
            ++pos;
            continue;
        }
        auto numStart = pos + 5;
        auto lineEnd = output.find('\n', numStart);
        auto numStr = output.substr(numStart, lineEnd != std::string_view::npos ? lineEnd - numStart : std::string_view::npos);
        int64_t rows = 0;
        if (auto [ptr, ec] = std::from_chars(numStr.data(), numStr.data() + numStr.size(), rows); ec == std::errc{}) {
            totalRows += rows;
        }
        pos = (lineEnd != std::string_view::npos) ? lineEnd + 1 : output.size();
    }
    return totalRows;
}

/// Scan a PostgreSQL root directory for the highest-versioned psql.exe
[[nodiscard]] std::filesystem::path scanPgRoot(const std::filesystem::path& pgRoot) {
    namespace fs = std::filesystem;
    std::error_code ec;
    if (!fs::is_directory(pgRoot, ec))
        return {};

    int bestVersion = 0;
    fs::path bestPath;
    for (const auto& entry : fs::directory_iterator(pgRoot, ec)) {
        auto psqlPath = entry.path() / "bin" / "psql.exe";
        if (!fs::exists(psqlPath, ec))
            continue;
        auto dirName = entry.path().filename().string();
        int version = 0;
        std::from_chars(dirName.data(), dirName.data() + dirName.size(), version);
        if (version > bestVersion) {
            bestVersion = version;
            bestPath = psqlPath;
        }
    }
    return bestPath;
}

/// Search for psql.exe across multiple locations
[[nodiscard]] std::wstring findPsqlPath() {
    namespace fs = std::filesystem;
    std::error_code ec;

    // 1. Check PATH (includes Scoop shims, Chocolatey bin, user-added paths)
    wchar_t pathBuf[MAX_PATH];
    if (SearchPathW(nullptr, L"psql.exe", nullptr, MAX_PATH, pathBuf, nullptr)) {
        return pathBuf;
    }

    // 2. Standard installer: C:\Program Files\PostgreSQL\<version>\bin
    if (auto p = scanPgRoot(L"C:\\Program Files\\PostgreSQL"); !p.empty())
        return p.wstring();

    // 3. 32-bit installer
    if (auto p = scanPgRoot(L"C:\\Program Files (x86)\\PostgreSQL"); !p.empty())
        return p.wstring();

    // 4. Scoop (per-user)
    if (auto* home = std::getenv("USERPROFILE")) {
        auto scoopPsql = fs::path(home) / "scoop" / "apps" / "postgresql" / "current" / "bin" / "psql.exe";
        if (fs::exists(scoopPsql, ec))
            return scoopPsql.wstring();
    }

    // 5. Chocolatey
    {
        auto chocoLib = fs::path("C:\\ProgramData\\chocolatey\\lib");
        if (fs::is_directory(chocoLib, ec)) {
            for (const auto& entry : fs::directory_iterator(chocoLib, ec)) {
                auto dirName = entry.path().filename().string();
                if (dirName.find("postgresql") == std::string::npos && dirName.find("psql") == std::string::npos)
                    continue;
                auto psqlPath = entry.path() / "tools" / "bin" / "psql.exe";
                if (fs::exists(psqlPath, ec))
                    return psqlPath.wstring();
            }
        }
    }

    // 6. EDB installer alternate location
    if (auto p = scanPgRoot(L"C:\\PostgreSQL"); !p.empty())
        return p.wstring();

    return {};
}

}  // namespace

std::string shellQuote(std::string_view value) {
    std::string quoted;
    quoted.reserve(value.size() + 2);
    quoted.push_back('"');

    for (size_t i = 0; i < value.size();) {
        if (value[i] == '\\') {
            size_t nSlashes = 0;
            while (i < value.size() && value[i] == '\\') {
                ++nSlashes;
                ++i;
            }
            if (i == value.size()) {
                // Backslashes at end: double them so closing `"` is not escaped
                quoted.append(nSlashes * 2, '\\');
            } else if (value[i] == '"') {
                // Backslashes before `"`: 2n+1 rule
                quoted.append(nSlashes * 2 + 1, '\\');
                quoted.push_back('"');
                ++i;
            } else {
                // Backslashes before normal char: literal
                quoted.append(nSlashes, '\\');
            }
        } else if (value[i] == '"') {
            quoted.push_back('\\');
            quoted.push_back('"');
            ++i;
        } else {
            quoted.push_back(value[i]);
            ++i;
        }
    }

    quoted.push_back('"');
    return quoted;
}

/// Cached wrapper — filesystem scan runs only once
[[nodiscard]] const std::wstring& cachedPsqlPath() {
    static const auto path = findPsqlPath();
    return path;
}

bool isPsqlAvailable() {
    return !cachedPsqlPath().empty();
}

PsqlConnectionInfo toPsqlConnectionInfo(const DatabaseConnectionParams& params) {
    auto [host, port] = splitHostPort(params.server, defaultDbPort(params.dbType));
    return {
        .host = std::move(host),
        .port = port,
        .database = params.database,
        .username = params.username,
        .password = params.password,
    };
}

std::expected<ResultSet, std::string> executePsql(const PsqlConnectionInfo& conn, std::string_view sql) {
    const auto startTime = std::chrono::high_resolution_clock::now();

    // Write SQL to temp file (W2: check return values)
    wchar_t tempDir[MAX_PATH];
    if (GetTempPathW(MAX_PATH, tempDir) == 0)
        return std::unexpected(std::format("GetTempPathW failed (error={})", GetLastError()));
    wchar_t tempFile[MAX_PATH];
    if (GetTempFileNameW(tempDir, L"vdb", 0, tempFile) == 0)
        return std::unexpected(std::format("GetTempFileNameW failed (error={})", GetLastError()));

    TempFileGuard tempGuard{tempFile};

    {
        auto* fp = _wfopen(tempFile, L"wb");
        if (!fp)
            return std::unexpected("Failed to create temp file for psql");
        auto written = std::fwrite(sql.data(), 1, sql.size(), fp);
        std::fclose(fp);
        if (written != sql.size())
            return std::unexpected("Failed to write SQL to temp file");
    }

    // Find psql executable
    const auto& psqlPath = cachedPsqlPath();
    if (psqlPath.empty())
        return std::unexpected("psql.exe が見つかりません。COPY FROM stdin を含むSQLの実行にはpsqlが必要です。\n"
                               "以下のいずれかの方法でインストールしてください:\n"
                               "  1. PostgreSQL公式インストーラー: https://www.postgresql.org/download/windows/\n"
                               "  2. Scoop: scoop install postgresql\n"
                               "  3. Chocolatey: choco install postgresql\n"
                               "インストール後、Velocity-DBを再起動してください。");

    // Build command line with properly quoted arguments to prevent injection
    auto tempPath = std::filesystem::path(tempFile).string();
    auto psqlNarrow = std::filesystem::path(psqlPath).string();
    auto cmdLine = std::format("{} -h {} -p {} -d {} -U {} -f {} --no-psqlrc -v ON_ERROR_STOP=1", shellQuote(psqlNarrow), shellQuote(conn.host), conn.port, shellQuote(conn.database),
                               shellQuote(conn.username), shellQuote(tempPath));

    log<LogLevel::INFO>(std::format("[PSQL] Delegating to psql: host={} port={} db={}", conn.host, conn.port, conn.database));

    // Create pipes for stdout/stderr
    SECURITY_ATTRIBUTES sa{};
    sa.nLength = sizeof(sa);
    sa.bInheritHandle = TRUE;

    HANDLE stdoutRead = nullptr;
    HANDLE stdoutWrite = nullptr;
    if (!CreatePipe(&stdoutRead, &stdoutWrite, &sa, 0))
        return std::unexpected(std::format("CreatePipe(stdout) failed (error={})", GetLastError()));
    UniqueHandle outRead(stdoutRead);
    UniqueHandle outWrite(stdoutWrite);

    HANDLE stderrRead = nullptr;
    HANDLE stderrWrite = nullptr;
    if (!CreatePipe(&stderrRead, &stderrWrite, &sa, 0))
        return std::unexpected(std::format("CreatePipe(stderr) failed (error={})", GetLastError()));
    UniqueHandle errRead(stderrRead);
    UniqueHandle errWrite(stderrWrite);

    // Ensure read ends are not inherited
    SetHandleInformation(stdoutRead, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(stderrRead, HANDLE_FLAG_INHERIT, 0);

    // Build environment with PGPASSWORD
    auto envBlock = buildEnvironmentBlock(conn.password);

    // C3: Redirect stdin to NUL so psql doesn't hang waiting for input
    UniqueHandle hNul(CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, nullptr));
    if (hNul.get() == INVALID_HANDLE_VALUE)
        return std::unexpected(std::format("Failed to open NUL device (error={})", GetLastError()));

    STARTUPINFOW si{};
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    si.hStdInput = hNul.get();
    si.hStdOutput = stdoutWrite;
    si.hStdError = stderrWrite;

    PROCESS_INFORMATION pi{};
    auto wCmd = toWide(cmdLine);

    if (!CreateProcessW(nullptr, wCmd.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, envBlock.data(), nullptr, &si, &pi)) {
        return std::unexpected(std::format("Failed to launch psql (error={})", GetLastError()));
    }

    UniqueHandle hProcess(pi.hProcess);
    UniqueHandle hThread(pi.hThread);

    // Close write ends in parent — child holds the only writers now.
    // After process exit (or terminate), these pipes will see EOF.
    outWrite.reset();
    errWrite.reset();

    // Wait for process with timeout BEFORE reading pipes.
    // readPipe blocks until the write-end is closed (process exit or terminate).
    constexpr DWORD kTimeoutMs = 300'000;
    auto waitResult = WaitForSingleObject(pi.hProcess, kTimeoutMs);
    if (waitResult == WAIT_TIMEOUT) {
        TerminateProcess(pi.hProcess, 1);
        WaitForSingleObject(pi.hProcess, 5000);
        // Drain remaining pipe data to prevent zombie handles
        readPipe(stdoutRead);
        readPipe(stderrRead);
        return std::unexpected("psql process timed out after 300 seconds");
    }

    // Process has exited — EOF guaranteed. Concurrent read avoids deadlock
    // if combined stdout+stderr exceed the 64KB pipe buffer.
    auto stderrFuture = std::async(std::launch::async, readPipe, stderrRead);
    auto stdoutData = readPipe(stdoutRead);
    auto stderrData = stderrFuture.get();

    DWORD exitCode = 1;
    GetExitCodeProcess(pi.hProcess, &exitCode);

    const auto endTime = std::chrono::high_resolution_clock::now();
    auto durationMs = std::chrono::duration<double, std::milli>(endTime - startTime).count();

    if (exitCode != 0) {
        while (!stderrData.empty() && std::isspace(static_cast<unsigned char>(stderrData.back())))
            stderrData.pop_back();
        log<LogLevel::ERROR_LEVEL>(std::format("[PSQL] Failed (exit={}): {}", exitCode, stderrData));
        return std::unexpected(stderrData.empty() ? std::format("psql exited with code {}", exitCode) : stderrData);
    }

    log<LogLevel::INFO>(std::format("[PSQL] Success in {:.1f}ms", durationMs));

    ResultSet result;
    result.affectedRows = parseCopyAffectedRows(stdoutData);
    result.executionTimeMs = durationMs;
    return result;
}

}  // namespace velocitydb
