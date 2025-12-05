#include <gtest/gtest.h>
#include "exporters/csv_exporter.h"
#include <fstream>
#include <filesystem>

namespace predategrip {
namespace test {

class CSVExporterTest : public ::testing::Test {
protected:
    CSVExporter exporter;
    std::string testFilePath = "test_export.csv";

    void TearDown() override {
        std::filesystem::remove(testFilePath);
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
        result.rows.push_back(row1);

        ResultRow row2;
        row2.values = {"2", "Bob"};
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

    std::string line;
    std::getline(file, line);
    // Skip BOM if present
    if (line.substr(0, 3) == "\xEF\xBB\xBF") {
        line = line.substr(3);
    }
    // Remove trailing \r if present (Windows line ending)
    if (!line.empty() && line.back() == '\r') {
        line.pop_back();
    }
    EXPECT_EQ(line, "\"id\",\"name\"");

    std::getline(file, line);
    if (!line.empty() && line.back() == '\r') {
        line.pop_back();
    }
    EXPECT_EQ(line, "\"1\",\"Alice\"");

    std::getline(file, line);
    if (!line.empty() && line.back() == '\r') {
        line.pop_back();
    }
    EXPECT_EQ(line, "\"2\",\"Bob\"");

    file.close();
}

TEST_F(CSVExporterTest, ExportsWithoutHeader) {
    auto data = createTestResultSet();

    ExportOptions options;
    options.includeHeader = false;

    bool success = exporter.exportData(data, testFilePath, options);
    EXPECT_TRUE(success);

    std::ifstream file(testFilePath);
    std::string line;
    std::getline(file, line);
    // Skip BOM if present
    if (line.substr(0, 3) == "\xEF\xBB\xBF") {
        line = line.substr(3);
    }
    // Remove trailing \r if present (Windows line ending)
    if (!line.empty() && line.back() == '\r') {
        line.pop_back();
    }
    // First line should be data, not header
    EXPECT_EQ(line, "\"1\",\"Alice\"");

    file.close();
}

TEST_F(CSVExporterTest, EscapesQuotes) {
    ResultSet data;

    ColumnInfo col;
    col.name = "text";
    data.columns.push_back(col);

    ResultRow row;
    row.values = {"He said \"Hello\""};
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

    ResultRow row;
    row.values = {""};  // Empty string represents NULL
    data.rows.push_back(row);

    ExportOptions options;
    options.nullValue = "NULL";

    exporter.exportData(data, testFilePath, options);

    std::ifstream file(testFilePath);
    std::string content((std::istreambuf_iterator<char>(file)),
                        std::istreambuf_iterator<char>());

    EXPECT_NE(content.find("NULL"), std::string::npos);

    file.close();
}

TEST_F(CSVExporterTest, HandlesCustomDelimiter) {
    auto data = createTestResultSet();

    ExportOptions options;
    options.delimiter = ";";
    options.quoteStrings = false;

    exporter.exportData(data, testFilePath, options);

    std::ifstream file(testFilePath);
    std::string line;
    std::getline(file, line);
    // Skip BOM
    if (line.substr(0, 3) == "\xEF\xBB\xBF") {
        line = line.substr(3);
    }
    // Remove trailing \r if present (Windows line ending)
    if (!line.empty() && line.back() == '\r') {
        line.pop_back();
    }

    EXPECT_NE(line.find(";"), std::string::npos);

    file.close();
}

}  // namespace test
}  // namespace predategrip
