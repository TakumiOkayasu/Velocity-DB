#pragma once

#include "../database/driver_interface.h"

#include <string_view>

namespace velocitydb {

/// ISP: Special SQL execution protocol handler
/// Extension: add new IStatementHandler implementation + register in driver (no execute change needed)
class IStatementHandler {
public:
    virtual ~IStatementHandler() = default;

    IStatementHandler(const IStatementHandler&) = delete;
    IStatementHandler& operator=(const IStatementHandler&) = delete;

    [[nodiscard]] virtual bool canHandle(std::string_view sql) const = 0;
    [[nodiscard]] virtual ResultSet execute(std::string_view sql) = 0;

protected:
    IStatementHandler() = default;
};

}  // namespace velocitydb
