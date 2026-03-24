#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for asynchronous query execution
class IAsyncQueryProvider {
public:
    virtual ~IAsyncQueryProvider() = default;

    [[nodiscard]] virtual std::string executeAsyncQuery(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getAsyncQueryResult(std::string_view params) = 0;
    [[nodiscard]] virtual std::string cancelAsyncQuery(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getActiveQueries(std::string_view params) = 0;
    [[nodiscard]] virtual std::string removeAsyncQuery(std::string_view params) = 0;
};

}  // namespace velocitydb
