#pragma once

#include "sqlserver_driver.h"
#include <string>
#include <unordered_map>
#include <mutex>
#include <chrono>

namespace predategrip {

struct CachedResult {
    ResultSet data;
    std::chrono::steady_clock::time_point timestamp;
    size_t sizeBytes;
};

class ResultCache {
public:
    explicit ResultCache(size_t maxSizeBytes = 100 * 1024 * 1024);  // 100MB default
    ~ResultCache() = default;

    void put(const std::string& key, const ResultSet& result);
    std::optional<ResultSet> get(const std::string& key);
    void invalidate(const std::string& key);
    void clear();

    size_t getCurrentSize() const;
    size_t getMaxSize() const;

private:
    void evictIfNeeded(size_t requiredSize);
    size_t estimateSize(const ResultSet& result) const;

    size_t m_maxSizeBytes;
    size_t m_currentSizeBytes = 0;
    mutable std::mutex m_mutex;
    std::unordered_map<std::string, CachedResult> m_cache;
};

}  // namespace predategrip
