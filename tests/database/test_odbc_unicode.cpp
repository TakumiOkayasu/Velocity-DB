#include <gtest/gtest.h>

#include "database/odbc_unicode.h"

#include <sqlext.h>  // SQL_NO_TOTAL (not in <sql.h>)

namespace velocitydb {
namespace test {

// ODBC `SQLGetData(SQL_C_WCHAR, ..., &indicator)` returns the length of the
// data available **in bytes, exclusive of any NUL terminator** (Microsoft
// Learn: SQLGetData Function). `wcharCountFromIndicator` converts that byte
// count to a WCHAR count so the SQL Server driver can size strings in O(1)
// instead of scanning the buffer for a NUL terminator (issue #589).

TEST(WcharCountFromIndicator, ZeroBytesIsEmptyString) {
    EXPECT_EQ(wcharCountFromIndicator(0), 0u);
}

TEST(WcharCountFromIndicator, NegativeIsTreatedAsEmpty) {
    // SQL_NULL_DATA (-1) and SQL_NO_TOTAL (-4) reach this helper only if a
    // caller forgets to short-circuit them. Returning 0 keeps callers from
    // treating sentinel codes as huge unsigned counts.
    EXPECT_EQ(wcharCountFromIndicator(SQL_NULL_DATA), 0u);
    EXPECT_EQ(wcharCountFromIndicator(SQL_NO_TOTAL), 0u);
    EXPECT_EQ(wcharCountFromIndicator(-1), 0u);
}

TEST(WcharCountFromIndicator, BytesDividedBySqlWcharSize) {
    static_assert(sizeof(SQLWCHAR) == 2, "test assumes 2-byte SQLWCHAR on Windows");
    EXPECT_EQ(wcharCountFromIndicator(2), 1u);          // 1 WCHAR
    EXPECT_EQ(wcharCountFromIndicator(10), 5u);         // "Hello" length
    EXPECT_EQ(wcharCountFromIndicator(8190), 4095u);    // initial-buffer edge
}

TEST(WcharCountFromIndicator, LargeIndicatorForOneMillionRowsScenario) {
    // A varchar(max) column returning a 1MB payload would yield indicator =
    // 1'000'000 bytes; the helper must not overflow or truncate inadvertently.
    EXPECT_EQ(wcharCountFromIndicator(1'000'000), 500'000u);
}

}  // namespace test
}  // namespace velocitydb
