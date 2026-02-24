#pragma once

#include <string>

namespace velocitydb {

/// ISP: Error reporting interface
class IErrorReportable {
public:
    virtual ~IErrorReportable() = default;

    IErrorReportable(const IErrorReportable&) = delete;
    IErrorReportable& operator=(const IErrorReportable&) = delete;

    [[nodiscard]] virtual std::string getLastError() const = 0;

protected:
    IErrorReportable() = default;
};

}  // namespace velocitydb
