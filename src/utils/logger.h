#pragma once

#include <cstdint>
#include <string_view>

namespace predategrip {

/**
 * @brief Log level
 *
 * Represents the severity of log messages.
 */
enum class LogLevel : uint8_t {
    DEBUG = 0,    ///< Debug information (development only)
    INFO,         ///< General information
    WARNING,      ///< Warning (not an error but requires attention)
    ERROR_LEVEL,  ///< Error (partial failure)
    CRITICAL      ///< Critical error (system cannot continue)
};

/**
 * @brief Log output interface
 *
 * Interface for abstracting log output destinations.
 * Supports file, console, network, etc.
 */
class LogOutput {
public:
    virtual ~LogOutput() = default;

    /**
     * @brief Write log message
     * @param level Log level
     * @param message Log message
     */
    virtual void write(LogLevel level, std::string_view message) = 0;

    /**
     * @brief Flush buffer
     */
    virtual void flush() = 0;
};

/**
 * @brief Simple Logger implementation
 *
 * Abstracts output destination through LogOutput interface.
 *
 * @note Not thread-safe (synchronize externally if needed)
 */
class Logger {
private:
    LogOutput* output_;
    LogLevel min_level_;

public:
    /**
     * @brief Constructor
     * @param output Log output destination (no output if nullptr)
     * @param min_level Minimum log level (messages below this are not output)
     */
    constexpr Logger(LogOutput* output, LogLevel min_level = LogLevel::INFO) noexcept : output_(output), min_level_(min_level) {}

    /**
     * @brief Default constructor (for singleton)
     *
     * Initialized with no output and minimum level INFO.
     * Output can be set later with set_output().
     */
    constexpr Logger() noexcept : output_(nullptr), min_level_(LogLevel::INFO) {}

    /**
     * @brief Set output destination
     * @param output Log output destination (disable output with nullptr)
     */
    void set_output(LogOutput* output) noexcept { output_ = output; }

    /**
     * @brief Get current output destination
     * @return Output destination (nullptr if not set)
     */
    [[nodiscard]] LogOutput* get_output() const noexcept { return output_; }

    /**
     * @brief Template-based log output
     *
     * Log level is determined at compile time,
     * so DEBUG logs are completely removed in release builds.
     *
     * @tparam Level Log level
     * @param message Log message
     *
     * @par Example
     * @code
     * logger.log<LogLevel::INFO>("message"sv);
     * logger.log<LogLevel::ERROR>("error"sv);
     * @endcode
     */
    template <LogLevel Level>
    void log(std::string_view message) const {
#ifdef _DEBUG
        constexpr bool is_debug_build = true;
#else
        constexpr bool is_debug_build = false;
#endif

        if constexpr (Level == LogLevel::DEBUG && !is_debug_build) {
            // DEBUG logs are completely removed in release builds
            (void)message;
        } else {
            if (Level >= min_level_ && output_ != nullptr) {
                output_->write(Level, message);
            }
        }
    }

    /**
     * @brief Set minimum log level
     * @param level New minimum log level
     */
    void set_min_level(LogLevel level) noexcept { min_level_ = level; }

    /**
     * @brief Get current minimum log level
     * @return Minimum log level
     */
    [[nodiscard]] constexpr LogLevel get_min_level() const noexcept { return min_level_; }

    /**
     * @brief Flush output
     */
    void flush() const {
        if (output_ != nullptr) {
            output_->flush();
        }
    }
};

/**
 * @brief Convert log level to string
 * @param level Log level
 * @return Log level string
 */
[[nodiscard]] constexpr std::string_view log_level_to_string(LogLevel level) noexcept {
    switch (level) {
        case LogLevel::DEBUG:
            return {"DEBUG", 5};
        case LogLevel::INFO:
            return {"INFO", 4};
        case LogLevel::WARNING:
            return {"WARN", 4};
        case LogLevel::ERROR_LEVEL:
            return {"ERROR", 5};
        case LogLevel::CRITICAL:
            return {"CRIT", 4};
    }
    return {"UNKNOWN", 7};
}

// ========================================
// Singleton logger
// ========================================

/**
 * @brief Get global Logger instance
 *
 * Uses Meyer's singleton pattern.
 * Accessible from anywhere.
 *
 * @return Logger& Reference to global Logger
 *
 * @par Example
 * @code
 * // During initialization (setup(), etc.)
 * static FileLogOutput log_output("log/backend.log");
 * get_logger().set_output(&log_output);
 * get_logger().set_min_level(LogLevel::DEBUG);
 *
 * // Can be used from anywhere
 * get_logger().log<LogLevel::INFO>("Hello"sv);
 * log<LogLevel::INFO>("Hello"sv);  // Global function is also available
 * @endcode
 *
 * @note Safe to call before setting output destination (nothing will be output)
 */
inline Logger& get_logger() {
    static Logger instance;
    return instance;
}

/**
 * @brief Template log output to global logger
 *
 * Log output is possible from anywhere using singleton logger.
 * Log level is specified with template argument,
 * so DEBUG logs are completely removed in release builds.
 *
 * @tparam Level Log level
 * @param message Log message
 *
 * @par Example
 * @code
 * log<LogLevel::DEBUG>("debug message"sv);
 * log<LogLevel::INFO>("info message"sv);
 * log<LogLevel::WARNING>("warning"sv);
 * log<LogLevel::ERROR>("error"sv);
 * log<LogLevel::CRITICAL>("critical"sv);
 * @endcode
 */
template <LogLevel Level>
void log(std::string_view message) {
    get_logger().log<Level>(message);
}

/**
 * @brief Flush global logger
 */
inline void log_flush() {
    get_logger().flush();
}

/**
 * @brief Initialize logger
 *
 * Call at the beginning of main().
 * Sets up file output and log level.
 */
void initialize_logger();

}  // namespace predategrip
