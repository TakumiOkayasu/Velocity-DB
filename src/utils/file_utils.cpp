#include "file_utils.h"

#include <Windows.h>

#include <filesystem>
#include <fstream>
#include <sstream>

#include <ShlObj.h>

namespace predategrip {

std::optional<std::string> FileUtils::readFile(const std::string& filepath) {
    std::ifstream file(filepath, std::ios::binary);
    if (!file.is_open()) {
        return std::nullopt;
    }

    std::ostringstream content;
    content << file.rdbuf();
    return content.str();
}

bool FileUtils::writeFile(const std::string& filepath, const std::string& content) {
    std::ofstream file(filepath, std::ios::binary);
    if (!file.is_open()) {
        return false;
    }

    file << content;
    return true;
}

bool FileUtils::fileExists(const std::string& filepath) {
    return std::filesystem::exists(filepath);
}

bool FileUtils::createDirectory(const std::string& path) {
    return std::filesystem::create_directories(path);
}

std::string FileUtils::getAppDataPath() {
    wchar_t path[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, path))) {
        // Convert wchar_t to UTF-8 string
        int size = WideCharToMultiByte(CP_UTF8, 0, path, -1, nullptr, 0, nullptr, nullptr);
        if (size > 0) {
            std::string result(size - 1, '\0');
            WideCharToMultiByte(CP_UTF8, 0, path, -1, result.data(), size, nullptr, nullptr);
            return result + "\\PreDateGrip";
        }
    }
    return "";
}

std::string FileUtils::getExecutablePath() {
    wchar_t path[MAX_PATH];
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    // Convert wchar_t to UTF-8 string
    int size = WideCharToMultiByte(CP_UTF8, 0, path, -1, nullptr, 0, nullptr, nullptr);
    if (size > 0) {
        std::string result(size - 1, '\0');
        WideCharToMultiByte(CP_UTF8, 0, path, -1, result.data(), size, nullptr, nullptr);
        return result;
    }
    return "";
}

std::vector<std::string> FileUtils::listFiles(const std::string& directory, const std::string& extension) {
    std::vector<std::string> files;

    if (!std::filesystem::exists(directory)) {
        return files;
    }

    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
        if (entry.is_regular_file()) {
            if (extension.empty() || entry.path().extension() == extension) {
                files.push_back(entry.path().string());
            }
        }
    }

    return files;
}

}  // namespace predategrip
