#include <gtest/gtest.h>
#include "parsers/copy_block_detector.h"
#include "parsers/sql_parser.h"

namespace velocitydb {
namespace test {

// ===== splitStatements with CopyBlockDetector =====

class SQLParserSplitTest : public ::testing::Test {
protected:
    CopyBlockDetector copyDetector;
    const IBlockDetector* detectors[1] = {&copyDetector};
    std::span<const IBlockDetector* const> pgDetectors{detectors};
};

TEST_F(SQLParserSplitTest, CopyBlockBundledAsSingleStatement) {
    std::string sql =
        "COPY public.bp (id, name) FROM stdin;\n"
        "100001\tAlice\n"
        "100002\tBob\n"
        "\\.\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("COPY public.bp"), std::string::npos);
    EXPECT_NE(stmts[0].find("100001\tAlice"), std::string::npos);
    EXPECT_NE(stmts[0].find("100002\tBob"), std::string::npos);
    EXPECT_NE(stmts[0].find("\\."), std::string::npos);
}

TEST_F(SQLParserSplitTest, CopyWithSurroundingStatements) {
    std::string sql =
        "CREATE TABLE t (id int);\n"
        "COPY t (id) FROM stdin;\n"
        "1\n"
        "2\n"
        "\\.\n"
        "ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id);\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 3);
    EXPECT_NE(stmts[0].find("CREATE TABLE"), std::string::npos);
    EXPECT_NE(stmts[1].find("COPY t"), std::string::npos);
    EXPECT_NE(stmts[1].find("1\n"), std::string::npos);
    EXPECT_NE(stmts[2].find("ALTER TABLE"), std::string::npos);
}

TEST_F(SQLParserSplitTest, EmptyDataCopy) {
    std::string sql =
        "COPY t (id) FROM stdin;\n"
        "\\.\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("COPY t"), std::string::npos);
    EXPECT_NE(stmts[0].find("\\."), std::string::npos);
}

TEST_F(SQLParserSplitTest, PsqlMetaCommandsStillFiltered) {
    std::string sql =
        "\\connect mydb\n"
        "SELECT 1;\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("SELECT 1"), std::string::npos);
}

TEST_F(SQLParserSplitTest, NoCopyDetectorFallback) {
    // Without detectors, COPY block is NOT recognized as a block
    std::string sql = "SELECT 1;\nSELECT 2;\n";
    auto stmts = SQLParser::splitStatements(sql);
    ASSERT_EQ(stmts.size(), 2);
}

// ===== String literal / comment / dollar-quote awareness =====

TEST_F(SQLParserSplitTest, SemicolonInsideSingleQuotedString) {
    std::string sql = "SELECT pg_catalog.set_config('search_path', '', false);";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("set_config"), std::string::npos);
}

TEST_F(SQLParserSplitTest, EscapedQuoteWithSemicolon) {
    std::string sql = "SELECT 'it''s ; tricky';";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("it''s ; tricky"), std::string::npos);
}

TEST_F(SQLParserSplitTest, DollarQuotedString) {
    std::string sql = "SELECT $$ BEGIN; END; $$;";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("BEGIN; END;"), std::string::npos);
}

TEST_F(SQLParserSplitTest, NamedDollarQuotedString) {
    std::string sql =
        "CREATE FUNCTION f() RETURNS void AS $body$ BEGIN; END; $body$ LANGUAGE plpgsql;";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("BEGIN; END;"), std::string::npos);
}

TEST_F(SQLParserSplitTest, SingleLineCommentWithSemicolon) {
    auto stmts = SQLParser::splitStatements("-- comment;\n", pgDetectors);
    ASSERT_EQ(stmts.size(), 0);
}

TEST_F(SQLParserSplitTest, BlockCommentWithSemicolon) {
    std::string sql = "SELECT /* ; */ 1;";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("SELECT"), std::string::npos);
}

TEST_F(SQLParserSplitTest, NestedBlockComments) {
    std::string sql = "SELECT /* /* ; */ ; */ 1;";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("SELECT"), std::string::npos);
}

