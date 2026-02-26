#pragma once

#include <libpq-fe.h>

#include <memory>

namespace velocitydb {

/// RAII deleter for PGresult
struct PGresultDeleter {
    void operator()(PGresult* r) const {
        if (r)
            PQclear(r);
    }
};

/// Owning smart pointer for PGresult
using PGresultPtr = std::unique_ptr<PGresult, PGresultDeleter>;

}  // namespace velocitydb
