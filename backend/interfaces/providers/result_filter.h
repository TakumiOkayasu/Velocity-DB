#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for filtering an existing result set (操作層;
/// hierarchical-architecture 命名表の許容句「責務が操作層に一致」を適用)
class IResultFilter {
public:
    virtual ~IResultFilter() = default;

    [[nodiscard]] virtual std::string filterResultSet(std::string_view params) = 0;
};

}  // namespace velocitydb
