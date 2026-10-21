#pragma once

#include <filesystem>
#include <optional>
#include <string>

namespace velocitydb {

struct FrontendBuildIdentity {
    std::string source;
    std::string fingerprint;
};

[[nodiscard]] std::optional<FrontendBuildIdentity> readFrontendBuildIdentity(const std::filesystem::path& frontendDirectory);

}  // namespace velocitydb