// Regression: closing `*/` on a line starting with `--` (decorative dashes) must
// not be stripped by the line-comment filter. Without block-aware filtering,
// `filterNonExecutableLines` drops the `*/` line and the block comment leaks
// to EOF, causing `splitStatements` to return 0 and the whole SQL to be sent
// to ODBC as a single batch (only the first result set is fetched).
TEST_F(SQLParserSplitTest, BlockCommentClosedByDashDecoratedLine) {
    std::string sql =
        "/* header\n"
        "------------ */\n"
        "SELECT 1;\n"
        "/* another\n"
        "------------ */\n"
        "SELECT 2;\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 2);
    EXPECT_NE(stmts[0].find("SELECT 1"), std::string::npos);
    EXPECT_NE(stmts[1].find("SELECT 2"), std::string::npos);
}

// Regression (SQL Server / MySQL path, no detectors): same bug surfaces through
// the no-detector `splitStatements(sql)` overload used by non-PostgreSQL drivers
// (see backend/parsers/split_utils.h). The original report is against SQL Server.
TEST_F(SQLParserSplitTest, BlockCommentClosedByDashDecoratedLine_NoDetectors) {
    std::string sql =
        "/* header\n"
        "------------ */\n"
        "SELECT 1;\n"
        "/* another\n"
        "------------ */\n"
        "SELECT 2;\n";
    auto stmts = SQLParser::splitStatements(sql);
    ASSERT_EQ(stmts.size(), 2);
    EXPECT_NE(stmts[0].find("SELECT 1"), std::string::npos);
    EXPECT_NE(stmts[1].find("SELECT 2"), std::string::npos);
}

// Regression: lines starting with `--` that are INSIDE a block comment must
// not be treated as SQL line comments (they are arbitrary text per SQL spec).
TEST_F(SQLParserSplitTest, DashPrefixLineInsideBlockCommentPreserved) {
    std::string sql =
        "/*\n"
        "-- this looks like a line comment but is inside /* ... */\n"
        "*/\n"
        "SELECT 1;\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("SELECT 1"), std::string::npos);
}

TEST_F(SQLParserSplitTest, PgDumpSetConfig) {
    std::string sql =
        "SET statement_timeout = 0;\n"
        "SET lock_timeout = 0;\n"
        "SET client_encoding = 'UTF8';\n"
        "SELECT pg_catalog.set_config('search_path', '', false);\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 4);
    EXPECT_NE(stmts[3].find("set_config"), std::string::npos);
    EXPECT_NE(stmts[3].find("'search_path'"), std::string::npos);
}

TEST_F(SQLParserSplitTest, DollarSignNotAQuote) {
    std::string sql = "SELECT $1; SELECT $2;";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 2);
    EXPECT_NE(stmts[0].find("$1"), std::string::npos);
    EXPECT_NE(stmts[1].find("$2"), std::string::npos);
}

TEST_F(SQLParserSplitTest, CopyBlockStillWorks) {
    std::string sql =
        "SELECT 1;\n"
        "COPY t (id) FROM stdin;\n"
        "1\n"
        "\\.\n"
        "SELECT 2;\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 3);
    EXPECT_NE(stmts[0].find("SELECT 1"), std::string::npos);
    EXPECT_NE(stmts[1].find("COPY t"), std::string::npos);
    EXPECT_NE(stmts[2].find("SELECT 2"), std::string::npos);
}

TEST_F(SQLParserSplitTest, EmptyAndWhitespace) {
    EXPECT_TRUE(SQLParser::splitStatements("", pgDetectors).empty());
    EXPECT_TRUE(SQLParser::splitStatements("   \n  \n  ", pgDetectors).empty());
}

TEST_F(SQLParserSplitTest, NoSemicolonSingleStatement) {
    std::string sql = "SELECT 1";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("SELECT 1"), std::string::npos);
}

// ===== isTransactionControl =====

TEST(SQLParserTest, IsTransactionControlBegin) {
    EXPECT_TRUE(SQLParser::isTransactionControl("BEGIN"));
    EXPECT_TRUE(SQLParser::isTransactionControl("begin"));
    EXPECT_TRUE(SQLParser::isTransactionControl("BEGIN TRANSACTION"));
    EXPECT_TRUE(SQLParser::isTransactionControl("  BEGIN  "));
}

