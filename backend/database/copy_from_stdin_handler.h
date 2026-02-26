#pragma once

#include "../interfaces/statement_handler.h"
#include "../parsers/copy_block_detector.h"

#include <libpq-fe.h>

#include <atomic>
#include <string>

namespace velocitydb {

/// IStatementHandler for PostgreSQL COPY ... FROM stdin protocol
class CopyFromStdinHandler : public IStatementHandler {
public:
    explicit CopyFromStdinHandler(std::atomic<PGconn*>& conn, std::string& lastError);

    [[nodiscard]] bool canHandle(std::string_view sql) const override;
    [[nodiscard]] ResultSet execute(std::string_view sql) override;

private:
    std::atomic<PGconn*>& m_conn;
    std::string& m_lastError;
    CopyBlockDetector m_detector;
};

}  // namespace velocitydb
