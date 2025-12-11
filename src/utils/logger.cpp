#include "logger.h"

#include <chrono>
#include <filesystem>
#include <format>
#include <fstream>
#include <iostream>
#include <mutex>
#include <string>

namespace predategrip {

/**
 * @brief File log output implementation
 *
 * Concrete class of LogOutput interface.
 * Outputs to file and console with timestamps.
 * Thread-safe.
 */
class FileLogOutput : public LogOutput {
private:
    std::ofstream file_;
    std::mutex mutex_;

    [[nodiscard]] std::string get_timestamp() const {
        auto now = std::chrono::system_clock::now();
        auto time_t = std::chrono::system_clock::to_time_t(now);
        auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()) % 1000;

        std::tm tm{};
#ifdef _WIN32
        localtime_s(&tm, &time_t);
#else
        localtime_r(&time_t, &tm);
#endif

        return std::format("{:04d}-{:02d}-{:02d} {:02d}:{:02d}:{:02d}.{:03d}", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour, tm.tm_min, tm.tm_sec, static_cast<int>(ms.count()));
    }

public:
    explicit FileLogOutput(std::string_view filepath) {
        // Create log directory if it doesn't exist
        std::filesystem::path log_path(filepath);
        if (auto parent_path = log_path.parent_path(); !parent_path.empty()) {
            std::filesystem::create_directories(parent_path);
        }

        // Open in truncate mode to clear log on startup
        file_.open(std::string(filepath), std::ios::out | std::ios::trunc);
        if (!file_.is_open()) {
            std::cerr << "Failed to open log file: " << filepath << '\n';
        }
    }

    ~FileLogOutput() override {
        if (file_.is_open()) {
            file_.close();
        }
    }

    void write(LogLevel level, std::string_view message) override {
        std::lock_guard lock(mutex_);

        auto timestamp = get_timestamp();
        auto level_str = log_level_to_string(level);
        auto log_message = std::format("[{}] [{}] {}\n", timestamp, level_str, message);

        // Output to both file and console
        if (file_.is_open()) {
            file_ << log_message;
        }

        std::cout << log_message;
    }

    void flush() override {
        std::lock_guard lock(mutex_);
        if (file_.is_open()) {
            file_.flush();
        }
        std::cout.flush();
    }
};

// Global log output instance
static FileLogOutput global_log_output("log/backend.log");

// Initialization function (call at the beginning of main())
void initialize_logger() {
    get_logger().set_output(&global_log_output);
    get_logger().set_min_level(LogLevel::DEBUG);
}

}  // namespace predategrip
