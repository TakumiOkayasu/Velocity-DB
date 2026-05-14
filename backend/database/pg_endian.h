#pragma once

#include <bit>
#include <cstdint>
#include <cstring>

namespace velocitydb::pg_endian {

// libpq binary wire format is network byte order (big-endian). All multi-byte
// numeric / temporal fields arrive as raw BE bytes in PGresult buffers. Loaders
// memcpy the bytes (raw pointer may be unaligned on some platforms) and then
// byteswap if the host is little-endian. The byteswap is constexpr and lowers
// to a single `bswap` / `mov` instruction on x86-64.

namespace detail {

template <typename T>
[[nodiscard]] inline T loadBE(const char* p) noexcept {
    static_assert(std::is_trivially_copyable_v<T>);
    T v{};
    std::memcpy(&v, p, sizeof(T));
    if constexpr (std::endian::native == std::endian::little) {
        v = std::byteswap(v);
    }
    return v;
}

}  // namespace detail

[[nodiscard]] inline int16_t loadBE16(const char* p) noexcept {
    return static_cast<int16_t>(detail::loadBE<uint16_t>(p));
}

[[nodiscard]] inline int32_t loadBE32(const char* p) noexcept {
    return static_cast<int32_t>(detail::loadBE<uint32_t>(p));
}

[[nodiscard]] inline int64_t loadBE64(const char* p) noexcept {
    return static_cast<int64_t>(detail::loadBE<uint64_t>(p));
}

[[nodiscard]] inline float loadBEf32(const char* p) noexcept {
    return std::bit_cast<float>(detail::loadBE<uint32_t>(p));
}

[[nodiscard]] inline double loadBEf64(const char* p) noexcept {
    return std::bit_cast<double>(detail::loadBE<uint64_t>(p));
}

}  // namespace velocitydb::pg_endian
