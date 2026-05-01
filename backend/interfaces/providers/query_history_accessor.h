#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for query history CRUD operations (操作層)
class IQueryHistoryAccessor {
public:
    virtual ~IQueryHistoryAccessor() = default;

    [[nodiscard]] virtual std::string getQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string removeQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string clearQueryHistory(std::string_view params) = 0;
    [[nodiscard]] virtual std::string setQueryHistoryFavorite(std::string_view params) = 0;
};

}  // namespace velocitydb
