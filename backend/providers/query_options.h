#pragma once

#include "../utils/json_utils.h"
#include "simdjson.h"

#include <stdexcept>

namespace velocitydb {

struct QueryOptions {
    bool autoCommit = true;
    size_t maxRows = JsonUtils::QUERY_ROW_LIMIT;
};

inline QueryOptions parseQueryOptions(simdjson::dom::element doc) {
    QueryOptions options;
    if (auto field = doc["autoCommit"]; !field.error()) {
        auto value = field.get_bool();
        if (value.error())
            throw std::runtime_error("autoCommit must be a boolean");
        options.autoCommit = value.value();
    }
    if (auto field = doc["maxRows"]; !field.error()) {
        auto value = field.get_uint64();
        if (value.error() || value.value() < 100 || value.value() > 1000000)
            throw std::runtime_error("maxRows must be between 100 and 1000000");
        options.maxRows = static_cast<size_t>(value.value());
    }
    return options;
}

}  // namespace velocitydb
