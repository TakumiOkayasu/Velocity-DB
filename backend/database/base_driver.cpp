#include "base_driver.h"

namespace velocitydb {

void BaseDriver::setQueryTimeout(std::chrono::seconds timeout) {
    std::lock_guard lock(m_executeMutex);
    setQueryTimeoutLocked(timeout);
}

std::string BaseDriver::getLastError() const {
    std::lock_guard lock(m_executeMutex);
    return m_lastError;
}

}  // namespace velocitydb
