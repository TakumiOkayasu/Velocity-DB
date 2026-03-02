#include "copy_from_stdin_handler.h"

#include "pg_result_ptr.h"

#include <algorithm>
#include <charconv>
#include <chrono>
#include <cstring>
#include <format>
#include <stdexcept>

namespace velocitydb {

CopyFromStdinHandler::CopyFromStdinHandler(std::atomic<PGconn*>& conn, std::string& lastError) : m_conn(conn), m_lastError(lastError) {}

bool CopyFromStdinHandler::canHandle(std::string_view sql) const {
    return m_detector.startsBlock(sql);
}

ResultSet CopyFromStdinHandler::execute(std::string_view sql) {
    const auto startTime = std::chrono::high_resolution_clock::now();
    auto [copyCmd, data] = CopyBlockDetector::extractParts(sql);

    auto* conn = m_conn.load(std::memory_order_acquire);

    // 1. Execute COPY command -> transition to PGRES_COPY_IN state
    PGresultPtr initResult(PQexec(conn, copyCmd.c_str()));
    if (PQresultStatus(initResult.get()) != PGRES_COPY_IN) {
        m_lastError = PQresultErrorMessage(initResult.get());
        if (m_lastError.empty())
            m_lastError = std::format("Expected COPY_IN state, got: {}", PQresStatus(PQresultStatus(initResult.get())));
        throw std::runtime_error(m_lastError);
    }

    // 2. Send data in chunks (avoid INT_MAX overflow for large payloads)
    if (!data.empty()) {
        constexpr size_t kChunkSize = 1024 * 1024;  // 1MB
        for (size_t offset = 0; offset < data.size(); offset += kChunkSize) {
            auto chunkLen = std::min(kChunkSize, data.size() - offset);
            if (PQputCopyData(conn, data.c_str() + offset, static_cast<int>(chunkLen)) != 1) {
                m_lastError = PQerrorMessage(conn);
                PQputCopyEnd(conn, "client error");
                PGresultPtr drain(PQgetResult(conn));
                throw std::runtime_error(m_lastError);
            }
        }
    }

    // 3. Signal COPY completion
    if (PQputCopyEnd(conn, nullptr) != 1) {
        m_lastError = PQerrorMessage(conn);
        throw std::runtime_error(m_lastError);
    }

    // 4. Get final result
    PGresultPtr finalResult(PQgetResult(conn));
    auto status = PQresultStatus(finalResult.get());
    if (status != PGRES_COMMAND_OK) {
        m_lastError = PQresultErrorMessage(finalResult.get());
        if (m_lastError.empty())
            m_lastError = std::format("COPY failed with status: {}", PQresStatus(status));
        throw std::runtime_error(m_lastError);
    }

    // 5. Build ResultSet
    ResultSet result;
    const char* cmdTuples = PQcmdTuples(finalResult.get());
    if (cmdTuples && cmdTuples[0] != '\0') {
        int64_t rows = 0;
        std::from_chars(cmdTuples, cmdTuples + std::strlen(cmdTuples), rows);
        result.affectedRows = rows;
    }

    const auto endTime = std::chrono::high_resolution_clock::now();
    const auto duration = std::chrono::duration_cast<std::chrono::microseconds>(endTime - startTime);
    result.executionTimeMs = static_cast<double>(duration.count()) / 1000.0;

    return result;
}

}  // namespace velocitydb
