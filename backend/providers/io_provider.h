#pragma once

#include "../interfaces/providers/io_provider.h"

#include <atomic>
#include <mutex>
#include <string>
#include <string_view>

namespace velocitydb {

/// Provider for I/O operations (logging, file, bookmarks)
class IOProvider : public IIOProvider {
public:
    IOProvider() = default;
    ~IOProvider() override = default;

    IOProvider(const IOProvider&) = delete;
    IOProvider& operator=(const IOProvider&) = delete;
    IOProvider(IOProvider&&) = delete;
    IOProvider& operator=(IOProvider&&) = delete;

    [[nodiscard]] std::string writeFrontendLog(std::string_view params) override;
    [[nodiscard]] std::string saveQueryToFile(std::string_view params) override;
    [[nodiscard]] std::string loadQueryFromFile(std::string_view params) override;
    [[nodiscard]] std::string browseFile(std::string_view params) override;
    [[nodiscard]] std::string getBookmarks(std::string_view params) override;
    [[nodiscard]] std::string saveBookmark(std::string_view params) override;
    [[nodiscard]] std::string deleteBookmark(std::string_view params) override;

private:
    std::atomic<bool> m_firstLogWrite{true};
    std::mutex m_logMutex;
};

}  // namespace velocitydb