TEST(SQLParserTest, IsTransactionControlCommit) {
    EXPECT_TRUE(SQLParser::isTransactionControl("COMMIT"));
    EXPECT_TRUE(SQLParser::isTransactionControl("commit"));
    EXPECT_TRUE(SQLParser::isTransactionControl("  COMMIT  "));
}

TEST(SQLParserTest, IsTransactionControlRollback) {
    EXPECT_TRUE(SQLParser::isTransactionControl("ROLLBACK"));
    EXPECT_TRUE(SQLParser::isTransactionControl("rollback"));
    EXPECT_TRUE(SQLParser::isTransactionControl("  ROLLBACK  "));
}

TEST(SQLParserTest, IsTransactionControlStartTransaction) {
    EXPECT_TRUE(SQLParser::isTransactionControl("START TRANSACTION"));
    EXPECT_TRUE(SQLParser::isTransactionControl("start transaction"));
    EXPECT_TRUE(SQLParser::isTransactionControl("  START TRANSACTION  "));
    EXPECT_TRUE(SQLParser::isTransactionControl("Start Transaction"));
}

TEST(SQLParserTest, IsTransactionControlNegative) {
    EXPECT_FALSE(SQLParser::isTransactionControl("SELECT 1"));
    EXPECT_FALSE(SQLParser::isTransactionControl("SET x = 1"));
    EXPECT_FALSE(SQLParser::isTransactionControl("INSERT INTO t VALUES (1)"));
    EXPECT_FALSE(SQLParser::isTransactionControl("CREATE TABLE t (id int)"));
    EXPECT_FALSE(SQLParser::isTransactionControl(""));
}

// ===== CopyBlockDetector unit tests =====

class CopyBlockDetectorTest : public ::testing::Test {
protected:
    CopyBlockDetector detector;
};

TEST_F(CopyBlockDetectorTest, StartsBlockPositive) {
    EXPECT_TRUE(detector.startsBlock("COPY t FROM stdin;"));
    EXPECT_TRUE(detector.startsBlock("COPY public.bp (id, name) FROM stdin;"));
    EXPECT_TRUE(detector.startsBlock("copy t from stdin;"));
    EXPECT_TRUE(detector.startsBlock("  COPY t FROM stdin  "));
    EXPECT_TRUE(detector.startsBlock("COPY t FROM stdin;\n1\tdata\n\\."));
}

TEST_F(CopyBlockDetectorTest, StartsBlockWithLeadingComments) {
    // pg_dump injects comments before COPY blocks
    EXPECT_TRUE(detector.startsBlock("--\n-- Data for Name: bp; Type: TABLE DATA\n--\n\nCOPY public.bp (id) FROM stdin;"));
    EXPECT_TRUE(detector.startsBlock("-- comment\nCOPY t FROM stdin;"));
    EXPECT_TRUE(detector.startsBlock("\n\n-- c1\n-- c2\nCOPY t FROM stdin;\n1\n\\."));
    // Comments only → false
    EXPECT_FALSE(detector.startsBlock("-- just a comment\n-- another"));
}

TEST_F(CopyBlockDetectorTest, StartsBlockNegative) {
    EXPECT_FALSE(detector.startsBlock("COPY t TO stdout;"));
    EXPECT_FALSE(detector.startsBlock("COPY t FROM '/path/to/file';"));
    EXPECT_FALSE(detector.startsBlock("SELECT * FROM t;"));
    EXPECT_FALSE(detector.startsBlock("INSERT INTO t VALUES (1);"));
}

TEST_F(CopyBlockDetectorTest, TerminatesBlock) {
    EXPECT_TRUE(detector.terminatesBlock("\\."));
    EXPECT_TRUE(detector.terminatesBlock("  \\.  "));
    EXPECT_FALSE(detector.terminatesBlock("regular data"));
    EXPECT_FALSE(detector.terminatesBlock("1\tAlice"));
}

TEST_F(CopyBlockDetectorTest, ExtractPartsSeparatesCommandAndData) {
    std::string compound =
        "COPY t (id, name) FROM stdin;\n"
        "1\tAlice\n"
        "2\tBob\n"
        "\\.";

    auto parts = CopyBlockDetector::extractParts(compound);
    EXPECT_EQ(parts.command, "COPY t (id, name) FROM stdin;");
    EXPECT_NE(parts.data.find("1\tAlice\n"), std::string::npos);
    EXPECT_NE(parts.data.find("2\tBob\n"), std::string::npos);
    EXPECT_EQ(parts.data.find("\\."), std::string::npos);
}

