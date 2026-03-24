#pragma once

#include "../interfaces/providers/search_provider.h"

#include <memory>
#include <string>
#include <string_view>

namespace velocitydb {

class IConnectionProvider;
class GlobalSearch;

/// Provider for database object search operations
class SearchProvider : public ISearchProvider {
public:
    explicit SearchProvider(IConnectionProvider& connections);
    ~SearchProvider() override;

    SearchProvider(const SearchProvider&) = delete;
    SearchProvider& operator=(const SearchProvider&) = delete;
    SearchProvider(SearchProvider&&) = delete;
    SearchProvider& operator=(SearchProvider&&) = delete;

    [[nodiscard]] std::string searchObjects(std::string_view params) override;
    [[nodiscard]] std::string quickSearch(std::string_view params) override;

private:
    IConnectionProvider& m_connections;
    std::unique_ptr<GlobalSearch> m_globalSearch;
};

}  // namespace velocitydb
