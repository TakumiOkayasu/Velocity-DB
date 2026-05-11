#pragma once

#include "../database/driver_interface.h"

#include <functional>
#include <string>
#include <vector>

namespace velocitydb {

class SIMDFilter {
public:
    SIMDFilter() = default;
    ~SIMDFilter() = default;

    // Filter rows based on column value
    std::vector<size_t> filterEquals(const ResultSet& data, size_t columnIndex, const std::string& value) const;

    std::vector<size_t> filterContains(const ResultSet& data, size_t columnIndex, const std::string& substring) const;

    std::vector<size_t> filterRange(const ResultSet& data, size_t columnIndex, const std::string& minValue, const std::string& maxValue) const;

    // Sort rows by column
    std::vector<size_t> sortByColumn(const ResultSet& data, size_t columnIndex, bool ascending = true) const;

    // Check if AVX2 is available
    static bool isAVX2Available();

    // SIMD-optimized string primitives. filterEquals / filterContains above
    // route through these so the AVX2 path is actually exercised at runtime.
    // Kept public so perf benchmarks can compare them against std::memcmp /
    // std::string_view::find without going through the row-loop overhead.
    bool simdStringEquals(const char* a, const char* b, size_t len) const;
    bool simdStringContains(const char* haystack, size_t haystackLen, const char* needle, size_t needleLen) const;
};

}  // namespace velocitydb
