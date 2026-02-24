#pragma once

#include "../database/driver_interface.h"

#include <string_view>

namespace velocitydb {

/// ISP: Query execution interface
/// Note: Defined in driver_interface.h; this header is a convenience re-export.
/// Consumers that depend only on IQueryExecutable should include this header
/// to express minimal dependency (ISP).

}  // namespace velocitydb
