#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for database object search operations
class ISearchProvider {
public:
    virtual ~ISearchProvider() = default;

    [[nodiscard]] virtual std::string searchObjects(std::string_view params) = 0;
    [[nodiscard]] virtual std::string quickSearch(std::string_view params) = 0;
};

}  // namespace velocitydb
