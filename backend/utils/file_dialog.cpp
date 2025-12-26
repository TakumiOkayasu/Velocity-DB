#include "file_dialog.h"

#include <Windows.h>

#include <fstream>
#include <sstream>

#include <commdlg.h>

namespace predategrip {

std::expected<std::filesystem::path, std::string> FileDialog::showSaveDialog(const std::string& defaultExt, const std::string& filter, const std::string& defaultFileName) {
    OPENFILENAMEA ofn = {};
    char szFile[MAX_PATH] = {};

    // Copy default file name if provided
    if (!defaultFileName.empty() && defaultFileName.size() < MAX_PATH) {
        strcpy_s(szFile, MAX_PATH, defaultFileName.c_str());
    }

    ofn.lStructSize = sizeof(OPENFILENAMEA);
    ofn.hwndOwner = nullptr;  // No parent window (WebView2 doesn't expose HWND easily)
    ofn.lpstrFile = szFile;
    ofn.nMaxFile = sizeof(szFile);
    ofn.lpstrFilter = filter.c_str();
    ofn.nFilterIndex = 1;
    ofn.lpstrFileTitle = nullptr;
    ofn.nMaxFileTitle = 0;
    ofn.lpstrInitialDir = nullptr;
    ofn.lpstrDefExt = defaultExt.c_str();
    ofn.Flags = OFN_PATHMUSTEXIST | OFN_OVERWRITEPROMPT;

    if (GetSaveFileNameA(&ofn)) {
        return std::filesystem::path(szFile);
    }

    DWORD error = CommDlgExtendedError();
    if (error == 0) {
        // User cancelled
        return std::unexpected("User cancelled save dialog");
    }

    return std::unexpected("Failed to show save dialog");
}

std::expected<std::filesystem::path, std::string> FileDialog::showOpenDialog(const std::string& filter) {
    OPENFILENAMEA ofn = {};
    char szFile[MAX_PATH] = {};

    ofn.lStructSize = sizeof(OPENFILENAMEA);
    ofn.hwndOwner = nullptr;
    ofn.lpstrFile = szFile;
    ofn.nMaxFile = sizeof(szFile);
    ofn.lpstrFilter = filter.c_str();
    ofn.nFilterIndex = 1;
    ofn.lpstrFileTitle = nullptr;
    ofn.nMaxFileTitle = 0;
    ofn.lpstrInitialDir = nullptr;
    ofn.Flags = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST;

    if (GetOpenFileNameA(&ofn)) {
        return std::filesystem::path(szFile);
    }

    DWORD error = CommDlgExtendedError();
    if (error == 0) {
        // User cancelled
        return std::unexpected("User cancelled open dialog");
    }

    return std::unexpected("Failed to show open dialog");
}

std::expected<std::string, std::string> FileDialog::readFile(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::in | std::ios::binary);
    if (!file) {
        return std::unexpected(std::format("Failed to open file: {}", path.string()));
    }

    std::ostringstream content;
    content << file.rdbuf();

    if (!file) {
        return std::unexpected(std::format("Failed to read file: {}", path.string()));
    }

    return content.str();
}

std::expected<void, std::string> FileDialog::writeFile(const std::filesystem::path& path, const std::string& content) {
    std::ofstream file(path, std::ios::out | std::ios::binary);
    if (!file) {
        return std::unexpected(std::format("Failed to create file: {}", path.string()));
    }

    file.write(content.data(), static_cast<std::streamsize>(content.size()));

    if (!file) {
        return std::unexpected(std::format("Failed to write file: {}", path.string()));
    }

    return {};
}

}  // namespace predategrip
