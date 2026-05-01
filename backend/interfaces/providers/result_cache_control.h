#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for query result cache inspection and control (操作層)
class IResultCacheControl {
public:
    virtual ~IResultCacheControl() = default;

    [[nodiscard]] virtual std::string getCacheStats(std::string_view params) = 0;
    [[nodiscard]] virtual std::string clearCache(std::string_view params) = 0;
};

}  // namespace velocitydb