TEST_F(CopyBlockDetectorTest, ExtractPartsEmptyData) {
    std::string compound =
        "COPY t (id) FROM stdin;\n"
        "\\.";

    auto parts = CopyBlockDetector::extractParts(compound);
    EXPECT_EQ(parts.command, "COPY t (id) FROM stdin;");
    EXPECT_TRUE(parts.data.empty());
}

TEST_F(CopyBlockDetectorTest, ExtractPartsCommandOnly) {
    auto parts = CopyBlockDetector::extractParts("COPY t FROM stdin;");
    EXPECT_EQ(parts.command, "COPY t FROM stdin;");
    EXPECT_TRUE(parts.data.empty());
}

TEST_F(CopyBlockDetectorTest, ExtractPartsSkipsLeadingComments) {
    std::string compound =
        "--\n"
        "-- Data for Name: bp; Type: TABLE DATA\n"
        "--\n"
        "\n"
        "COPY t (id, name) FROM stdin;\n"
        "1\tAlice\n"
        "2\tBob\n"
        "\\.";

    auto parts = CopyBlockDetector::extractParts(compound);
    EXPECT_EQ(parts.command, "COPY t (id, name) FROM stdin;");
    // Exact data verification — no leading newline, no trailing \.
    EXPECT_EQ(parts.data, "1\tAlice\n2\tBob\n");
    EXPECT_NE(parts.data[0], '\n') << "Data must not start with newline (causes COPY empty line error)";
}

// ===== filterPsqlMetaCommands via splitStatements =====

TEST_F(SQLParserSplitTest, FilterPsqlMetaCommands_PreservesCopyNull) {
    // \N is NULL in COPY data — must NOT be filtered
    std::string sql =
        "COPY t (id, val) FROM stdin;\n"
        "1\t\\N\n"
        "2\tdata\n"
        "\\.\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("\\N"), std::string::npos);
}

TEST_F(SQLParserSplitTest, FilterPsqlMetaCommands_RemovesRestrict) {
    std::string sql =
        "\\restrict token\n"
        "SELECT 1;\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    EXPECT_NE(stmts[0].find("SELECT 1"), std::string::npos);
    EXPECT_EQ(stmts[0].find("restrict"), std::string::npos);
}

TEST_F(SQLParserSplitTest, FilterNonExecutableLines_RemovesSqlComments) {
    std::string sql =
        "-- comment line\n"
        "SELECT 1;\n"
        "-- another comment\n"
        "SELECT 2;\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 2);
    EXPECT_EQ(stmts[0].find("--"), std::string::npos);
    EXPECT_EQ(stmts[1].find("--"), std::string::npos);
}

TEST_F(SQLParserSplitTest, FilterNonExecutableLines_PreservesInlineComments) {
    std::string sql = "SELECT 1; -- inline comment stays in statement\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);
    // Inline comment is part of the statement (but harmless for execution)
    EXPECT_NE(stmts[0].find("SELECT 1"), std::string::npos);
}

// ===== isUseStatement performance =====

TEST(SQLParserTest, IsUseStatement_LargeCopyInput) {
    // 1MB COPY block must return false immediately (no regex/toUpper)
    std::string largeCopy = "COPY t (id) FROM stdin;\n";
    largeCopy.append(1024 * 1024, 'x');
    EXPECT_FALSE(SQLParser::isUseStatement(largeCopy));
}

TEST(SQLParserTest, IsUseStatementPositive) {
    EXPECT_TRUE(SQLParser::isUseStatement("USE mydb"));
    EXPECT_TRUE(SQLParser::isUseStatement("use mydb"));
    EXPECT_TRUE(SQLParser::isUseStatement("  USE  [mydb]  "));
}

TEST(SQLParserTest, IsUseStatementNegative) {
    EXPECT_FALSE(SQLParser::isUseStatement("SELECT 1"));
    EXPECT_FALSE(SQLParser::isUseStatement("USEFUL"));
    EXPECT_FALSE(SQLParser::isUseStatement(""));
}

