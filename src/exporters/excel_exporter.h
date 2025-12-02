#pragma once

#include "data_exporter.h"

namespace predategrip {

class ExcelExporter : public DataExporter {
public:
    ExcelExporter() = default;
    ~ExcelExporter() override = default;

    bool exportData(const ResultSet& data, const std::string& filepath) override;
    bool exportData(const ResultSet& data, const std::string& filepath, const ExportOptions& options) override;

    void setSheetName(const std::string& name) { m_sheetName = name; }

private:
    std::string m_sheetName = "Sheet1";
};

}  // namespace predategrip
