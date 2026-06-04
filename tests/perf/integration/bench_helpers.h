#pragma once

#include <cstdlib>
#include <string>

namespace velocitydb::perf {

[[nodiscard]] inline std::string env(const char* name) {
    const char* v = std::getenv(name);
    return v ? std::string{v} : std::string{};
}

}  // namespace velocitydb::perf
