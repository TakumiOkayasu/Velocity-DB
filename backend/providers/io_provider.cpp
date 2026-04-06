#include "io_provider.h"

#include "../utils/file_dialog.h"
#include "../utils/json_utils.h"
#include "simdjson.h"

#include <algorithm>
#include <filesystem>
#include <format>
#include <fstream>

namespace velocitydb {

namespace {

constexpr auto kLogPath = "log/frontend.log";
constexpr auto kBookmarksPath = "data/bookmarks.json";

[[nodiscard]] std::string formatBookmarkJson(std::string_view id, std::string_view name, std::string_view content) {
    return std::format("{{\"id\":\"{}\",\"name\":\"{}\",\"content\":\"{}\"}}", JsonUtils::escapeString(id), JsonUtils::escapeString(name), JsonUtils::escapeString(content));
}

}  // namespace

std::string IOProvider::writeFrontendLog(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto contentResult = doc["content"].get_string();
        if (contentResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: content");
        }

        std::lock_guard lock(m_logMutex);
        std::filesystem::path logPath(kLogPath);
        std::filesystem::create_directories(logPath.parent_path());

        auto mode = m_firstLogWrite.exchange(false) ? std::ios::trunc : std::ios::app;
        std::ofstream logFile(logPath, mode);
        if (!logFile.is_open()) {
            return JsonUtils::errorResponse("Failed to open frontend log file");
        }

        logFile << contentResult.value();

        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IOProvider::saveQueryToFile(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto contentResult = doc["content"].get_string();
        if (contentResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: content");
        }
        auto content = std::string(contentResult.value());

        std::string defaultFileName;
        if (auto name = doc["defaultFileName"].get_string(); !name.error()) {
            defaultFileName = std::string(name.value());
        }

        auto result = FileDialog::showSaveDialog("sql", "SQL Files (*.sql)\0*.sql\0All Files (*.*)\0*.*\0", defaultFileName);
        if (!result) {
            return JsonUtils::errorResponse(result.error());
        }

        auto writeResult = FileDialog::writeFile(result.value(), content);
        if (!writeResult) {
            return JsonUtils::errorResponse(writeResult.error());
        }

        return JsonUtils::successResponse(std::format("{{\"filePath\":\"{}\"}}", JsonUtils::escapeString(result.value().string())));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IOProvider::loadQueryFromFile(std::string_view) {
    try {
        auto result = FileDialog::showOpenDialog("SQL Files (*.sql)\0*.sql\0All Files (*.*)\0*.*\0");
        if (!result) {
            return JsonUtils::errorResponse(result.error());
        }

        // ファイルサイズチェック（OOM防止）
        // NOTE: file_size→readFile間のTOCTOUは許容（ユーザー選択のローカルファイル）
        constexpr auto kMaxFileSize = static_cast<std::uintmax_t>(10) * 1024 * 1024;  // 10MB
        std::error_code ec;
        auto fileSize = std::filesystem::file_size(result.value(), ec);
        if (ec) {
            return JsonUtils::errorResponse(std::format("Failed to get file size: {}", ec.message()));
        }
        if (fileSize > kMaxFileSize) {
            auto sizeMB = static_cast<double>(fileSize) / (1024.0 * 1024.0);
            return JsonUtils::errorResponse(std::format("File too large ({:.1f} MB). Maximum supported size: 10 MB", sizeMB));
        }

        auto readResult = FileDialog::readFile(result.value());
        if (!readResult) {
            return JsonUtils::errorResponse(readResult.error());
        }

        auto json = std::format("{{\"filePath\":\"{}\",\"content\":\"{}\"}}", JsonUtils::escapeString(result.value().string()), JsonUtils::escapeString(readResult.value()));
        return JsonUtils::successResponse(json);
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IOProvider::browseFile(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        std::string filter = "All Files (*.*)\0*.*\0";
        if (auto filterResult = doc["filter"].get_string(); !filterResult.error()) {
            filter = std::string(filterResult.value());
            std::ranges::replace(filter, '|', '\0');
            filter += '\0';
        }

        auto result = FileDialog::showOpenDialog(filter);
        if (!result) {
            return JsonUtils::errorResponse(result.error());
        }

        return JsonUtils::successResponse(std::format("{{\"filePath\":\"{}\"}}", JsonUtils::escapeString(result.value().string())));
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IOProvider::getBookmarks(std::string_view) {
    try {
        std::filesystem::path bookmarksPath(kBookmarksPath);
        if (!std::filesystem::exists(bookmarksPath)) {
            return JsonUtils::successResponse("[]");
        }

        auto readResult = FileDialog::readFile(bookmarksPath);
        if (!readResult) {
            return JsonUtils::errorResponse(readResult.error());
        }

        return JsonUtils::successResponse(readResult.value());
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IOProvider::saveBookmark(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto idResult = doc["id"].get_string();
        auto nameResult = doc["name"].get_string();
        auto contentResult = doc["content"].get_string();
        if (idResult.error() || nameResult.error() || contentResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required fields: id, name, or content");
        }
        auto id = std::string(idResult.value());
        auto name = std::string(nameResult.value());
        auto content = std::string(contentResult.value());

        std::filesystem::path bookmarksPath(kBookmarksPath);
        std::filesystem::create_directories(bookmarksPath.parent_path());

        simdjson::dom::parser existingParser;
        std::string fileContent;
        simdjson::dom::array bookmarks;
        bool hasExisting = false;

        if (std::filesystem::exists(bookmarksPath)) {
            if (auto readResult = FileDialog::readFile(bookmarksPath); readResult) {
                fileContent = readResult.value();
                auto existingDoc = existingParser.parse(fileContent);
                if (auto arr = existingDoc.get_array(); !arr.error()) {
                    bookmarks = arr.value();
                    hasExisting = true;
                }
            }
        }

        std::string json = "[";
        bool found = false;
        bool first = true;

        if (hasExisting) {
            for (auto bookmark : bookmarks) {
                auto bookmarkIdResult = bookmark["id"].get_string();
                if (bookmarkIdResult.error())
                    continue;
                auto bookmarkId = std::string(bookmarkIdResult.value());

                if (!first)
                    json += ",";

                if (bookmarkId == id) {
                    found = true;
                    json += formatBookmarkJson(id, name, content);
                } else {
                    auto eName = bookmark["name"].get_string();
                    auto eContent = bookmark["content"].get_string();
                    json += formatBookmarkJson(bookmarkId, eName.error() ? "" : eName.value(), eContent.error() ? "" : eContent.value());
                }
                first = false;
            }
        }

        if (!found) {
            if (!first)
                json += ",";
            json += formatBookmarkJson(id, name, content);
        }

        json += "]";

        if (auto writeResult = FileDialog::writeFile(bookmarksPath, json); !writeResult) {
            return JsonUtils::errorResponse(writeResult.error());
        }

        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

std::string IOProvider::deleteBookmark(std::string_view params) {
    try {
        simdjson::dom::parser parser;
        auto doc = parser.parse(params);

        auto idResult = doc["id"].get_string();
        if (idResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Missing required field: id");
        }
        auto id = std::string(idResult.value());

        std::filesystem::path bookmarksPath(kBookmarksPath);
        if (!std::filesystem::exists(bookmarksPath)) {
            return JsonUtils::successResponse("{}");
        }

        auto readResult = FileDialog::readFile(bookmarksPath);
        if (!readResult) {
            return JsonUtils::errorResponse(readResult.error());
        }

        simdjson::dom::parser existingParser;
        auto existingDoc = existingParser.parse(readResult.value());
        auto arrResult = existingDoc.get_array();
        if (arrResult.error()) [[unlikely]] {
            return JsonUtils::errorResponse("Invalid bookmarks data");
        }

        std::string json = "[";
        bool first = true;

        for (auto bookmark : arrResult.value()) {
            auto bookmarkIdResult = bookmark["id"].get_string();
            if (bookmarkIdResult.error())
                continue;
            auto bookmarkId = std::string(bookmarkIdResult.value());
            if (bookmarkId != id) {
                if (!first)
                    json += ",";
                auto eName = bookmark["name"].get_string();
                auto eContent = bookmark["content"].get_string();
                json += formatBookmarkJson(bookmarkId, eName.error() ? "" : eName.value(), eContent.error() ? "" : eContent.value());
                first = false;
            }
        }

        json += "]";

        if (auto writeResult = FileDialog::writeFile(bookmarksPath, json); !writeResult) {
            return JsonUtils::errorResponse(writeResult.error());
        }

        return JsonUtils::successResponse("{}");
    } catch (const std::exception& e) {
        return JsonUtils::errorResponse(e.what());
    }
}

}  // namespace velocitydb
