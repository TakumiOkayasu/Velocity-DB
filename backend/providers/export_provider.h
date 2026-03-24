#pragma once

#include "../interfaces/providers/export_provider.h"

#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

class IConnectionProvider;

/// Provider for data export operations
class ExportProvider : public IExportProvider {
public:
    explicit ExportProvider(IConnectionProvider& connections);
    ~ExportProvider() override;

    ExportProvider(const ExportProvider&) = delete;
    ExportProvider& operator=(const ExportProvider&) = delete;
    ExportProvider(ExportProvider&&) = delete;
    ExportProvider& operator=(ExportProvider&&) = delete;

    [[nodiscard]] std::string exportCSV(std::string_view params) override;
    [[nodiscard]] std::string exportJSON(std::string_view params) override;
    [[nodiscard]] std::string exportExcel(std::string_view params) override;
    [[nodiscard]] std::vector<std::string> getSupportedFormats() const override;

private:
    [[nodiscard]] std::string exportWithDriver(std::string_view params, std::string_view format);

    IConnectionProvider& m_connections;
};

}  // namespace velocitydb
