#include "csv_exporter.h"

#include <fstream>
#include <sstream>

namespace predategrip {

bool CSVExporter::exportData(const ResultSet& data, const std::string& filepath) {
    return exportData(data, filepath, ExportOptions());
}

bool CSVExporter::exportData(const ResultSet& data, const std::string& filepath, const ExportOptions& options) {
    std::ofstream file(filepath, std::ios::binary);
    if (!file.is_open()) {
        return false;
    }

    // Write BOM for UTF-8 if needed
    if (options.encoding == "UTF-8") {
        file << "\xEF\xBB\xBF";
    }

    // Write header
    if (options.includeHeader) {
        for (size_t i = 0; i < data.columns.size(); ++i) {
            file << escapeCSV(data.columns[i].name, options);
            if (i < data.columns.size() - 1) {
                file << options.delimiter;
            }
        }
        file << options.lineEnding;
    }

    // Write rows
    for (const auto& row : data.rows) {
        for (size_t i = 0; i < row.values.size(); ++i) {
            const auto& value = row.values[i];
            if (value.empty()) {
                file << options.nullValue;
            } else {
                file << escapeCSV(value, options);
            }
            if (i < row.values.size() - 1) {
                file << options.delimiter;
            }
        }
        file << options.lineEnding;
    }

    return true;
}

std::string CSVExporter::escapeCSV(const std::string& value, const ExportOptions& options) const {
    bool needsQuote = options.quoteStrings;

    // Check if quoting is needed
    if (!needsQuote) {
        needsQuote = value.find(options.delimiter) != std::string::npos || value.find('"') != std::string::npos || value.find('\n') != std::string::npos || value.find('\r') != std::string::npos;
    }

    if (!needsQuote) {
        return value;
    }

    std::ostringstream result;
    result << '"';
    for (char c : value) {
        if (c == '"') {
            result << "\"\"";
        } else {
            result << c;
        }
    }
    result << '"';
    return result.str();
}

}  // namespace predategrip
