#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

/// Interface for data export operations
class IExportProvider {
public:
    virtual ~IExportProvider() = default;

    [[nodiscard]] virtual std::string exportCSV(std::string_view params) = 0;
    [[nodiscard]] virtual std::string exportJSON(std::string_view params) = 0;
    [[nodiscard]] virtual std::string exportExcel(std::string_view params) = 0;
    [[nodiscard]] virtual std::vector<std::string> getSupportedFormats() const = 0;
};

}  // namespace velocitydb
