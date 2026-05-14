#include <gtest/gtest.h>

#include "database/pg_binary_decoder.h"

#include <array>
#include <cstdint>
#include <cstring>
#include <deque>
#include <string>
#include <string_view>

namespace velocitydb::pg_binary::test {

namespace {

// PostgreSQL binary wire format is network byte order (big-endian). Helper to
// pack a big-endian integer into a byte buffer used by the hand-built test
// payloads below.
template <typename T>
void writeBE(std::array<char, 16>& buf, int offset, T v) {
    using U = std::make_unsigned_t<T>;
    auto u = static_cast<U>(v);
    for (int i = static_cast<int>(sizeof(T)) - 1; i >= 0; --i) {
        buf[static_cast<size_t>(offset + i)] = static_cast<char>(u & 0xFF);
        u >>= 8;
    }
}

}  // namespace

// ─── bool (OID 16) ────────────────────────────────────────────────────────

TEST(PgBinaryDecoder, BoolTrue) {
    std::deque<std::string> arena;
    char raw[] = {'\x01'};
    auto v = decodeCell(16, raw, 1, arena);
    EXPECT_EQ(v, "t");
}

TEST(PgBinaryDecoder, BoolFalse) {
    std::deque<std::string> arena;
    char raw[] = {'\x00'};
    auto v = decodeCell(16, raw, 1, arena);
    EXPECT_EQ(v, "f");
}

// ─── int2 / int4 / int8 ───────────────────────────────────────────────────

TEST(PgBinaryDecoder, Int2Positive) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int16_t>(buf, 0, 12345);
    auto v = decodeCell(21, buf.data(), 2, arena);
    EXPECT_EQ(v, "12345");
}

TEST(PgBinaryDecoder, Int2Negative) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int16_t>(buf, 0, -1);
    auto v = decodeCell(21, buf.data(), 2, arena);
    EXPECT_EQ(v, "-1");
}

TEST(PgBinaryDecoder, Int4Positive) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int32_t>(buf, 0, 42);
    auto v = decodeCell(23, buf.data(), 4, arena);
    EXPECT_EQ(v, "42");
}

TEST(PgBinaryDecoder, Int4Min) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int32_t>(buf, 0, INT32_MIN);
    auto v = decodeCell(23, buf.data(), 4, arena);
    EXPECT_EQ(v, "-2147483648");
}

TEST(PgBinaryDecoder, Int8Large) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int64_t>(buf, 0, 9'223'372'036'854'775'807LL);
    auto v = decodeCell(20, buf.data(), 8, arena);
    EXPECT_EQ(v, "9223372036854775807");
}

TEST(PgBinaryDecoder, Int8Min) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int64_t>(buf, 0, INT64_MIN);
    auto v = decodeCell(20, buf.data(), 8, arena);
    EXPECT_EQ(v, "-9223372036854775808");
}

// ─── float4 / float8 ──────────────────────────────────────────────────────

TEST(PgBinaryDecoder, Float8Pi) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    const double pi = 3.141592653589793;
    uint64_t bits = 0;
    std::memcpy(&bits, &pi, sizeof(double));
    writeBE<int64_t>(buf, 0, static_cast<int64_t>(bits));
    auto v = decodeCell(701, buf.data(), 8, arena);
    // std::to_chars round-trips to shortest representation that re-parses
    // exactly — assert prefix to avoid platform-specific tail digits.
    EXPECT_TRUE(std::string(v).starts_with("3.14159265358979"));
}

TEST(PgBinaryDecoder, Float4Zero) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int32_t>(buf, 0, 0);
    auto v = decodeCell(700, buf.data(), 4, arena);
    EXPECT_EQ(v, "0");
}

// ─── text / varchar / bytea passthrough ───────────────────────────────────

TEST(PgBinaryDecoder, TextZeroCopy) {
    std::deque<std::string> arena;
    const char* raw = "hello world";
    auto v = decodeCell(25, raw, 11, arena);
    EXPECT_EQ(v, "hello world");
    // Verify zero-copy: the view must alias the input pointer, not the arena.
    EXPECT_EQ(v.data(), raw);
    EXPECT_TRUE(arena.empty());
}

