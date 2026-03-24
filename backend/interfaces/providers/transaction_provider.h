#pragma once

#include <string>
#include <string_view>

namespace velocitydb {

/// Interface for transaction management
class ITransactionProvider {
public:
    virtual ~ITransactionProvider() = default;

    [[nodiscard]] virtual std::string beginTransaction(std::string_view params) = 0;
    [[nodiscard]] virtual std::string commitTransaction(std::string_view params) = 0;
    [[nodiscard]] virtual std::string rollbackTransaction(std::string_view params) = 0;

    /// Remove transaction state for a disconnected connection (params = JSON with connectionId)
    virtual void cleanupConnection(std::string_view params) = 0;
};

}  // namespace velocitydb
