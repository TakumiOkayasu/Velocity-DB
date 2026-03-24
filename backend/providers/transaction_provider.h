#pragma once

#include "../interfaces/providers/transaction_provider.h"

#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_map>

namespace velocitydb {

class IConnectionProvider;
class TransactionManager;

/// Provider for transaction management
class TransactionProvider : public ITransactionProvider {
public:
    explicit TransactionProvider(IConnectionProvider& connections);
    ~TransactionProvider() override;

    TransactionProvider(const TransactionProvider&) = delete;
    TransactionProvider& operator=(const TransactionProvider&) = delete;
    TransactionProvider(TransactionProvider&&) = delete;
    TransactionProvider& operator=(TransactionProvider&&) = delete;

    [[nodiscard]] std::string beginTransaction(std::string_view params) override;
    [[nodiscard]] std::string commitTransaction(std::string_view params) override;
    [[nodiscard]] std::string rollbackTransaction(std::string_view params) override;
    void cleanupConnection(std::string_view params) override;

private:
    IConnectionProvider& m_connections;
    std::mutex m_txMutex;
    std::unordered_map<std::string, std::unique_ptr<TransactionManager>> m_transactionManagers;
};

}  // namespace velocitydb
