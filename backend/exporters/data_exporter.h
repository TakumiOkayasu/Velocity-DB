#pragma once

#include "../database/sqlserver_driver.h"

#include <string>

namespace predategrip {

struct ExportOptions {
    std::string delimiter = ",";
    std::string encoding = "UTF-8";
    bool includeHeader = true;
    std::string nullValue = "";
    std::string lineEnding = "\r\n";
    bool quoteStrings = true;
};

class DataExporter {
public:
    virtual ~DataExporter() = default;
    virtual bool exportData(const ResultSet& data, const std::string& filepath) = 0;
    virtual bool exportData(const ResultSet& data, const std::string& filepath, const ExportOptions& options) = 0;
};

}  // namespace predategrip
