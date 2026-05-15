#pragma once

#include "../utils/encoding.h"

#include <sql.h>

#include <concepts>
#include <string>
#include <string_view>

namespace velocitydb {

static_assert(sizeof(SQLWCHAR) == sizeof(wchar_t), "SQLWCHAR and wchar_t must have the same size");

inline SQLWCHAR* toSqlWchar(wchar_t* p) {
    return reinterpret_cast<SQLWCHAR*>(p);
}
inline const wchar_t* toWchar(const SQLWCHAR* p) {
    return reinterpret_cast<const wchar_t*>(p);
}

// SQLWCHAR buffer → UTF-8 string (convenience wrapper)
inline std::string sqlWcharToUtf8(const SQLWCHAR* buf, size_t len) {
    return wideToUtf8(toWchar(buf), len);
}

/// Convert an ODBC `SQLGetData(SQL_C_WCHAR)` indicator (bytes, exclusive of
/// NUL terminator per the Microsoft ODBC spec) into a WCHAR count. Returns 0
/// for sentinel codes such as SQL_NULL_DATA / SQL_NO_TOTAL so callers can
/// treat negative indicators as "no payload" without an extra branch.
///
/// Used by SQLServerDriver to skip the O(buffer_size) NUL-terminator scan on
/// every fetched cell — see issue #589.
[[nodiscard]] inline size_t wcharCountFromIndicator(SQLLEN indicatorBytes) noexcept {
    if (indicatorBytes <= 0) {
        return 0;
    }
    return static_cast<size_t>(indicatorBytes) / sizeof(SQLWCHAR);
}

// UTF-8 string → std::wstring, ready for ODBC W APIs via toSqlWchar(result.data())
using ::velocitydb::utf8ToWide;

// ODBC APIs accept integer attribute values as SQLPOINTER (void*).
// This is by ODBC specification design; wrap the cast for clarity.
template <typename T>
    requires std::integral<T>
inline SQLPOINTER toSqlPointer(T value) {
    return reinterpret_cast<SQLPOINTER>(static_cast<uintptr_t>(value));
}

}  // namespace velocitydb
