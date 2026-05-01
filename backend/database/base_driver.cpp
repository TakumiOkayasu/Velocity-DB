#include "base_driver.h"

namespace velocitydb {

std::string BaseDriver::getLastError() const {
    std::lock_guard lock(m_executeMutex);
    return m_lastError;
}

}  // namespace velocitydb
