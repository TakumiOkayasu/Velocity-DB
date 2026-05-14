#pragma once

#include <libpq-fe.h>

#include <cstdint>
#include <deque>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace velocitydb::pg_binary {

/// Per-column dispatch hint produced once before the row loop.
enum class DecodeKind : uint8_t {
    Passthrough,  ///< Wire bytes are a valid UTF-8 / opaque-byte representation; alias directly.
    Decode,       ///< Requires per-cell decode; output is written into the arena.
};

struct ColumnPlan {
    DecodeKind kind;
    Oid oid;
};

/// Build a per-column dispatch plan from the PGresult's RowDescription. Returns
/// std::nullopt if any column's OID is unsupported by the binary decoder
/// (caller is expected to discard the binary PGresult and re-execute the query
/// in text protocol mode as a fallback).
[[nodiscard]] std::optional<std::vector<ColumnPlan>> planColumns(PGresult* pg) noexcept;

/// Decode one binary cell into a string_view. For Passthrough types the
/// returned view aliases the input pointer directly (no arena write). For
/// Decode types the formatted text is emplaced into `arena` and the returned
/// view references that arena entry (stable for the lifetime of the bundle).
///
/// Caller invariants:
///   * `oid` must equal the plan entry produced for this column
///   * `len` must be the libpq-reported length (PQgetlength); NULL handling is
///     done by the caller via PQgetisnull
[[nodiscard]] std::string_view decodeCell(Oid oid, const char* data, int len, std::deque<std::string>& arena);

/// True if this OID has a binary decoder. Exposed for use in fallback judgment
/// when the caller has only OIDs (not a full RowDescription) in hand.
[[nodiscard]] bool isBinarySupported(Oid oid) noexcept;

}  // namespace velocitydb::pg_binary
