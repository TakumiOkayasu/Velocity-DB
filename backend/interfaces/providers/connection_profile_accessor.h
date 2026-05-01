#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for connection profile CRUD and credential retrieval (操作層).
/// NOTE: credential getters (getProfilePassword / getSshPassword / getSshKeyPassphrase)
/// are co-located here per issue #450 directive, but represent a secondary responsibility.
/// Re-evaluate splitting into ICredentialAccessor alongside Phase 4 (#456).
class IConnectionProfileAccessor {
public:
    virtual ~IConnectionProfileAccessor() = default;

    [[nodiscard]] virtual std::string getConnectionProfiles() = 0;
    [[nodiscard]] virtual std::string saveConnectionProfile(std::string_view params) = 0;
    [[nodiscard]] virtual std::string deleteConnectionProfile(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getProfilePassword(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getSshPassword(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getSshKeyPassphrase(std::string_view params) = 0;
};

}  // namespace velocitydb
