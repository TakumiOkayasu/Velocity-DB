#include "result_cache.h"
#include <algorithm>

namespace predategrip {

ResultCache::ResultCache(size_t maxSizeBytes)
    : m_maxSizeBytes(maxSizeBytes)
{
}

void ResultCache::put(const std::string& key, const ResultSet& result) {
    std::lock_guard<std::mutex> lock(m_mutex);

    size_t resultSize = estimateSize(result);

    // Remove existing entry if present
    auto it = m_cache.find(key);
    if (it != m_cache.end()) {
        m_currentSizeBytes -= it->second.sizeBytes;
        m_cache.erase(it);
    }

    evictIfNeeded(resultSize);

    CachedResult cached;
    cached.data = result;
    cached.timestamp = std::chrono::steady_clock::now();
    cached.sizeBytes = resultSize;

    m_cache[key] = std::move(cached);
    m_currentSizeBytes += resultSize;
}

std::optional<ResultSet> ResultCache::get(const std::string& key) {
    std::lock_guard<std::mutex> lock(m_mutex);

    auto it = m_cache.find(key);
    if (it != m_cache.end()) {
        it->second.timestamp = std::chrono::steady_clock::now();
        return it->second.data;
    }

    return std::nullopt;
}

void ResultCache::invalidate(const std::string& key) {
    std::lock_guard<std::mutex> lock(m_mutex);

    auto it = m_cache.find(key);
    if (it != m_cache.end()) {
        m_currentSizeBytes -= it->second.sizeBytes;
        m_cache.erase(it);
    }
}

void ResultCache::clear() {
    std::lock_guard<std::mutex> lock(m_mutex);
    m_cache.clear();
    m_currentSizeBytes = 0;
}

size_t ResultCache::getCurrentSize() const {
    std::lock_guard<std::mutex> lock(m_mutex);
    return m_currentSizeBytes;
}

size_t ResultCache::getMaxSize() const {
    return m_maxSizeBytes;
}

void ResultCache::evictIfNeeded(size_t requiredSize) {
    while (m_currentSizeBytes + requiredSize > m_maxSizeBytes && !m_cache.empty()) {
        // Find oldest entry
        auto oldest = m_cache.begin();
        for (auto it = m_cache.begin(); it != m_cache.end(); ++it) {
            if (it->second.timestamp < oldest->second.timestamp) {
                oldest = it;
            }
        }

        m_currentSizeBytes -= oldest->second.sizeBytes;
        m_cache.erase(oldest);
    }
}

size_t ResultCache::estimateSize(const ResultSet& result) const {
    size_t size = sizeof(ResultSet);

    for (const auto& col : result.columns) {
        size += col.name.size() + col.type.size() + sizeof(ColumnInfo);
    }

    for (const auto& row : result.rows) {
        size += sizeof(ResultRow);
        for (const auto& val : row.values) {
            size += val.size();
        }
    }

    return size;
}

}  // namespace predategrip
