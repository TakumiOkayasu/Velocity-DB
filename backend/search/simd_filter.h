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

    // SIMD-optimized string primitives. Public so perf benchmarks can compare
    // the AVX2 path against std::memcmp / std::string_view::find directly —
    // the public filter* methods above currently do not route through these.
    bool simdStringEquals(const char* a, const char* b, size_t len) const;
    bool simdStringContains(const char* haystack, size_t haystackLen, const char* needle, size_t needleLen) const;
};

}  // namespace velocitydb
