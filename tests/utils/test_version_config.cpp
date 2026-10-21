#include "utils/build_identity.h"
#include "version_config.h"

#include <regex>
#include <string>

#include <gtest/gtest.h>

TEST(VersionConfig, VersionIsNonEmpty) {
    const std::string version = velocitydb::kAppVersion;
    EXPECT_FALSE(version.empty());
}

TEST(VersionConfig, VersionMatchesSemverFormat) {
    const std::string version = velocitydb::kAppVersion;
    const std::regex semver(R"(\d+\.\d+\.\d+)");
    EXPECT_TRUE(std::regex_match(version, semver));
}

TEST(VersionConfig, BackendBuildIdentityHasCounterAndSource) {
    const std::string identity(velocitydb::backendBuildIdentity());
    const std::regex format(R"(build [1-9][0-9]* / ([0-9a-f]{12,64}(-dirty)?|unknown))");
    EXPECT_TRUE(std::regex_match(identity, format));
}
