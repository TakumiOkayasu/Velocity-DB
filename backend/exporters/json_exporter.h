#pragma once

#include "data_exporter.h"

namespace predategrip {

class JSONExporter : public DataExporter {
public:
    JSONExporter() = default;
    ~JSONExporter() override = default;

    bool exportData(const ResultSet& data, const std::string& filepath) override;
    bool exportData(const ResultSet& data, const std::string& filepath, const ExportOptions& options) override;

    // Additional JSON-specific options
    void setPrettyPrint(bool pretty) { m_prettyPrint = pretty; }
    void setArrayFormat(bool asArray) { m_asArray = asArray; }

private:
    std::string escapeJSON(const std::string& value) const;

    bool m_prettyPrint = true;
    bool m_asArray = true;
};

}  // namespace predategrip
