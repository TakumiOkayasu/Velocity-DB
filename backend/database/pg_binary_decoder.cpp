#include "pg_binary_decoder.h"

#include "pg_endian.h"

#include <array>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <format>
#include <stdexcept>

namespace velocitydb::pg_binary {

namespace {

// PostgreSQL OID literals — taken from src/include/catalog/pg_type.dat
constexpr Oid kOidBool = 16;
constexpr Oid kOidBytea = 17;
constexpr Oid kOidInt8 = 20;
constexpr Oid kOidInt2 = 21;
constexpr Oid kOidInt4 = 23;
constexpr Oid kOidText = 25;
constexpr Oid kOidJson = 114;
constexpr Oid kOidFloat4 = 700;
constexpr Oid kOidFloat8 = 701;
constexpr Oid kOidBpchar = 1042;
constexpr Oid kOidVarchar = 1043;
constexpr Oid kOidDate = 1082;
constexpr Oid kOidTime = 1083;
constexpr Oid kOidTimestamp = 1114;
constexpr Oid kOidTimestamptz = 1184;
constexpr Oid kOidInterval = 1186;
constexpr Oid kOidNumeric = 1700;
constexpr Oid kOidUuid = 2950;
constexpr Oid kOidJsonb = 3802;

[[nodiscard]] bool isPassthroughOid(Oid oid) noexcept {
    switch (oid) {
        case kOidText:
        case kOidVarchar:
        case kOidBpchar:
        case kOidBytea:
        case kOidJson:
            return true;
        default:
            return false;
    }
}

// ─── Integer / boolean ────────────────────────────────────────────────────

std::string formatInt64(int64_t v) {
    std::array<char, 32> buf{};
    auto [end, ec] = std::to_chars(buf.data(), buf.data() + buf.size(), v);
    return std::string(buf.data(), end);
}

// ─── Float ────────────────────────────────────────────────────────────────

template <typename T>
std::string formatFloat(T v) {
    std::array<char, 64> buf{};
    // std::to_chars handles NaN/Inf and never exhausts a 64-byte buffer for
    // double/float, so the std::errc path is unreachable in practice.
    auto [end, ec] = std::to_chars(buf.data(), buf.data() + buf.size(), v);
    return std::string(buf.data(), end);
}

// ─── Numeric ──────────────────────────────────────────────────────────────
// Wire layout (PostgreSQL src/backend/utils/adt/numeric.c, numeric_send):
//   int16 ndigits   // count of base-10000 digits
//   int16 weight    // weight of first digit in base-10000 places (signed)
//   int16 sign      // 0x0000 + / 0x4000 - / 0xC000 NaN / 0xD000 +Inf / 0xF000 -Inf
//   int16 dscale    // number of decimal digits after the point
//   int16 digits[ndigits]

std::string formatNumeric(const char* data, int len) {
    if (len < 8)
        throw std::runtime_error("pg_binary: numeric payload truncated (header)");
    const int ndigits = pg_endian::loadBE16(data);
    const int weight = pg_endian::loadBE16(data + 2);
    const auto signRaw = static_cast<uint16_t>(pg_endian::loadBE16(data + 4));
    const int dscale = pg_endian::loadBE16(data + 6);

    if (signRaw == 0xC000U)
        return std::string("NaN");
    if (signRaw == 0xD000U)
        return std::string("Infinity");
    if (signRaw == 0xF000U)
        return std::string("-Infinity");

    if (ndigits == 0) {
        // Special case: literal zero. dscale may still request fractional digits.
        if (dscale <= 0)
            return std::string("0");
        std::string out("0.");
        out.append(static_cast<size_t>(dscale), '0');
        return out;
    }

    std::string out;
    out.reserve(static_cast<size_t>(ndigits) * 4 + static_cast<size_t>(dscale) + 4);
    if (signRaw == 0x4000U)
        out.push_back('-');

    int digitIdx = 0;
    if (weight < 0) {
        out.push_back('0');
    } else {
        // First base-10000 digit is emitted without leading zeros.
        const int firstDigit = digitIdx < ndigits ? pg_endian::loadBE16(data + 8 + digitIdx * 2) : 0;
        out += std::to_string(firstDigit);
        ++digitIdx;
        for (int i = 1; i <= weight; ++i, ++digitIdx) {
            const int v = digitIdx < ndigits ? pg_endian::loadBE16(data + 8 + digitIdx * 2) : 0;
            std::array<char, 5> buf{};
            // Each base-10000 digit is in [0, 9999] per PG numeric_send.
            std::format_to_n(buf.data(), 4, "{:04}", v);
            out.append(buf.data(), 4);
        }
    }

    if (dscale > 0) {
        out.push_back('.');
        int written = 0;
        while (written < dscale) {
            const int v = digitIdx < ndigits ? pg_endian::loadBE16(data + 8 + digitIdx * 2) : 0;
            std::array<char, 5> buf{};
            // Each base-10000 digit is in [0, 9999] per PG numeric_send.
            std::format_to_n(buf.data(), 4, "{:04}", v);
            const int take = std::min(4, dscale - written);
            out.append(buf.data(), static_cast<size_t>(take));
            written += take;
            ++digitIdx;
        }
    }
    return out;
}

// ─── Date / time / timestamp ─────────────────────────────────────────────
// PostgreSQL temporal binary representation assumes integer_datetimes (forced
// on since 10.0 — float datetimes build is gone). All values are int64 µs (or
// int32 days for date) since 2000-01-01 00:00:00 UTC.

constexpr int64_t kPgEpochUnixSec = 946684800LL;  // 2000-01-01 UTC in unix seconds
constexpr int kPgEpochUnixDays = 10957;           // (kPgEpochUnixSec / 86400)
constexpr int64_t kUsPerSec = 1'000'000LL;
constexpr int64_t kSecPerDay = 86400LL;

struct YearMonthDay {
    int year;
    unsigned month;
    unsigned day;
};

[[nodiscard]] YearMonthDay daysToYmd(int64_t unixDays) noexcept {
    using namespace std::chrono;
    const sys_days sd{days{unixDays}};
    const year_month_day ymd{sd};
    return {static_cast<int>(static_cast<int>(ymd.year())), static_cast<unsigned>(ymd.month()), static_cast<unsigned>(ymd.day())};
}

std::string formatDate(const char* data, int len) {
    if (len < 4)
        throw std::runtime_error("pg_binary: date payload truncated");
    const int32_t daysSincePgEpoch = pg_endian::loadBE32(data);
    const int64_t unixDays = static_cast<int64_t>(daysSincePgEpoch) + kPgEpochUnixDays;
    const auto ymd = daysToYmd(unixDays);
    return std::format("{:04}-{:02}-{:02}", ymd.year, ymd.month, ymd.day);
}

std::string formatTime(const char* data, int len) {
    if (len < 8)
        throw std::runtime_error("pg_binary: time payload truncated");
    // PG time (OID 1083) is microseconds within [0, 86400000000); negative or
    // 24h-over values are protocol violations and not validated here.
    const int64_t us = pg_endian::loadBE64(data);
    const int64_t totalSec = us / kUsPerSec;
    const int64_t fracUs = us - totalSec * kUsPerSec;
    const int h = static_cast<int>(totalSec / 3600);
    const int m = static_cast<int>((totalSec / 60) % 60);
    const int s = static_cast<int>(totalSec % 60);
    return std::format("{:02}:{:02}:{:02}.{:06}", h, m, s, fracUs);
}

std::string formatTimestamp(const char* data, int len, bool withTz) {
    if (len < 8)
        throw std::runtime_error("pg_binary: timestamp payload truncated");
    const int64_t usSincePgEpoch = pg_endian::loadBE64(data);

    // Floor-divide microseconds into (seconds, remainder_us) to keep the
    // remainder non-negative even for pre-epoch values.
    int64_t sec = usSincePgEpoch / kUsPerSec;
    int64_t fracUs = usSincePgEpoch - sec * kUsPerSec;
    if (fracUs < 0) {
        fracUs += kUsPerSec;
        sec -= 1;
    }

    const int64_t unixSec = kPgEpochUnixSec + sec;
    int64_t unixDays = unixSec / kSecPerDay;
    int64_t timeInDay = unixSec - unixDays * kSecPerDay;
    if (timeInDay < 0) {
        timeInDay += kSecPerDay;
        unixDays -= 1;
    }

    const auto ymd = daysToYmd(unixDays);
    const int h = static_cast<int>(timeInDay / 3600);
    const int m = static_cast<int>((timeInDay / 60) % 60);
    const int s = static_cast<int>(timeInDay % 60);
    return std::format("{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:06}{}", ymd.year, ymd.month, ymd.day, h, m, s, fracUs, withTz ? "+00" : "");
}

// ─── Interval ─────────────────────────────────────────────────────────────
// Wire layout (src/backend/utils/adt/timestamp.c, interval_send):
//   int64 time   (microseconds within day)
//   int32 day
//   int32 month

std::string formatInterval(const char* data, int len) {
    if (len < 16)
        throw std::runtime_error("pg_binary: interval payload truncated");
    const int64_t timeUs = pg_endian::loadBE64(data);
    const int32_t day = pg_endian::loadBE32(data + 8);
    const int32_t month = pg_endian::loadBE32(data + 12);

    int64_t sec = timeUs / kUsPerSec;
    int64_t fracUs = timeUs - sec * kUsPerSec;
    bool neg = false;
    if (sec < 0 || (sec == 0 && fracUs < 0)) {
        neg = true;
        sec = -sec;
        if (fracUs < 0) {
            fracUs = -fracUs;
        }
    }
    const int h = static_cast<int>(sec / 3600);
    const int m = static_cast<int>((sec / 60) % 60);
    const int s = static_cast<int>(sec % 60);

    // PostgreSQL EncodeInterval pluralizes mon/mons and day/days (postgres
    // src/backend/utils/adt/datetime.c).
    auto pluralize = [](int32_t v, const char* singular, const char* plural) { return (v == 1 || v == -1) ? singular : plural; };

    std::string out;
    out.reserve(64);
    if (month != 0)
        out += std::format("{} {}", month, pluralize(month, "mon", "mons"));
    if (day != 0) {
        if (!out.empty())
            out.push_back(' ');
        out += std::format("{} {}", day, pluralize(day, "day", "days"));
    }
    if (timeUs != 0 || out.empty()) {
        if (!out.empty())
            out.push_back(' ');
        if (neg)
            out.push_back('-');
        out += std::format("{:02}:{:02}:{:02}.{:06}", h, m, s, fracUs);
    }
    return out;
}

// ─── UUID ─────────────────────────────────────────────────────────────────
// Wire layout: 16 raw bytes, printed as 8-4-4-4-12 lowercase hex.

std::string formatUuid(const char* data, int len) {
    if (len < 16)
        throw std::runtime_error("pg_binary: uuid payload truncated");
    static constexpr char kHex[] = "0123456789abcdef";
    std::string out(36, '-');
    static constexpr int kDashAt[] = {8, 13, 18, 23};
    int dashIdx = 0;
    int outPos = 0;
    for (int i = 0; i < 16; ++i) {
        if (dashIdx < 4 && outPos == kDashAt[dashIdx]) {
            ++outPos;
            ++dashIdx;
        }
        const auto b = static_cast<uint8_t>(data[i]);
        out[outPos++] = kHex[(b >> 4) & 0xF];
        out[outPos++] = kHex[b & 0xF];
        if (dashIdx < 4 && outPos == kDashAt[dashIdx]) {
            ++outPos;
            ++dashIdx;
        }
    }
    return out;
}

}  // namespace

bool isBinarySupported(Oid oid) noexcept {
    switch (oid) {
        case kOidBool:
        case kOidBytea:
        case kOidInt8:
        case kOidInt2:
        case kOidInt4:
        case kOidText:
        case kOidJson:
        case kOidFloat4:
        case kOidFloat8:
        case kOidBpchar:
        case kOidVarchar:
        case kOidDate:
        case kOidTime:
        case kOidTimestamp:
        case kOidTimestamptz:
        case kOidInterval:
        case kOidNumeric:
        case kOidUuid:
        case kOidJsonb:
            return true;
        default:
            return false;
    }
}

std::optional<std::vector<ColumnPlan>> planColumns(PGresult* pg) noexcept {
    if (!pg)
        return std::nullopt;
    const int n = PQnfields(pg);
    std::vector<ColumnPlan> plan;
    plan.reserve(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) {
        const Oid oid = PQftype(pg, i);
        if (!isBinarySupported(oid))
            return std::nullopt;
        const DecodeKind kind = isPassthroughOid(oid) ? DecodeKind::Passthrough : DecodeKind::Decode;
        plan.push_back({kind, oid});
    }
    return plan;
}

std::string_view decodeCell(Oid oid, const char* data, int len, std::deque<std::string>& arena) {
    if (isPassthroughOid(oid)) {
        // Wire bytes already form a valid UTF-8 / opaque-byte payload.
        return std::string_view{data, static_cast<size_t>(len < 0 ? 0 : len)};
    }

    std::string formatted;
    switch (oid) {
        case kOidBool:
            // 1 byte: 0x01 → "t", 0x00 → "f". PG accepts t/f for input.
            return (len >= 1 && data[0] != 0) ? std::string_view{"t", 1} : std::string_view{"f", 1};
        case kOidInt2:
            formatted = formatInt64(len >= 2 ? pg_endian::loadBE16(data) : 0);
            break;
        case kOidInt4:
            formatted = formatInt64(len >= 4 ? pg_endian::loadBE32(data) : 0);
            break;
        case kOidInt8:
            formatted = formatInt64(len >= 8 ? pg_endian::loadBE64(data) : 0);
            break;
        case kOidFloat4:
            formatted = formatFloat(len >= 4 ? pg_endian::loadBEf32(data) : 0.0f);
            break;
        case kOidFloat8:
            formatted = formatFloat(len >= 8 ? pg_endian::loadBEf64(data) : 0.0);
            break;
        case kOidNumeric:
            formatted = formatNumeric(data, len);
            break;
        case kOidDate:
            formatted = formatDate(data, len);
            break;
        case kOidTime:
            formatted = formatTime(data, len);
            break;
        case kOidTimestamp:
            formatted = formatTimestamp(data, len, /*withTz=*/false);
            break;
        case kOidTimestamptz:
            formatted = formatTimestamp(data, len, /*withTz=*/true);
            break;
        case kOidInterval:
            formatted = formatInterval(data, len);
            break;
        case kOidUuid:
            formatted = formatUuid(data, len);
            break;
        case kOidJsonb: {
            // First byte is version (must be 1 per PostgreSQL docs); strip it.
            const int payloadLen = len > 1 ? len - 1 : 0;
            formatted.assign(data + 1, static_cast<size_t>(payloadLen));
            break;
        }
        default:
            // Caller is responsible for filtering via planColumns() — reaching
            // here means a contract violation upstream.
            throw std::runtime_error("pg_binary::decodeCell: unsupported OID");
    }

    arena.emplace_back(std::move(formatted));
    return std::string_view{arena.back()};
}

}  // namespace velocitydb::pg_binary
