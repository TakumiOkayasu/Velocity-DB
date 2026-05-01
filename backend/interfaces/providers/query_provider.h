#pragma once

#include "interfaces/providers/dialect_sql_builder.h"
#include "interfaces/providers/query_executor.h"
#include "interfaces/providers/query_history_accessor.h"
#include "interfaces/providers/result_cache_control.h"
#include "interfaces/providers/result_filter.h"

namespace velocitydb {

/// Aggregate interface for query-related responsibilities (ISP-split into 5 sub-interfaces).
/// Retained for SystemContext / ipc_handler return-type compatibility; scheduled to be
/// dissolved in #456 (Phase 4) once SystemContext exposes the sub-interfaces directly.
class IQueryProvider
    : public IQueryExecutor
    , public IResultFilter
    , public IResultCacheControl
    , public IQueryHistoryAccessor
    , public IDialectSqlBuilder {
public:
    ~IQueryProvider() override = default;
};

}  // namespace velocitydb
