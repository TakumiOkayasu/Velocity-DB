#include "result_cache.h"

#include <ranges>

namespace predategrip {

void ResultCache::put(std::string_view key, const ResultSet& result) {
    std::lock_guard lock(m_mutex);

    auto resultSize = estimateSize(result);

    // Skip caching if result is larger than max cache size to prevent exceeding limits
    if (resultSize > m_maxSizeBytes) {
        return;
    }

    std::string keyStr(key);

    if (auto it = m_cache.find(keyStr); it != m_cache.end()) {
        m_currentSizeBytes -= it->second.sizeBytes;
        m_cache.erase(it);
    }

    evictIfNeeded(resultSize);

    m_cache[keyStr] =
        CachedResult{.data = result, .timestamp = std::chrono::steady_clock::now(), .sizeBytes = resultSize};
    m_currentSizeBytes += resultSize;
}

std::optional<ResultSet> ResultCache::get(std::string_view key) {
    std::lock_guard lock(m_mutex);

    std::string keyStr(key);
    if (auto it = m_cache.find(keyStr); it != m_cache.end()) {
        it->second.timestamp = std::chrono::steady_clock::now();
        return it->second.data;
    }

    return std::nullopt;
}

void ResultCache::invalidate(std::string_view key) {
    std::lock_guard lock(m_mutex);

    std::string keyStr(key);
    if (auto it = m_cache.find(keyStr); it != m_cache.end()) {
        m_currentSizeBytes -= it->second.sizeBytes;
        m_cache.erase(it);
    }
}

void ResultCache::clear() {
    std::lock_guard lock(m_mutex);
    m_cache.clear();
    m_currentSizeBytes = 0;
}

size_t ResultCache::getCurrentSize() const {
    std::lock_guard lock(m_mutex);
    return m_currentSizeBytes;
}

void ResultCache::evictIfNeeded(size_t requiredSize) {
    while (m_currentSizeBytes + requiredSize > m_maxSizeBytes && !m_cache.empty()) {
        auto oldest = std::ranges::min_element(
            m_cache, [](const auto& a, const auto& b) { return a.second.timestamp < b.second.timestamp; });

        m_currentSizeBytes -= oldest->second.sizeBytes;
        m_cache.erase(oldest);
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
    }

    return size;
}

}  // namespace predategrip
