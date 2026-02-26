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

}  // namespace test
}  // namespace velocitydb
