#include "simd_filter.h"

#include <algorithm>
#include <cstring>
#include <numeric>

#ifdef _MSC_VER
#include <immintrin.h>
#endif

namespace predategrip {

namespace {

// AVX2-optimized string equality check for 32-byte aligned data
#ifdef _MSC_VER
[[nodiscard]] bool avx2StringEquals32(const char* a, const char* b) {
    __m256i va = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(a));
    __m256i vb = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(b));
    __m256i cmp = _mm256_cmpeq_epi8(va, vb);
    return _mm256_movemask_epi8(cmp) == -1;  // All 32 bytes equal
}

// AVX2-optimized substring search using first character broadcast
[[nodiscard]] size_t avx2FindFirstChar(const char* haystack, size_t haystackLen, char needle) {
    if (haystackLen < 32) {
        // Fall back to standard search for short strings
        for (size_t i = 0; i < haystackLen; ++i) {
            if (haystack[i] == needle)
                return i;
        }
        return haystackLen;
    }

    __m256i needleVec = _mm256_set1_epi8(needle);
    size_t i = 0;

    // Process 32 bytes at a time
    for (; i + 32 <= haystackLen; i += 32) {
        __m256i chunk = _mm256_loadu_si256(reinterpret_cast<const __m256i*>(haystack + i));
        __m256i cmp = _mm256_cmpeq_epi8(chunk, needleVec);
        int mask = _mm256_movemask_epi8(cmp);
        if (mask != 0) {
            // Find position of first set bit
            unsigned long pos;
            _BitScanForward(&pos, static_cast<unsigned long>(mask));
            return i + pos;
        }
    }

    // Handle remaining bytes
    for (; i < haystackLen; ++i) {
        if (haystack[i] == needle)
            return i;
    }

    return haystackLen;
}
#endif

}  // namespace

bool SIMDFilter::isAVX2Available() {
#ifdef _MSC_VER
    int cpuInfo[4];
    __cpuid(cpuInfo, 0);
    int nIds = cpuInfo[0];

    if (nIds >= 7) {
        __cpuidex(cpuInfo, 7, 0);
        return (cpuInfo[1] & (1 << 5)) != 0;  // AVX2 bit
    }
#endif
    return false;
}

std::vector<size_t> SIMDFilter::filterEquals(const ResultSet& data, size_t columnIndex, const std::string& value) const {
    std::vector<size_t> result;
    result.reserve(data.rows.size() / 4);  // Estimate 25% match rate

    for (size_t i = 0; i < data.rows.size(); ++i) {
        if (columnIndex < data.rows[i].values.size()) {
            const auto& cellValue = data.rows[i].values[columnIndex];
            if (cellValue == value) {
                result.push_back(i);
            }
        }
    }

    return result;
}

std::vector<size_t> SIMDFilter::filterContains(const ResultSet& data, size_t columnIndex, const std::string& substring) const {
    std::vector<size_t> result;
    result.reserve(data.rows.size() / 4);

    for (size_t i = 0; i < data.rows.size(); ++i) {
        if (columnIndex < data.rows[i].values.size()) {
            const auto& cellValue = data.rows[i].values[columnIndex];
            if (cellValue.find(substring) != std::string::npos) {
                result.push_back(i);
            }
        }
    }

    return result;
}

std::vector<size_t> SIMDFilter::filterRange(const ResultSet& data, size_t columnIndex, const std::string& minValue, const std::string& maxValue) const {
    std::vector<size_t> result;
    result.reserve(data.rows.size() / 4);

    for (size_t i = 0; i < data.rows.size(); ++i) {
        if (columnIndex < data.rows[i].values.size()) {
            const auto& cellValue = data.rows[i].values[columnIndex];
            if (cellValue >= minValue && cellValue <= maxValue) {
                result.push_back(i);
            }
        }
    }

    return result;
}

std::vector<size_t> SIMDFilter::sortByColumn(const ResultSet& data, size_t columnIndex, bool ascending) const {
    std::vector<size_t> indices(data.rows.size());
    std::iota(indices.begin(), indices.end(), 0);

    auto comparator = [&](size_t a, size_t b) {
        const auto& valA = data.rows[a].values[columnIndex];
        const auto& valB = data.rows[b].values[columnIndex];

        // Try numeric comparison first
        try {
            double numA = std::stod(valA);
            double numB = std::stod(valB);
            return ascending ? (numA < numB) : (numA > numB);
        } catch (...) {
            // Fall back to string comparison
            return ascending ? (valA < valB) : (valA > valB);
        }
    };

    std::sort(indices.begin(), indices.end(), comparator);
    return indices;
}

bool SIMDFilter::simdStringEquals(const char* a, const char* b, size_t len) const {
#ifdef _MSC_VER
    if (isAVX2Available() && len >= 32) {
        // Compare 32-byte chunks using AVX2
        size_t i = 0;
        for (; i + 32 <= len; i += 32) {
            if (!avx2StringEquals32(a + i, b + i)) {
                return false;
            }
        }
        // Compare remaining bytes
        for (; i < len; ++i) {
            if (a[i] != b[i])
                return false;
        }
        return true;
    }
#endif
    return std::memcmp(a, b, len) == 0;
}

bool SIMDFilter::simdStringContains(const char* haystack, size_t haystackLen, const char* needle, size_t needleLen) const {
    if (needleLen == 0)
        return true;
    if (needleLen > haystackLen)
        return false;

#ifdef _MSC_VER
    if (isAVX2Available() && haystackLen >= 32) {
        // Use AVX2 to find first character matches, then verify full substring
        char firstChar = needle[0];
        size_t pos = 0;

        while (pos + needleLen <= haystackLen) {
            size_t found = avx2FindFirstChar(haystack + pos, haystackLen - pos, firstChar);
            if (found == haystackLen - pos) {
                return false;  // First char not found
            }
            pos += found;

            // Verify full substring match
            if (pos + needleLen <= haystackLen && std::memcmp(haystack + pos, needle, needleLen) == 0) {
                return true;
            }
            ++pos;
        }
        return false;
    }
#endif
    return std::string_view(haystack, haystackLen).find(std::string_view(needle, needleLen)) != std::string_view::npos;
}

}  // namespace predategrip
