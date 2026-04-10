#pragma once

#include "utils/transparent_hash.h"

#include <functional>
#include <string>
#include <string_view>
#include <unordered_map>

namespace velocitydb {

class ISystemContext;

/// Thin dispatcher: routes IPC requests to context methods via ISystemContext.
class IPCHandler {
public:
    explicit IPCHandler(ISystemContext& ctx);
    ~IPCHandler();

    IPCHandler(const IPCHandler&) = delete;
    IPCHandler& operator=(const IPCHandler&) = delete;
    IPCHandler(IPCHandler&&) = delete;
    IPCHandler& operator=(IPCHandler&&) = delete;

    /// Parses and dispatches an IPC request, returning a JSON response
    [[nodiscard]] std::string dispatchRequest(std::string_view request);

private:
    void registerRoutes();

    using Handler = std::function<std::string(std::string_view)>;
    std::unordered_map<std::string, Handler, TransparentStringHash, TransparentStringEqual> m_routes;
    ISystemContext& m_ctx;
};

}  // namespace velocitydb
