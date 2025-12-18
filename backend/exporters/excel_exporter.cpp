#include "excel_exporter.h"

#include <stdexcept>

namespace predategrip {

bool ExcelExporter::exportData(const ResultSet& data, const std::string& filepath) {
    return exportData(data, filepath, ExportOptions());
}

bool ExcelExporter::exportData(const ResultSet& /*data*/, const std::string& /*filepath*/, const ExportOptions& /*options*/) {
    // Excel export is not yet implemented.
    // Use CSV or JSON export as alternatives.
    throw std::runtime_error("Excel export is not yet implemented. Please use CSV or JSON export instead. "
                             "Excel support will be added in a future release.");
}

}  // namespace predategrip
