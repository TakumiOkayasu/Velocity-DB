#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace velocitydb {

/// Bitmask constants for search category filtering
namespace SearchCategory {
constexpr uint8_t Tables = 1 << 0;
constexpr uint8_t Views = 1 << 1;
constexpr uint8_t Procedures = 1 << 2;
constexpr uint8_t Functions = 1 << 3;
constexpr uint8_t Columns = 1 << 4;
constexpr uint8_t Indexes = 1 << 5;
constexpr uint8_t All = 0x3F;
}  // namespace SearchCategory

/// ISP: Object search query interface
class IObjectSearchable {
public:
    virtual ~IObjectSearchable() = default;

    IObjectSearchable(const IObjectSearchable&) = delete;
    IObjectSearchable& operator=(const IObjectSearchable&) = delete;

    [[nodiscard]] virtual std::string searchObjectsQuery(std::string_view pattern, bool caseSensitive, int maxResults, uint8_t categories = SearchCategory::All) const = 0;
    [[nodiscard]] virtual std::string quickSearchQuery(std::string_view prefix, int limit) const = 0;

protected:
    IObjectSearchable() = default;
};

}  // namespace velocitydb