TEST(PgBinaryDecoder, VarcharZeroCopy) {
    std::deque<std::string> arena;
    const char* raw = "varchar value";
    auto v = decodeCell(1043, raw, 13, arena);
    EXPECT_EQ(v, "varchar value");
    EXPECT_EQ(v.data(), raw);
}

TEST(PgBinaryDecoder, ByteaRawBytes) {
    std::deque<std::string> arena;
    char raw[] = {'\x01', '\x02', '\x03'};
    auto v = decodeCell(17, raw, 3, arena);
    EXPECT_EQ(v.size(), 3u);
    EXPECT_EQ(v[0], '\x01');
    EXPECT_EQ(v[1], '\x02');
    EXPECT_EQ(v[2], '\x03');
}

// ─── numeric (OID 1700) ───────────────────────────────────────────────────
// Header bytes (always 8): ndigits, weight, sign, dscale (each i16 big-endian).

namespace {

// Build a numeric wire payload.
std::vector<char> buildNumeric(int ndigits, int weight, uint16_t sign, int dscale, std::initializer_list<int> digits) {
    std::vector<char> out(static_cast<size_t>(8 + ndigits * 2), '\0');
    auto writeI16 = [&](int off, int v) {
        out[static_cast<size_t>(off)] = static_cast<char>((v >> 8) & 0xFF);
        out[static_cast<size_t>(off + 1)] = static_cast<char>(v & 0xFF);
    };
    writeI16(0, ndigits);
    writeI16(2, weight);
    writeI16(4, static_cast<int16_t>(sign));
    writeI16(6, dscale);
    int i = 0;
    for (int d : digits) {
        writeI16(8 + i * 2, d);
        ++i;
    }
    return out;
}

}  // namespace

TEST(PgBinaryDecoder, NumericZero) {
    std::deque<std::string> arena;
    auto buf = buildNumeric(0, 0, 0x0000, 0, {});
    auto v = decodeCell(1700, buf.data(), static_cast<int>(buf.size()), arena);
    EXPECT_EQ(v, "0");
}

TEST(PgBinaryDecoder, NumericPositiveOne) {
    std::deque<std::string> arena;
    // 1 = ndigits=1, weight=0, sign=+, dscale=0, digits=[1]
    auto buf = buildNumeric(1, 0, 0x0000, 0, {1});
    auto v = decodeCell(1700, buf.data(), static_cast<int>(buf.size()), arena);
    EXPECT_EQ(v, "1");
}

TEST(PgBinaryDecoder, NumericNegativeOne) {
    std::deque<std::string> arena;
    auto buf = buildNumeric(1, 0, 0x4000, 0, {1});
    auto v = decodeCell(1700, buf.data(), static_cast<int>(buf.size()), arena);
    EXPECT_EQ(v, "-1");
}

TEST(PgBinaryDecoder, NumericFractional) {
    std::deque<std::string> arena;
    // 1.5 = ndigits=2, weight=0, sign=+, dscale=1, digits=[1, 5000]
    auto buf = buildNumeric(2, 0, 0x0000, 1, {1, 5000});
    auto v = decodeCell(1700, buf.data(), static_cast<int>(buf.size()), arena);
    EXPECT_EQ(v, "1.5");
}

TEST(PgBinaryDecoder, NumericNaN) {
    std::deque<std::string> arena;
    auto buf = buildNumeric(0, 0, 0xC000, 0, {});
    auto v = decodeCell(1700, buf.data(), static_cast<int>(buf.size()), arena);
    EXPECT_EQ(v, "NaN");
}

TEST(PgBinaryDecoder, NumericLargeInteger) {
    std::deque<std::string> arena;
    // 12345678 = digits [1234, 5678], weight=1
    auto buf = buildNumeric(2, 1, 0x0000, 0, {1234, 5678});
    auto v = decodeCell(1700, buf.data(), static_cast<int>(buf.size()), arena);
    EXPECT_EQ(v, "12345678");
}

// ─── date / time / timestamp ──────────────────────────────────────────────

TEST(PgBinaryDecoder, DateEpoch) {
    // days since 2000-01-01 = 0 → "2000-01-01"
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int32_t>(buf, 0, 0);
    auto v = decodeCell(1082, buf.data(), 4, arena);
    EXPECT_EQ(v, "2000-01-01");
}

