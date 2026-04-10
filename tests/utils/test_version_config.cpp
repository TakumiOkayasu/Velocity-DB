#include <gtest/gtest.h>

#include "version_config.h"

#include <regex>
#include <string>

TEST(VersionConfig, VersionIsNonEmpty) {
    const std::string version = velocitydb::kAppVersion;
    EXPECT_FALSE(version.empty());
}

TEST(VersionConfig, VersionMatchesSemverFormat) {
    const std::string version = velocitydb::kAppVersion;
    const std::regex semver(R"(\d+\.\d+\.\d+)");
    EXPECT_TRUE(std::regex_match(version, semver));
}
