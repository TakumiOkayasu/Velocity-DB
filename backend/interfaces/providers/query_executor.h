#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for query execution and cancellation (操作層;
/// hierarchical-architecture 命名表の許容句「責務が操作層に一致」を適用)
class IQueryExecutor {
public:
    virtual ~IQueryExecutor() = default;

    [[nodiscard]] virtual std::string executeQuery(std::string_view params) = 0;
    [[nodiscard]] virtual std::string executeQueryPaginated(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getRowCount(std::string_view params) = 0;
    [[nodiscard]] virtual std::string cancelQuery(std::string_view params) = 0;
};

}  // namespace velocitydb