TEST(PgBinaryDecoder, DateSpecificDay) {
    // 2024-01-15 → days_from_2000 = 8780
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int32_t>(buf, 0, 8780);
    auto v = decodeCell(1082, buf.data(), 4, arena);
    EXPECT_EQ(v, "2024-01-15");
}

TEST(PgBinaryDecoder, TimeMidnight) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int64_t>(buf, 0, 0);
    auto v = decodeCell(1083, buf.data(), 8, arena);
    EXPECT_EQ(v, "00:00:00.000000");
}

TEST(PgBinaryDecoder, TimeNoon) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int64_t>(buf, 0, 12LL * 3600 * 1'000'000LL);
    auto v = decodeCell(1083, buf.data(), 8, arena);
    EXPECT_EQ(v, "12:00:00.000000");
}

TEST(PgBinaryDecoder, TimestampEpoch) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int64_t>(buf, 0, 0);
    auto v = decodeCell(1114, buf.data(), 8, arena);
    EXPECT_EQ(v, "2000-01-01 00:00:00.000000");
}

TEST(PgBinaryDecoder, TimestamptzEpoch) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int64_t>(buf, 0, 0);
    auto v = decodeCell(1184, buf.data(), 8, arena);
    EXPECT_EQ(v, "2000-01-01 00:00:00.000000+00");
}

TEST(PgBinaryDecoder, TimestampSpecific) {
    // 2024-01-15 10:30:45.123456 UTC
    // = days_from_2000(8780) * 86400 + (10*3600 + 30*60 + 45) sec
    constexpr int64_t kSecPerDay = 86400LL;
    constexpr int64_t kUsPerSec = 1'000'000LL;
    const int64_t sec = 8780LL * kSecPerDay + 10 * 3600 + 30 * 60 + 45;
    const int64_t us = sec * kUsPerSec + 123456LL;

    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    writeBE<int64_t>(buf, 0, us);
    auto v = decodeCell(1114, buf.data(), 8, arena);
    EXPECT_EQ(v, "2024-01-15 10:30:45.123456");
}

// ─── interval (OID 1186) ──────────────────────────────────────────────────

TEST(PgBinaryDecoder, IntervalMonthsAndDays) {
    // 1 month 2 days 03:04:05
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    const int64_t timeUs = (3LL * 3600 + 4 * 60 + 5) * 1'000'000LL;
    writeBE<int64_t>(buf, 0, timeUs);
    writeBE<int32_t>(buf, 8, 2);   // days
    writeBE<int32_t>(buf, 12, 1);  // months
    auto v = decodeCell(1186, buf.data(), 16, arena);
    EXPECT_EQ(v, "1 mon 2 days 03:04:05.000000");
}

TEST(PgBinaryDecoder, IntervalTimeOnly) {
    std::deque<std::string> arena;
    std::array<char, 16> buf{};
    const int64_t timeUs = (1LL * 3600 + 30 * 60) * 1'000'000LL;
    writeBE<int64_t>(buf, 0, timeUs);
    writeBE<int32_t>(buf, 8, 0);
    writeBE<int32_t>(buf, 12, 0);
    auto v = decodeCell(1186, buf.data(), 16, arena);
    EXPECT_EQ(v, "01:30:00.000000");
}

// ─── uuid (OID 2950) ──────────────────────────────────────────────────────

TEST(PgBinaryDecoder, UuidFixed) {
    // 12345678-9abc-def0-1234-56789abcdef0
    std::deque<std::string> arena;
    const std::array<unsigned char, 16> raw = {0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
                                               0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0};
    auto v = decodeCell(2950, reinterpret_cast<const char*>(raw.data()), 16, arena);
    EXPECT_EQ(v, "12345678-9abc-def0-1234-56789abcdef0");
}

TEST(PgBinaryDecoder, UuidZero) {
    std::deque<std::string> arena;
    char raw[16] = {};
    auto v = decodeCell(2950, raw, 16, arena);
    EXPECT_EQ(v, "00000000-0000-0000-0000-000000000000");
}

// ─── jsonb (OID 3802) — strip leading version byte ────────────────────────

TEST(PgBinaryDecoder, JsonbStripVersion) {
    std::deque<std::string> arena;
    char raw[] = {'\x01', '{', '"', 'a', '"', ':', '1', '}'};
    auto v = decodeCell(3802, raw, 8, arena);
    EXPECT_EQ(v, R"({"a":1})");
}

