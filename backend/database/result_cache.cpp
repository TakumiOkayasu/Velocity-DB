#include "result_cache.h"

#include <climits>

namespace velocitydb {

void ResultCache::put(std::string_view key, const ResultSet& result) {
    auto copy = result;
    put(key, std::move(copy));
}

void ResultCache::put(std::string_view key, ResultSet&& result) {
    std::lock_guard lock(m_mutex);

    auto resultSize = estimateSize(result);

    if (resultSize > m_maxSizeBytes) {
        return;
    }
    ++m_putCount;

    if (auto it = m_cache.find(key); it != m_cache.end()) {
        m_currentSizeBytes -= it->second.sizeBytes;
        m_lruList.erase(it->second.lruIt);
        m_cache.erase(it);
    }

    evictIfNeeded(resultSize);

    m_lruList.emplace_back(key);
    auto lruIt = std::prev(m_lruList.end());
    m_cache.emplace(std::string(key), CachedResult{.data = std::move(result), .sizeBytes = resultSize, .lruIt = lruIt});
    m_currentSizeBytes += resultSize;
}

bool ResultCache::contains(std::string_view key) {
    std::lock_guard lock(m_mutex);
    return m_cache.find(key) != m_cache.end();
}

void ResultCache::invalidate(std::string_view key) {
    std::lock_guard lock(m_mutex);

    if (auto it = m_cache.find(key); it != m_cache.end()) {
        m_currentSizeBytes -= it->second.sizeBytes;
        m_lruList.erase(it->second.lruIt);
        m_cache.erase(it);
    }
}

void ResultCache::invalidatePrefix(std::string_view prefix) {
    std::lock_guard lock(m_mutex);

    if (prefix.empty()) {
        return;
    }
    for (auto it = m_cache.begin(); it != m_cache.end();) {
        if (it->first.starts_with(prefix)) {
            m_currentSizeBytes -= it->second.sizeBytes;
            m_lruList.erase(it->second.lruIt);
            it = m_cache.erase(it);
        } else {
            ++it;
        }
    }
}

void ResultCache::clear() {
    std::lock_guard lock(m_mutex);
    m_cache.clear();
    m_lruList.clear();
    m_currentSizeBytes = 0;
}

size_t ResultCache::getCurrentSize() const {
    std::lock_guard lock(m_mutex);
    return m_currentSizeBytes;
}

CacheStats ResultCache::getStats() const {
    std::lock_guard lock(m_mutex);
    return CacheStats{
        .hitCount = m_hitCount, .missCount = m_missCount, .putCount = m_putCount, .evictionCount = m_evictionCount, .currentSizeBytes = m_currentSizeBytes, .maxSizeBytes = m_maxSizeBytes};
}

void ResultCache::evictIfNeeded(size_t requiredSize) {
    while (m_currentSizeBytes + requiredSize > m_maxSizeBytes && !m_lruList.empty()) {
        auto& oldestKey = m_lruList.front();
        if (auto it = m_cache.find(oldestKey); it != m_cache.end()) {
            m_currentSizeBytes -= it->second.sizeBytes;
            m_cache.erase(it);
            ++m_evictionCount;
        }
        m_lruList.pop_front();
    }
}

size_t ResultCache::estimateSize(const ResultSet& result) {
    size_t size = sizeof(ResultSet);

    for (const auto& col : result.columns) {
        size += col.name.size() + col.type.size() + sizeof(ColumnInfo);
    }

    for (const auto& row : result.rows) {
        size += sizeof(ResultRow);
        for (const auto& val : row.values) {
            size += val.size();
        }
        size += (row.nullFlags.size() + CHAR_BIT - 1) / CHAR_BIT;
    }

    return size;
}

}  // namespace velocitydb
