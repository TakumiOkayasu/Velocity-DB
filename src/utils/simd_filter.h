#pragma once

#include "../database/sqlserver_driver.h"

#include <functional>
#include <string>
#include <vector>

namespace predategrip {

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

private:
    // SIMD-optimized string comparison (when available)
    bool simdStringEquals(const char* a, const char* b, size_t len) const;
    bool simdStringContains(const char* haystack, size_t haystackLen, const char* needle, size_t needleLen) const;
};

}  // namespace predategrip
