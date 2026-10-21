#include "frontend_build_identity.h"

#include "simdjson.h"

#include <algorithm>
#include <array>
#include <fstream>
#include <string_view>

namespace velocitydb {
namespace {

bool isHex(std::string_view value) {
    return std::ranges::all_of(value, [](char character) { return (character >= '0' && character <= '9') || (character >= 'a' && character <= 'f'); });
}

bool isSourceRevision(std::string_view value) {
    if (value == "unknown") {
        return true;
    }
    if (value.ends_with("-dirty")) {
        value.remove_suffix(6);
    }
    return value.size() >= 12 && value.size() <= 64 && isHex(value);
}

}  // namespace

std::optional<FrontendBuildIdentity> readFrontendBuildIdentity(const std::filesystem::path& frontendDirectory) {
    // Treat absent/old/malformed metadata as unknown, never as the backend's revision.
    // Bound the read and validate text before displaying it in logs or the title.
    std::ifstream file(frontendDirectory / "build-info.json", std::ios::binary);
    std::array<char, 4097> buffer{};
    file.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
    const auto size = file.gcount();
    if (size == 0 || size == static_cast<std::streamsize>(buffer.size()) || file.bad()) {
        return std::nullopt;
    }
    simdjson::dom::parser parser;
    simdjson::dom::element document;
    if (parser.parse(buffer.data(), static_cast<size_t>(size)).get(document)) {
        return std::nullopt;
    }
    std::string_view source;
    std::string_view fingerprint;
    if (document["source"].get_string().get(source) || document["fingerprint"].get_string().get(fingerprint) || !isSourceRevision(source) || fingerprint.size() != 64 || !isHex(fingerprint)) {
        return std::nullopt;
    }
    return FrontendBuildIdentity{std::string(source), std::string(fingerprint)};
}

}  // namespace velocitydb
