#pragma once

#include "interfaces/providers/app_settings_accessor.h"
#include "interfaces/providers/connection_profile_accessor.h"
#include "interfaces/providers/session_state_accessor.h"

namespace velocitydb {

/// Aggregate interface for settings-related responsibilities (ISP-split into 3 sub-interfaces).
/// Retained for SystemContext / ipc_handler return-type compatibility; scheduled to be
/// dissolved in #456 (Phase 4) once SystemContext exposes the sub-interfaces directly.
class ISettingsProvider
    : public IAppSettingsAccessor
    , public IConnectionProfileAccessor
    , public ISessionStateAccessor {
public:
    ~ISettingsProvider() override = default;
};

}  // namespace velocitydb
