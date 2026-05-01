#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for application-wide settings retrieval and update (操作層)
class IAppSettingsAccessor {
public:
    virtual ~IAppSettingsAccessor() = default;

    [[nodiscard]] virtual std::string getSettings() = 0;
    [[nodiscard]] virtual std::string updateSettings(std::string_view params) = 0;
};

}  // namespace velocitydb
