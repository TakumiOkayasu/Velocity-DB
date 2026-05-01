#pragma once

#include "../interfaces/statement_handler.h"
#include "../parsers/copy_block_detector.h"

#include <libpq-fe.h>

#include <atomic>
#include <string_view>

namespace velocitydb {

/// IStatementHandler for PostgreSQL COPY ... FROM stdin protocol.
///
/// On failure, throws std::runtime_error with the libpq diagnostic message.
/// The owning driver is responsible for propagating the message to its
/// last-error cache (via try/catch around execute()), so this handler does not
/// hold any reference into the driver's mutable state and has no implicit
/// locking contract with the caller.
class CopyFromStdinHandler : public IStatementHandler {
public:
    explicit CopyFromStdinHandler(std::atomic<PGconn*>& conn);

    [[nodiscard]] bool canHandle(std::string_view sql) const override;
    [[nodiscard]] ResultSet execute(std::string_view sql) override;

private:
    std::atomic<PGconn*>& m_conn;
    CopyBlockDetector m_detector;
};

}  // namespace velocitydb
