#pragma once

#include <string_view>

namespace velocitydb {

/// ISP: Connection management interface
class IConnectable {
public:
    virtual ~IConnectable() = default;

    IConnectable(const IConnectable&) = delete;
    IConnectable& operator=(const IConnectable&) = delete;

    [[nodiscard]] virtual bool connect(std::string_view connectionString) = 0;
    virtual void disconnect() = 0;
    [[nodiscard]] virtual bool isConnected() const noexcept = 0;

protected:
    IConnectable() = default;
};

}  // namespace velocitydb