// ===== pg_dump format integration =====

TEST_F(SQLParserSplitTest, SplitStatements_PgDumpFormat) {
    std::string sql =
        "SET statement_timeout = 0;\n"
        "CREATE TABLE t (id int);\n"
        "COPY t (id) FROM stdin;\n"
        "1\n"
        "2\n"
        "\\.\n"
        "ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id);\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 4);
    EXPECT_NE(stmts[0].find("SET"), std::string::npos);
    EXPECT_NE(stmts[1].find("CREATE TABLE"), std::string::npos);
    EXPECT_NE(stmts[2].find("COPY t"), std::string::npos);
    EXPECT_NE(stmts[3].find("ALTER TABLE"), std::string::npos);
}

TEST_F(SQLParserSplitTest, SplitStatements_PgDumpFormatWithComments) {
    // Real pg_dump output has comments before COPY blocks
    std::string sql =
        "SET statement_timeout = 0;\n"
        "\n"
        "CREATE TABLE public.bp (id int, name text);\n"
        "\n"
        "--\n"
        "-- Data for Name: bp; Type: TABLE DATA; Schema: public; Owner: postgres\n"
        "--\n"
        "\n"
        "COPY public.bp (id, name) FROM stdin;\n"
        "1\tAlice\n"
        "2\tBob\n"
        "\\.\n"
        "\n"
        "ALTER TABLE public.bp ADD CONSTRAINT bp_pkey PRIMARY KEY (id);\n";
    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 4);
    EXPECT_NE(stmts[0].find("SET"), std::string::npos);
    EXPECT_NE(stmts[1].find("CREATE TABLE"), std::string::npos);
    EXPECT_NE(stmts[2].find("COPY public.bp"), std::string::npos);
    EXPECT_NE(stmts[2].find("1\tAlice"), std::string::npos);
    EXPECT_NE(stmts[3].find("ALTER TABLE"), std::string::npos);
}

// E2E: splitStatements → canHandle → extractParts (full pg_dump pipeline)
TEST_F(SQLParserSplitTest, E2E_PgDumpCopyWithComments_DataIntegrity) {
    std::string sql =
        "SET statement_timeout = 0;\n"
        "\n"
        "--\n"
        "-- Name: bp; Type: TABLE; Schema: public; Owner: postgres\n"
        "--\n"
        "\n"
        "CREATE TABLE public.bp (id int, name text);\n"
        "\n"
        "--\n"
        "-- Data for Name: bp; Type: TABLE DATA; Schema: public; Owner: postgres\n"
        "--\n"
        "\n"
        "COPY public.bp (id, name) FROM stdin;\n"
        "1\tAlice\n"
        "2\tBob\n"
        "3\tCharlie\n"
        "\\.\n"
        "\n"
        "ALTER TABLE public.bp ADD CONSTRAINT bp_pkey PRIMARY KEY (id);\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 4) << "Expected: SET, CREATE TABLE, COPY block, ALTER TABLE";

    // COPY compound statement must not contain comment lines (filtered out)
    auto& copyStmt = stmts[2];
    EXPECT_EQ(copyStmt.find("--"), std::string::npos) << "Comments must be filtered before splitting";
    EXPECT_TRUE(copyDetector.startsBlock(copyStmt)) << "canHandle must return true for: " << copyStmt.substr(0, 100);

    // extractParts must separate command from data correctly
    auto parts = CopyBlockDetector::extractParts(copyStmt);
    EXPECT_EQ(parts.command, "COPY public.bp (id, name) FROM stdin;");

    // Data must NOT start with newline (would cause "empty line 1" error)
    ASSERT_FALSE(parts.data.empty()) << "Data must not be empty";
    EXPECT_NE(parts.data[0], '\n') << "Data must not start with newline";

    // Exact data content verification
    EXPECT_EQ(parts.data, "1\tAlice\n2\tBob\n3\tCharlie\n");
}

