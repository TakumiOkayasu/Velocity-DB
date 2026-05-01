#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for session state persistence (操作層)
class ISessionStateAccessor {
public:
    virtual ~ISessionStateAccessor() = default;

    [[nodiscard]] virtual std::string getSessionState() = 0;
    [[nodiscard]] virtual std::string saveSessionState(std::string_view params) = 0;
};

}  // namespace velocitydb
