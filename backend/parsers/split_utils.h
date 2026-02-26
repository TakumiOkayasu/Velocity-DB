#pragma once

#include "../database/driver_interface.h"
#include "copy_block_detector.h"
#include "sql_parser.h"

#include <string>
#include <string_view>
#include <vector>

namespace velocitydb {

/// Split SQL statements with driver-appropriate block detection
[[nodiscard]] inline std::vector<std::string> splitStatementsForDriver(std::string_view sql, DriverType driverType) {
    if (driverType == DriverType::PostgreSQL) {
        CopyBlockDetector detector;
        const IBlockDetector* detectors[] = {&detector};
        return SQLParser::splitStatements(sql, detectors);
    }
    return SQLParser::splitStatements(sql);
}

}  // namespace velocitydb
