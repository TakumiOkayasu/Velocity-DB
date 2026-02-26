#pragma once

#include "../interfaces/block_detector.h"

#include <string>
#include <string_view>

namespace velocitydb {

/// COPY ... FROM stdin compound statement parts
struct CopyParts {
    std::string command;  ///< COPY ... FROM stdin; portion
    std::string data;     ///< Data lines (newline-delimited, excluding \. terminator)
};

/// IBlockDetector implementation for PostgreSQL COPY ... FROM stdin blocks
class CopyBlockDetector : public IBlockDetector {
public:
    [[nodiscard]] bool startsBlock(std::string_view statement) const override;
    [[nodiscard]] bool terminatesBlock(std::string_view line) const override;

    /// Separate a COPY compound statement into SQL command and data portions
    [[nodiscard]] static CopyParts extractParts(std::string_view compoundStatement);
};

}  // namespace velocitydb
