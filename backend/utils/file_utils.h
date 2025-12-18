#pragma once

#include <optional>
#include <string>
#include <vector>

namespace predategrip {

class FileUtils {
public:
    static std::optional<std::string> readFile(const std::string& filepath);
    static bool writeFile(const std::string& filepath, const std::string& content);
    static bool fileExists(const std::string& filepath);
    static bool createDirectory(const std::string& path);
    static std::string getAppDataPath();
    static std::string getExecutablePath();
    static std::vector<std::string> listFiles(const std::string& directory, const std::string& extension = "");
};

}  // namespace predategrip