// E2E: Multiple COPY blocks in one pg_dump (tables with/without data)
TEST_F(SQLParserSplitTest, E2E_PgDumpMultipleCopyBlocks) {
    std::string sql =
        "CREATE TABLE t1 (id int);\n"
        "CREATE TABLE t2 (id int, val text);\n"
        "\n"
        "--\n"
        "-- Data for Name: t1; Type: TABLE DATA\n"
        "--\n"
        "\n"
        "COPY t1 (id) FROM stdin;\n"
        "10\n"
        "20\n"
        "\\.\n"
        "\n"
        "--\n"
        "-- Data for Name: t2; Type: TABLE DATA\n"
        "--\n"
        "\n"
        "COPY t2 (id, val) FROM stdin;\n"
        "1\thello\n"
        "2\tworld\n"
        "\\.\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 4) << "Expected: CREATE t1, CREATE t2, COPY t1, COPY t2";

    // COPY t1
    EXPECT_TRUE(copyDetector.startsBlock(stmts[2]));
    auto parts1 = CopyBlockDetector::extractParts(stmts[2]);
    EXPECT_EQ(parts1.command, "COPY t1 (id) FROM stdin;");
    EXPECT_EQ(parts1.data, "10\n20\n");

    // COPY t2
    EXPECT_TRUE(copyDetector.startsBlock(stmts[3]));
    auto parts2 = CopyBlockDetector::extractParts(stmts[3]);
    EXPECT_EQ(parts2.command, "COPY t2 (id, val) FROM stdin;");
    EXPECT_EQ(parts2.data, "1\thello\n2\tworld\n");
}

// Edge: COPY with semicolons in comment (pg_dump standard)
TEST_F(SQLParserSplitTest, E2E_CommentWithSemicolonsBeforeCopy) {
    std::string sql =
        "CREATE TABLE t (id int);\n"
        "--\n"
        "-- Data for Name: t; Type: TABLE DATA; Schema: public; Owner: postgres\n"
        "--\n"
        "\n"
        "COPY t (id) FROM stdin;\n"
        "42\n"
        "\\.\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 2) << "CREATE + COPY block";

    auto parts = CopyBlockDetector::extractParts(stmts[1]);
    EXPECT_EQ(parts.command, "COPY t (id) FROM stdin;");
    EXPECT_EQ(parts.data, "42\n");
}

// Edge: Empty table COPY (no data rows)
TEST_F(SQLParserSplitTest, E2E_EmptyCopyWithComments) {
    std::string sql =
        "--\n"
        "-- Data for Name: empty_tbl; Type: TABLE DATA\n"
        "--\n"
        "\n"
        "COPY empty_tbl (id) FROM stdin;\n"
        "\\.\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);

    auto parts = CopyBlockDetector::extractParts(stmts[0]);
    EXPECT_EQ(parts.command, "COPY empty_tbl (id) FROM stdin;");
    EXPECT_TRUE(parts.data.empty());
}

// Edge: Data containing backslash-N (NULL marker)
TEST_F(SQLParserSplitTest, E2E_CopyWithNullValues) {
    std::string sql =
        "--\n"
        "-- Data\n"
        "--\n"
        "COPY t (id, val) FROM stdin;\n"
        "1\t\\N\n"
        "2\tdata\n"
        "\\.\n";

    auto stmts = SQLParser::splitStatements(sql, pgDetectors);
    ASSERT_EQ(stmts.size(), 1);

    auto parts = CopyBlockDetector::extractParts(stmts[0]);
    EXPECT_EQ(parts.command, "COPY t (id, val) FROM stdin;");
    EXPECT_EQ(parts.data, "1\t\\N\n2\tdata\n");
}

// ===== Cross-DB 3-part names with multiple SELECTs (neighbor DB) =====