TEST(PgBinaryDecoder, JsonPassthrough) {
    std::deque<std::string> arena;
    const char* raw = R"({"k":"v"})";
    auto v = decodeCell(114, raw, static_cast<int>(std::strlen(raw)), arena);
    EXPECT_EQ(v, R"({"k":"v"})");
    EXPECT_EQ(v.data(), raw);  // zero-copy
}

// ─── planColumns / isBinarySupported ──────────────────────────────────────

TEST(PgBinaryDecoder, IsBinarySupportedKnownTypes) {
    EXPECT_TRUE(isBinarySupported(16));    // bool
    EXPECT_TRUE(isBinarySupported(23));    // int4
    EXPECT_TRUE(isBinarySupported(25));    // text
    EXPECT_TRUE(isBinarySupported(1114));  // timestamp
    EXPECT_TRUE(isBinarySupported(1700));  // numeric
    EXPECT_TRUE(isBinarySupported(2950));  // uuid
    EXPECT_TRUE(isBinarySupported(3802));  // jsonb
}

TEST(PgBinaryDecoder, IsBinarySupportedUnknownTypes) {
    EXPECT_FALSE(isBinarySupported(1007));  // int4[] (array)
    EXPECT_FALSE(isBinarySupported(790));   // money
    EXPECT_FALSE(isBinarySupported(829));   // macaddr
    EXPECT_FALSE(isBinarySupported(0));
}

// ─── Empty / null-like inputs (defensive bounds) ─────────────────────────

TEST(PgBinaryDecoder, EmptyTextPassthrough) {
    std::deque<std::string> arena;
    const char* raw = "";
    auto v = decodeCell(25, raw, 0, arena);
    EXPECT_TRUE(v.empty());
    EXPECT_TRUE(arena.empty());
}

// ─── Truncated payload throws (fail-fast contract) ───────────────────────

TEST(PgBinaryDecoder, NumericTruncatedThrows) {
    std::deque<std::string> arena;
    char raw[4] = {};
    EXPECT_THROW(decodeCell(1700, raw, 4, arena), std::runtime_error);
}

TEST(PgBinaryDecoder, TimestampTruncatedThrows) {
    std::deque<std::string> arena;
    char raw[4] = {};
    EXPECT_THROW(decodeCell(1114, raw, 4, arena), std::runtime_error);
}

TEST(PgBinaryDecoder, UuidTruncatedThrows) {
    std::deque<std::string> arena;
    char raw[8] = {};
    EXPECT_THROW(decodeCell(2950, raw, 8, arena), std::runtime_error);
}

TEST(PgBinaryDecoder, DateTruncatedThrows) {
    std::deque<std::string> arena;
    char raw[2] = {};
    EXPECT_THROW(decodeCell(1082, raw, 2, arena), std::runtime_error);
}

TEST(PgBinaryDecoder, TimeTruncatedThrows) {
    std::deque<std::string> arena;
    char raw[4] = {};
    EXPECT_THROW(decodeCell(1083, raw, 4, arena), std::runtime_error);
}

TEST(PgBinaryDecoder, IntervalTruncatedThrows) {
    std::deque<std::string> arena;
    char raw[8] = {};
    EXPECT_THROW(decodeCell(1186, raw, 8, arena), std::runtime_error);
}

TEST(PgBinaryDecoder, ArenaPointerStabilityAcrossInserts) {
    // Multiple decoded cells must produce string_views that remain valid even
    // as the arena grows. std::deque does not invalidate references on
    // emplace_back, so previously returned views must keep matching their
    // original text. (Regression guard against accidental std::vector swap.)
    std::deque<std::string> arena;
    std::array<char, 16> buf{};

    writeBE<int32_t>(buf, 0, 1);
    auto v1 = decodeCell(23, buf.data(), 4, arena);

    writeBE<int32_t>(buf, 0, 2);
    auto v2 = decodeCell(23, buf.data(), 4, arena);

    writeBE<int32_t>(buf, 0, 3);
    auto v3 = decodeCell(23, buf.data(), 4, arena);

    EXPECT_EQ(v1, "1");
    EXPECT_EQ(v2, "2");
    EXPECT_EQ(v3, "3");
}

}  // namespace velocitydb::pg_binary::test
