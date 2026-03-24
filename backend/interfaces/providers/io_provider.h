#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for I/O operations (logging, file, bookmarks)
class IIOProvider {
public:
    virtual ~IIOProvider() = default;

    [[nodiscard]] virtual std::string writeFrontendLog(std::string_view params) = 0;
    [[nodiscard]] virtual std::string saveQueryToFile(std::string_view params) = 0;
    [[nodiscard]] virtual std::string loadQueryFromFile(std::string_view params) = 0;
    [[nodiscard]] virtual std::string browseFile(std::string_view params) = 0;
    [[nodiscard]] virtual std::string getBookmarks(std::string_view params) = 0;
    [[nodiscard]] virtual std::string saveBookmark(std::string_view params) = 0;
    [[nodiscard]] virtual std::string deleteBookmark(std::string_view params) = 0;
};

}  // namespace velocitydb
