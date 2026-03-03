#include "csv_exporter.h"

#include <fstream>
#include <sstream>

namespace velocitydb {

bool CSVExporter::exportData(const ResultSet& data, const std::string& filepath) {
    return exportData(data, filepath, ExportOptions());
}

bool CSVExporter::exportData(const ResultSet& data, const std::string& filepath, const ExportOptions& options) {
    std::ofstream file(filepath, std::ios::binary);
    if (!file.is_open()) {
        return false;
    }

    // Pre-escape nullValue: quote only when it contains CSV-special characters (not by quoteStrings)
    ExportOptions nullOpts{options};
    nullOpts.quoteStrings = false;
    auto escapedNullValue = escapeCSV(options.nullValue, nullOpts);

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
            if (row.isNull(i)) {
                file << escapedNullValue;
            } else {
                const auto& value = row.values[i];
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
    auto needsQuote = options.quoteStrings || value.contains(options.delimiter) || value.contains('"') || value.contains('\n') || value.contains('\r');

    if (!needsQuote) {
        return value;
    }

    std::string result;
    result.reserve(value.size() + 2);
    result += '"';
    for (char c : value) {
        if (c == '"') {
            result += "\"\"";
        } else {
            result += c;
        }
    }
    result += '"';
    return result;
}

}  // namespace velocitydb
