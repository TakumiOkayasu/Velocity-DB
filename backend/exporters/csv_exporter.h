#pragma once

#include "data_exporter.h"

namespace velocitydb {

class CSVExporter : public DataExporter {
public:
    CSVExporter() = default;
    ~CSVExporter() override = default;

    bool exportData(const ResultSet& data, const std::string& filepath) override;
    bool exportData(const ResultSet& data, const std::string& filepath, const ExportOptions& options) override;

private:
    [[nodiscard]] std::string escapeCSV(std::string_view value, const ExportOptions& options) const;
};

}  // namespace velocitydb
