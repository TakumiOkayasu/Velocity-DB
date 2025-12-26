#pragma once

#include <expected>
#include <filesystem>
#include <string>

namespace predategrip {

/// Windows file dialog wrapper for save/open operations
class FileDialog {
public:
    /// Shows a "Save As" dialog and returns the selected file path
    /// @param defaultExt Default file extension (e.g., "sql")
    /// @param filter File filter string (e.g., "SQL Files (*.sql)\0*.sql\0All Files (*.*)\0*.*\0")
    /// @param defaultFileName Default file name (optional)
    /// @return Selected file path or error message
    [[nodiscard]] static std::expected<std::filesystem::path, std::string> showSaveDialog(const std::string& defaultExt, const std::string& filter, const std::string& defaultFileName = "");

    /// Shows an "Open" dialog and returns the selected file path
    /// @param filter File filter string (e.g., "SQL Files (*.sql)\0*.sql\0All Files (*.*)\0*.*\0")
    /// @return Selected file path or error message
    [[nodiscard]] static std::expected<std::filesystem::path, std::string> showOpenDialog(const std::string& filter);

    /// Read file content as UTF-8 string
    [[nodiscard]] static std::expected<std::string, std::string> readFile(const std::filesystem::path& path);

    /// Write string content to file as UTF-8
    [[nodiscard]] static std::expected<void, std::string> writeFile(const std::filesystem::path& path, const std::string& content);
};

}  // namespace predategrip
