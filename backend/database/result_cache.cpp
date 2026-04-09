#include "result_cache.h"

#include <climits>

namespace velocitydb {

void ResultCache::put(std::string_view key, const ResultSet& result) {
    std::lock_guard lock(m_mutex);

    auto resultSize = estimateSize(result);

    if (resultSize > m_maxSizeBytes) {
        return;
    }

    std::string keyStr(key);

    if (auto it = m_cache.find(keyStr); it != m_cache.end()) {
        m_currentSizeBytes -= it->second.sizeBytes;
        m_lruList.erase(it->second.lruIt);
        m_cache.erase(it);
    }

    evictIfNeeded(resultSize);

    m_lruList.push_back(keyStr);
    auto lruIt = std::prev(m_lruList.end());
    m_cache[keyStr] = CachedResult{.data = result, .sizeBytes = resultSize, .lruIt = lruIt};
    m_currentSizeBytes += resultSize;
}

std::optional<ResultSet> ResultCache::get(std::string_view key) {
    std::lock_guard lock(m_mutex);

    std::string keyStr(key);
    if (auto it = m_cache.find(keyStr); it != m_cache.end()) {
        m_lruList.erase(it->second.lruIt);
        m_lruList.push_back(keyStr);
        it->second.lruIt = std::prev(m_lruList.end());
        return it->second.data;
    }

    return std::nullopt;
}

void ResultCache::invalidate(std::string_view key) {
    std::lock_guard lock(m_mutex);

    std::string keyStr(key);
    if (auto it = m_cache.find(keyStr); it != m_cache.end()) {
        m_currentSizeBytes -= it->second.sizeBytes;
        m_lruList.erase(it->second.lruIt);
        m_cache.erase(it);
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

void ResultCache::evictIfNeeded(size_t requiredSize) {
    while (m_currentSizeBytes + requiredSize > m_maxSizeBytes && !m_lruList.empty()) {
        auto& oldestKey = m_lruList.front();
        if (auto it = m_cache.find(oldestKey); it != m_cache.end()) {
            m_currentSizeBytes -= it->second.sizeBytes;
            m_cache.erase(it);
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
