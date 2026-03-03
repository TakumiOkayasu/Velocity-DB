#include <gtest/gtest.h>
#include "exporters/csv_exporter.h"
#include <fstream>
#include <filesystem>

namespace velocitydb {
namespace test {

class CSVExporterTest : public ::testing::Test {
protected:
    CSVExporter exporter;
    std::string testFilePath = "test_export.csv";

    void TearDown() override {
        std::filesystem::remove(testFilePath);
    }

    /// Read next CSV line, stripping BOM (first line only) and trailing CR
    static std::string readLine(std::ifstream& file, bool stripBom = false) {
        std::string line;
        std::getline(file, line);
        if (stripBom && line.size() >= 3 && line.substr(0, 3) == "\xEF\xBB\xBF") {
            line = line.substr(3);
        }
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        return line;
    }

    ResultSet createTestResultSet() {
        ResultSet result;

        ColumnInfo col1;
        col1.name = "id";
        col1.type = "INT";
        result.columns.push_back(col1);

        ColumnInfo col2;
        col2.name = "name";
        col2.type = "VARCHAR";
        result.columns.push_back(col2);

        ResultRow row1;
        row1.values = {"1", "Alice"};
        row1.nullFlags = {false, false};
        result.rows.push_back(row1);

        ResultRow row2;
        row2.values = {"2", "Bob"};
        row2.nullFlags = {false, false};
        result.rows.push_back(row2);

        return result;
    }
};

TEST_F(CSVExporterTest, ExportsBasicCSV) {
    auto data = createTestResultSet();

    bool success = exporter.exportData(data, testFilePath);
    EXPECT_TRUE(success);

    std::ifstream file(testFilePath);
    EXPECT_TRUE(file.is_open());

    EXPECT_EQ(readLine(file, true), "\"id\",\"name\"");
    EXPECT_EQ(readLine(file), "\"1\",\"Alice\"");
    EXPECT_EQ(readLine(file), "\"2\",\"Bob\"");

    file.close();
}

TEST_F(CSVExporterTest, ExportsWithoutHeader) {
    auto data = createTestResultSet();

    ExportOptions options;
    options.includeHeader = false;

    bool success = exporter.exportData(data, testFilePath, options);
    EXPECT_TRUE(success);

    std::ifstream file(testFilePath);
    // First line should be data, not header
    EXPECT_EQ(readLine(file, true), "\"1\",\"Alice\"");

    file.close();
}

TEST_F(CSVExporterTest, EscapesQuotes) {
    ResultSet data;

    ColumnInfo col;
    col.name = "text";
    data.columns.push_back(col);

    ResultRow row;
    row.values = {"He said \"Hello\""};
    row.nullFlags = {false};
    data.rows.push_back(row);

    exporter.exportData(data, testFilePath);

    std::ifstream file(testFilePath);
    std::string content((std::istreambuf_iterator<char>(file)),
                        std::istreambuf_iterator<char>());

    EXPECT_NE(content.find("\"\"Hello\"\""), std::string::npos);

    file.close();
}

TEST_F(CSVExporterTest, HandlesNullValues) {
    ResultSet data;

    ColumnInfo col;
    col.name = "value";
    data.columns.push_back(col);

    ResultRow nullRow;
    nullRow.values = {""};
    nullRow.nullFlags = {true};  // SQL NULL
    data.rows.push_back(nullRow);

    ResultRow emptyRow;
    emptyRow.values = {""};
    emptyRow.nullFlags = {false};  // Empty string, NOT NULL
    data.rows.push_back(emptyRow);

    ExportOptions options;
    options.nullValue = "NULL";

    exporter.exportData(data, testFilePath, options);

    std::ifstream file(testFilePath);
    EXPECT_EQ(readLine(file, true), "\"value\"");   // header
    EXPECT_EQ(readLine(file), "NULL");               // SQL NULL → nullValue (unquoted marker)
    EXPECT_EQ(readLine(file), "\"\"");               // Empty string → quoted empty

    file.close();
}

TEST_F(CSVExporterTest, HandlesCustomDelimiter) {
    auto data = createTestResultSet();

    ExportOptions options;
    options.delimiter = ";";
    options.quoteStrings = false;

    exporter.exportData(data, testFilePath, options);

    std::ifstream file(testFilePath);
    EXPECT_NE(readLine(file, true).find(";"), std::string::npos);

    file.close();
}

}  // namespace test
}  // namespace velocitydb