TEST_F(SQLParserSplitTest, CrossDbThreePartNamesSplitsIntoTwo) {
    // User-reported sample: two SELECTs referencing different databases
    // via SQL Server 3-part names, with leading line comment and
    // Japanese identifiers/values.
    std::string sql =
        "-- 例\n"
        "SELECT o.ID, o.工場ID, os.allotted_data_import_status,\n"
        "    os.allotted_data_reimport_allowed_date, os.tag_number\n"
        "FROM [OMS_20250515].[dbo].[orders] o\n"
        "    LEFT JOIN [OMS_20250515].[dbo].[order_subs] os ON os.order_id = o.ID\n"
        "WHERE o.発注番号 = 'DH00588404';\n"
        "\n"
        "SELECT COUNT(*) AS existing_products\n"
        "FROM [MMS].[dbo].[products] p\n"
        "    JOIN [MMS].[dbo].[orders] o ON o.ID = p.order_id\n"
        "WHERE o.発注番号 = 'DH00588404'\n"
        "    AND p.deleted IS NULL;\n";

    auto stmts = SQLParser::splitStatements(sql);
    ASSERT_EQ(stmts.size(), 2u) << "Expected 2 statements after splitting on ';'";

    // 1st statement: should start with SELECT (line comment removed)
    EXPECT_TRUE(stmts[0].starts_with("SELECT")) << "stmt[0]=" << stmts[0];
    EXPECT_NE(stmts[0].find("[OMS_20250515].[dbo].[orders]"), std::string::npos);
    EXPECT_NE(stmts[0].find("[OMS_20250515].[dbo].[order_subs]"), std::string::npos);
    EXPECT_NE(stmts[0].find("o.発注番号"), std::string::npos);
    EXPECT_NE(stmts[0].find("o.工場ID"), std::string::npos);
    EXPECT_NE(stmts[0].find("'DH00588404'"), std::string::npos);

    // 2nd statement: should start with SELECT COUNT(*)
    EXPECT_TRUE(stmts[1].starts_with("SELECT")) << "stmt[1]=" << stmts[1];
    EXPECT_NE(stmts[1].find("[MMS].[dbo].[products]"), std::string::npos);
    EXPECT_NE(stmts[1].find("[MMS].[dbo].[orders]"), std::string::npos);
    EXPECT_NE(stmts[1].find("existing_products"), std::string::npos);
}

// --- normalizeForCacheKey (#511) ---

TEST(NormalizeForCacheKeyTest, TrimsSurroundingWhitespace) {
    EXPECT_EQ(SQLParser::normalizeForCacheKey("  SELECT 1  "), "SELECT 1");
    EXPECT_EQ(SQLParser::normalizeForCacheKey("\tSELECT 1\r\n"), "SELECT 1");
}

TEST(NormalizeForCacheKeyTest, StripsTrailingSemicolons) {
    EXPECT_EQ(SQLParser::normalizeForCacheKey("SELECT 1;"), "SELECT 1");
    EXPECT_EQ(SQLParser::normalizeForCacheKey("SELECT 1 ; "), "SELECT 1");
    EXPECT_EQ(SQLParser::normalizeForCacheKey("SELECT 1 ;\n; "), "SELECT 1");
}

TEST(NormalizeForCacheKeyTest, PreservesInnerWhitespaceAndCase) {
    // 文字列リテラル・引用識別子は大小文字/空白が意味を持つため内部は変更しない
    EXPECT_EQ(SQLParser::normalizeForCacheKey("SELECT 'a  B' FROM \"MyTable\";"), "SELECT 'a  B' FROM \"MyTable\"");
    EXPECT_EQ(SQLParser::normalizeForCacheKey("select  *  from t"), "select  *  from t");
}

TEST(NormalizeForCacheKeyTest, PreservesSemicolonInsideStatementText) {
    // 末尾以外の ';' はそのまま (単文前提の呼び出し元契約)
    EXPECT_EQ(SQLParser::normalizeForCacheKey("SELECT ';' FROM t;"), "SELECT ';' FROM t");
}

TEST(NormalizeForCacheKeyTest, EmptyAndSemicolonOnlyInputs) {
    EXPECT_EQ(SQLParser::normalizeForCacheKey(""), "");
    EXPECT_EQ(SQLParser::normalizeForCacheKey("   "), "");
    EXPECT_EQ(SQLParser::normalizeForCacheKey(" ;; "), "");
}

TEST(NormalizeForCacheKeyTest, EquivalentVariantsProduceSameKey) {
    auto base = SQLParser::normalizeForCacheKey("SELECT * FROM users");
    EXPECT_EQ(SQLParser::normalizeForCacheKey("SELECT * FROM users;"), base);
    EXPECT_EQ(SQLParser::normalizeForCacheKey("  SELECT * FROM users  "), base);
    EXPECT_EQ(SQLParser::normalizeForCacheKey("SELECT * FROM users ;\r\n"), base);
}

}  // namespace test
}  // namespace velocitydb
