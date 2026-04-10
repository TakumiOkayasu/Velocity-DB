#include <gtest/gtest.h>

#include "database/connection_utils.h"
#include "database/psql_subprocess.h"

namespace velocitydb {
namespace test {

TEST(PsqlSubprocessTest, ToPsqlConnectionInfoBasic) {
    DatabaseConnectionParams params;
    params.server = "localhost,5432";
    params.database = "testdb";
    params.username = "postgres";
    params.password = "secret";
    params.dbType = DbType::PostgreSQL;

    auto info = toPsqlConnectionInfo(params);
    EXPECT_EQ(info.host, "localhost");
    EXPECT_EQ(info.port, 5432);
    EXPECT_EQ(info.database, "testdb");
    EXPECT_EQ(info.username, "postgres");
    EXPECT_EQ(info.password, "secret");
}

TEST(PsqlSubprocessTest, ToPsqlConnectionInfoDefaultPort) {
    DatabaseConnectionParams params;
    params.server = "db.example.com";
    params.database = "mydb";
    params.username = "user";
    params.password = "pass";
    params.dbType = DbType::PostgreSQL;

    auto info = toPsqlConnectionInfo(params);
    EXPECT_EQ(info.host, "db.example.com");
    EXPECT_EQ(info.port, 5432);
}

TEST(PsqlSubprocessTest, ToPsqlConnectionInfoSshTunnel) {
    DatabaseConnectionParams params;
    params.server = "127.0.0.1,54321";
    params.database = "remotedb";
    params.username = "admin";
    params.password = "tunnelpass";
    params.dbType = DbType::PostgreSQL;

    auto info = toPsqlConnectionInfo(params);
    EXPECT_EQ(info.host, "127.0.0.1");
    EXPECT_EQ(info.port, 54321);
}

// --- shellQuote tests (C1: Windows 2n+1 backslash rule) ---

TEST(PsqlSubprocessTest, ShellQuoteSimple) {
    EXPECT_EQ(shellQuote("hello"), "\"hello\"");
}

TEST(PsqlSubprocessTest, ShellQuoteEmpty) {
    EXPECT_EQ(shellQuote(""), "\"\"");
}

TEST(PsqlSubprocessTest, ShellQuoteEmbeddedQuote) {
    // `say "hi"` → `"say \"hi\""`
    EXPECT_EQ(shellQuote(R"(say "hi")"), R"("say \"hi\"")");
}

TEST(PsqlSubprocessTest, ShellQuoteTrailingBackslash) {
    // `C:\path\` → `"C:\path\\"` (trailing `\` is doubled)
    EXPECT_EQ(shellQuote("C:\\path\\"), "\"C:\\path\\\\\"");
}

TEST(PsqlSubprocessTest, ShellQuoteBackslashBeforeQuote) {
    // `a\"b` → `"a\\\"b"` (one `\` before `"` → 2*1+1=3 backslashes)
    EXPECT_EQ(shellQuote("a\\\"b"), "\"a\\\\\\\"b\"");
}

TEST(PsqlSubprocessTest, ShellQuoteMultiBackslashBeforeQuote) {
    // `a\\"b` → `"a\\\\\\"b"` (two `\` before `"` → 2*2+1=5 backslashes)
    EXPECT_EQ(shellQuote("a\\\\\"b"), "\"a\\\\\\\\\\\"b\"");
}

TEST(PsqlSubprocessTest, ShellQuoteBackslashNoSpecial) {
    // Backslashes not before `"` or end stay literal
    EXPECT_EQ(shellQuote("a\\b"), "\"a\\b\"");
}

TEST(PsqlSubprocessTest, ShellQuoteMultiTrailingBackslash) {
    // `dir\\` → `"dir\\\\"` (two trailing `\` → 4)
    EXPECT_EQ(shellQuote("dir\\\\"), "\"dir\\\\\\\\\"");
}

TEST(PsqlSubprocessTest, ShellQuoteCmdSpecialChars) {
    // CreateProcessW bypasses cmd.exe, so %, !, ^, & are literal
    EXPECT_EQ(shellQuote("100%done!"), "\"100%done!\"");
    EXPECT_EQ(shellQuote("a&b^c|d"), "\"a&b^c|d\"");
}

TEST(PsqlSubprocessTest, ShellQuoteSpacesAndTabs) {
    EXPECT_EQ(shellQuote("C:\\Program Files\\psql.exe"), "\"C:\\Program Files\\psql.exe\"");
    EXPECT_EQ(shellQuote("a\tb"), "\"a\tb\"");
}

TEST(PsqlSubprocessTest, ExecutePsqlFailsWithBadConnection) {
    if (!isPsqlAvailable())
        GTEST_SKIP() << "psql not installed";

    PsqlConnectionInfo conn{
        .host = "127.0.0.1",
        .port = 1,  // invalid port
        .database = "nonexistent",
        .username = "nobody",
        .password = "wrong",
    };

    std::atomic<bool> cancelled{false};
    auto result = executePsql(conn, "SELECT 1", cancelled);
    EXPECT_FALSE(result.has_value());
}

}  // namespace test
}  // namespace velocitydb
