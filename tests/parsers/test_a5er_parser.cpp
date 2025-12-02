#include <gtest/gtest.h>
#include "parsers/a5er_parser.h"

namespace predategrip {
namespace test {

class A5ERParserTest : public ::testing::Test {
protected:
    A5ERParser parser;
};

TEST_F(A5ERParserTest, GeneratesTableDDL) {
    A5ERTable table;
    table.name = "Users";

    A5ERColumn col1;
    col1.name = "id";
    col1.type = "INT";
    col1.nullable = false;
    col1.isPrimaryKey = true;
    table.columns.push_back(col1);

    A5ERColumn col2;
    col2.name = "name";
    col2.type = "VARCHAR";
    col2.size = 100;
    col2.nullable = true;
    col2.isPrimaryKey = false;
    table.columns.push_back(col2);

    std::string ddl = parser.generateTableDDL(table);

    EXPECT_NE(ddl.find("CREATE TABLE [Users]"), std::string::npos);
    EXPECT_NE(ddl.find("[id]"), std::string::npos);
    EXPECT_NE(ddl.find("[name]"), std::string::npos);
    EXPECT_NE(ddl.find("PRIMARY KEY"), std::string::npos);
}

TEST_F(A5ERParserTest, MapsTypesToSQLServer) {
    A5ERTable table;
    table.name = "TestTypes";

    A5ERColumn col1;
    col1.name = "text_col";
    col1.type = "string";  // A5:ER Japanese type name
    col1.size = 50;
    table.columns.push_back(col1);

    A5ERColumn col2;
    col2.name = "int_col";
    col2.type = "integer";  // A5:ER Japanese type name
    table.columns.push_back(col2);

    std::string ddl = parser.generateTableDDL(table);

    EXPECT_NE(ddl.find("NVARCHAR(50)"), std::string::npos);
    EXPECT_NE(ddl.find("INT"), std::string::npos);
}

TEST_F(A5ERParserTest, GeneratesIndexes) {
    A5ERTable table;
    table.name = "Users";

    A5ERColumn col;
    col.name = "email";
    col.type = "VARCHAR";
    col.size = 255;
    table.columns.push_back(col);

    A5ERIndex idx;
    idx.name = "IX_Users_Email";
    idx.columns.push_back("email");
    idx.isUnique = true;
    table.indexes.push_back(idx);

    std::string ddl = parser.generateTableDDL(table);

    EXPECT_NE(ddl.find("CREATE UNIQUE INDEX"), std::string::npos);
    EXPECT_NE(ddl.find("[IX_Users_Email]"), std::string::npos);
}

}  // namespace test
}  // namespace predategrip
