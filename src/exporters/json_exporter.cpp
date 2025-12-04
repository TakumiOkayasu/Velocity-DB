#include "json_exporter.h"

#include <fstream>
#include <iomanip>
#include <sstream>

namespace predategrip {

bool JSONExporter::exportData(const ResultSet& data, const std::string& filepath) {
    return exportData(data, filepath, ExportOptions());
}

bool JSONExporter::exportData(const ResultSet& data, const std::string& filepath, const ExportOptions& options) {
    std::ofstream file(filepath);
    if (!file.is_open()) {
        return false;
    }

    std::string indent = m_prettyPrint ? "  " : "";
    std::string newline = m_prettyPrint ? "\n" : "";

    file << "[" << newline;

    for (size_t rowIdx = 0; rowIdx < data.rows.size(); ++rowIdx) {
        const auto& row = data.rows[rowIdx];

        file << indent << "{" << newline;

        for (size_t colIdx = 0; colIdx < data.columns.size(); ++colIdx) {
            const auto& col = data.columns[colIdx];
            const auto& value = row.values[colIdx];

            file << indent << indent << "\"" << escapeJSON(col.name) << "\": ";

            if (value.empty()) {
                file << "null";
            } else {
                // Try to determine if value is numeric
                bool isNumeric = true;
                bool hasDecimal = false;
                for (size_t i = 0; i < value.length(); ++i) {
                    char c = value[i];
                    if (c == '.') {
                        if (hasDecimal) {
                            isNumeric = false;
                            break;
                        }
                        hasDecimal = true;
                    } else if (c == '-' && i == 0) {
                        continue;
                    } else if (!std::isdigit(c)) {
                        isNumeric = false;
                        break;
                    }
                }

                if (isNumeric && !value.empty()) {
                    file << value;
                } else if (col.type == "BIT") {
                    file << (value == "1" ? "true" : "false");
                } else {
                    file << "\"" << escapeJSON(value) << "\"";
                }
            }

            if (colIdx < data.columns.size() - 1) {
                file << ",";
            }
            file << newline;
        }

        file << indent << "}";
        if (rowIdx < data.rows.size() - 1) {
            file << ",";
        }
        file << newline;
    }

    file << "]" << newline;

    return true;
}

std::string JSONExporter::escapeJSON(const std::string& value) const {
    std::ostringstream result;
    for (char c : value) {
        switch (c) {
            case '"':
                result << "\\\"";
                break;
            case '\\':
                result << "\\\\";
                break;
            case '\b':
                result << "\\b";
                break;
            case '\f':
                result << "\\f";
                break;
            case '\n':
                result << "\\n";
                break;
            case '\r':
                result << "\\r";
                break;
            case '\t':
                result << "\\t";
                break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    result << "\\u" << std::hex << std::setfill('0') << std::setw(4) << static_cast<int>(c);
                } else {
                    result << c;
                }
                break;
        }
    }
    return result.str();
}

}  // namespace predategrip
