#include "simd_filter.h"
#include <algorithm>
#include <numeric>

#ifdef _MSC_VER
#include <intrin.h>
#endif

namespace predategrip {

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

std::vector<size_t> SIMDFilter::filterEquals(
    const ResultSet& data,
    size_t columnIndex,
    const std::string& value) const
{
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

std::vector<size_t> SIMDFilter::filterContains(
    const ResultSet& data,
    size_t columnIndex,
    const std::string& substring) const
{
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

std::vector<size_t> SIMDFilter::filterRange(
    const ResultSet& data,
    size_t columnIndex,
    const std::string& minValue,
    const std::string& maxValue) const
{
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

std::vector<size_t> SIMDFilter::sortByColumn(
    const ResultSet& data,
    size_t columnIndex,
    bool ascending) const
{
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
    // TODO: Implement AVX2 optimized comparison
    return std::memcmp(a, b, len) == 0;
}

bool SIMDFilter::simdStringContains(const char* haystack, size_t haystackLen,
                                    const char* needle, size_t needleLen) const {
    // TODO: Implement AVX2 optimized search
    return std::string_view(haystack, haystackLen).find(std::string_view(needle, needleLen))
           != std::string_view::npos;
}

}  // namespace predategrip
