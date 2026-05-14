#pragma once

#include "pg_result_ptr.h"

#include <deque>
#include <string>

namespace velocitydb {

/// Storage backing for a binary-protocol PostgreSQL ResultSet.
///
/// `result` owns the PGresult (PQclear via PGresultDeleter). Text-shaped types
/// (text / varchar / bpchar / bytea / json / uuid 系列) are surfaced as
/// string_view directly into the PGresult buffer (zero-copy).
///
/// `arena` holds formatted strings for types whose binary on-wire layout differs
/// from the displayed text (numerics, timestamps, etc.). std::deque is required
/// because emplace_back preserves pointer/reference stability of existing
/// elements — std::vector would relocate on growth and invalidate every
/// string_view captured into prior ResultRows (issue #579).
struct PgResultBundle {
    PGresultPtr result;
    std::deque<std::string> arena;
};

}  // namespace velocitydb
