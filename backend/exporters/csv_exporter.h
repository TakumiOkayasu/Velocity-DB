#pragma once

#include "data_exporter.h"

namespace predategrip {

class CSVExporter : public DataExporter {
public:
    CSVExporter() = default;
    ~CSVExporter() override = default;

    bool exportData(const ResultSet& data, const std::string& filepath) override;
    bool exportData(const ResultSet& data, const std::string& filepath, const ExportOptions& options) override;

private:
    std::string escapeCSV(const std::string& value, const ExportOptions& options) const;
};

}  // namespace predategrip
