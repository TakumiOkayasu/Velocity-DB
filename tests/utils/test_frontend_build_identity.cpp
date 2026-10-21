#include "utils/frontend_build_identity.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

class FrontendBuildIdentityTest : public ::testing::Test {
protected:
    void SetUp() override {
        directory = std::filesystem::temp_directory_path() /
                    ("velocitydb-build-identity-" + std::to_string(std::random_device{}()) + "-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
        std::filesystem::create_directories(directory);
    }

    void TearDown() override {
        std::error_code error;
        std::filesystem::remove_all(directory, error);
    }

    void write(std::string_view contents, const std::filesystem::path& target = {}) const {
        std::ofstream file((target.empty() ? directory : target) / "build-info.json");
        file << contents;
    }

    std::string manifest(std::string_view source = "123456789abc-dirty") const { return "{\"source\":\"" + std::string(source) + "\",\"fingerprint\":\"" + fingerprint + "\"}"; }

    const std::string fingerprint = std::string(64, 'a');
    std::filesystem::path directory;
};

TEST_F(FrontendBuildIdentityTest, ReadsIdentityFromSelectedDirectoryOnly) {
    write(manifest());
    const auto identity = readFrontendBuildIdentity(directory);
    ASSERT_TRUE(identity);
    EXPECT_EQ(identity->source, "123456789abc-dirty");
    EXPECT_EQ(identity->fingerprint, fingerprint);

    const auto other = directory / "another-dist";
    std::filesystem::create_directory(other);
    write(manifest("abcdef123456"), other);
    EXPECT_EQ(readFrontendBuildIdentity(other)->source, "abcdef123456");
    EXPECT_EQ(readFrontendBuildIdentity(directory)->source, "123456789abc-dirty");
}

TEST_F(FrontendBuildIdentityTest, AllowsSourceArchiveWithUnknownRevision) {
    write(manifest("unknown"));
    const auto identity = readFrontendBuildIdentity(directory);
    ASSERT_TRUE(identity);
    EXPECT_EQ(identity->source, "unknown");
    EXPECT_EQ(identity->fingerprint, fingerprint);
}

TEST_F(FrontendBuildIdentityTest, MissingOrInvalidMetadataRemainsUnknown) {
    EXPECT_FALSE(readFrontendBuildIdentity(directory));
    for (const auto& contents : {std::string{}, std::string("not JSON"), std::string("{}"), std::string("[]"), manifest("bad\\nsource"), manifest(""),
                                 std::string("{\"source\":42,\"fingerprint\":\"bad\"}"), std::string(4097, ' ')}) {
        write(contents);
        EXPECT_FALSE(readFrontendBuildIdentity(directory)) << contents.substr(0, 100);
    }
    auto invalidFingerprint = manifest();
    invalidFingerprint.replace(invalidFingerprint.find(fingerprint), fingerprint.size(), "not-a-hash");
    write(invalidFingerprint);
    EXPECT_FALSE(readFrontendBuildIdentity(directory));
}

}  // namespace
}  // namespace velocitydb
