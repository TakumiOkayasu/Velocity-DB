#pragma once

#include "../interfaces/providers/transaction_provider.h"

#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>

namespace velocitydb {

class IConnectionProvider;
class TransactionManager;
class ResultCache;

/// Provider for transaction management
class TransactionProvider : public ITransactionProvider {
public:
    explicit TransactionProvider(IConnectionProvider& connections, std::shared_ptr<ResultCache> cache = nullptr);
    ~TransactionProvider() override;

    TransactionProvider(const TransactionProvider&) = delete;
    TransactionProvider& operator=(const TransactionProvider&) = delete;
    TransactionProvider(TransactionProvider&&) = delete;
    TransactionProvider& operator=(TransactionProvider&&) = delete;

    [[nodiscard]] std::string beginTransaction(std::string_view params) override;
    [[nodiscard]] std::string commitTransaction(std::string_view params) override;
    [[nodiscard]] std::string rollbackTransaction(std::string_view params) override;
    [[nodiscard]] std::string getTransactionState(std::string_view params) override;
    [[nodiscard]] bool isInTransaction(std::string_view connectionId);
    [[nodiscard]] std::shared_ptr<void> prepareQuery(std::string_view connectionId, std::string_view sql, bool autoCommit);
    void cleanupConnection(std::string_view params) override;

private:
    IConnectionProvider& m_connections;
    std::mutex m_txMutex;
    std::shared_ptr<ResultCache> m_cache;
    std::unordered_set<std::string> m_busy;
    std::unordered_map<std::string, std::unique_ptr<TransactionManager>> m_transactionManagers;
};

}  // namespace velocitydb
