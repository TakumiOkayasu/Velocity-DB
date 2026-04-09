#pragma once

#include "driver_interface.h"

#include <list>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>

namespace velocitydb {

struct CachedResult {
    ResultSet data;
    size_t sizeBytes = 0;
    std::list<std::string>::iterator lruIt;
};

class ResultCache {
public:
    explicit ResultCache(size_t maxSizeBytes = 100 * 1024 * 1024) : m_maxSizeBytes(maxSizeBytes) {}
    ~ResultCache() = default;

    ResultCache(const ResultCache&) = delete;
    ResultCache& operator=(const ResultCache&) = delete;

    void put(std::string_view key, const ResultSet& result);
    [[nodiscard]] std::optional<ResultSet> get(std::string_view key);
    void invalidate(std::string_view key);
    void clear();

    [[nodiscard]] size_t getCurrentSize() const;
    [[nodiscard]] size_t getMaxSize() const noexcept { return m_maxSizeBytes; }

private:
    void evictIfNeeded(size_t requiredSize);
    [[nodiscard]] static size_t estimateSize(const ResultSet& result);

    size_t m_maxSizeBytes;
    size_t m_currentSizeBytes = 0;
    mutable std::mutex m_mutex;
    std::unordered_map<std::string, CachedResult> m_cache;
    std::list<std::string> m_lruList;  // front=oldest, back=newest
};

}  // namespace velocitydb
