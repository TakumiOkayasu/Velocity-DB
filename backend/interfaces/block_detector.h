#pragma once

#include <string_view>

namespace velocitydb {

/// ISP: Multi-line block detection for splitStatements()
/// Extension: add new IBlockDetector implementation (no splitStatements change needed)
class IBlockDetector {
public:
    virtual ~IBlockDetector() = default;

    IBlockDetector(const IBlockDetector&) = delete;
    IBlockDetector& operator=(const IBlockDetector&) = delete;

    /// Check if a statement starts a multi-line block
    [[nodiscard]] virtual bool startsBlock(std::string_view statement) const = 0;

    /// Check if a line terminates the current block
    [[nodiscard]] virtual bool terminatesBlock(std::string_view line) const = 0;

protected:
    IBlockDetector() = default;
};

}  // namespace velocitydb
