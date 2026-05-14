#pragma once

#include "../utils/logger.h"

#include <cstdlib>
#include <format>
#include <utility>

namespace velocitydb::profile {

/// Resolve an env-gated boolean flag, evaluated **once per (EnvName, process)**.
/// Default OFF: returns false unless the variable is set to a non-empty,
/// non-"0" value. EnvName must be a NUL-terminated string literal with
/// external linkage — passing it as a template parameter materializes a
/// dedicated static cache at each instantiation site, so the hot path is
/// just a load of an already-resolved bool (no getenv, no map lookup).
template <const char* EnvName>
[[nodiscard]] inline bool isEnabledOnce() noexcept {
    static const auto enabled = []() {
        const auto* env = std::getenv(EnvName);
        return env != nullptr && env[0] != '\0' && env[0] != '0';
    }();
    return enabled;
}

/// Format and emit one INFO log line, swallowing format/log exceptions.
/// Profiling is observational: a 1M-row query that survived the hot loop
/// must not fail because the profile-line allocation failed. The format
/// call lives inside the try block since std::format itself can throw
/// (bad_alloc / format_error).
template <typename... Args>
inline void emit(std::format_string<Args...> fmt, Args&&... args) noexcept {
    try {
        get_logger().log<LogLevel::INFO>(std::format(fmt, std::forward<Args>(args)...));
    } catch (...) {
        // swallow: profiler is observational, never load-bearing
    }
}

}  // namespace velocitydb::profile
