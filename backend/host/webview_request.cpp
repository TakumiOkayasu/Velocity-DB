#include "webview_request.h"

#include "simdjson.h"

namespace velocitydb {

std::string normalizeWebViewRequest(std::string_view request) {
    try {
        thread_local static simdjson::dom::parser parser;
        auto doc = parser.parse(request);
        auto arr = doc.get_array();
        if (arr.error()) {
            return std::string(request);
        }
        auto firstElem = arr.at(0);
        if (firstElem.error()) {
            return "";
        }
        auto strValue = firstElem.get_string();
        if (strValue.error()) {
            return "";
        }
        return std::string(strValue.value());
    } catch (...) {
        return std::string(request);
    }
}

}  // namespace velocitydb
