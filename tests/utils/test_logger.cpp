#include "utils/logger.h"

#include <string>

#include <gtest/gtest.h>

namespace velocitydb {
namespace {

class BufferedLogOutput : public LogOutput {
public:
    std::string pending;
    std::string visible;
    int flushCount = 0;

    void write(LogLevel, std::string_view message) override { pending += message; }
    void flush() override {
        visible += pending;
        pending.clear();
        ++flushCount;
    }
};

TEST(LoggerTest, ErrorPublishesPrecedingDiagnosticContextImmediately) {
    BufferedLogOutput output;
    Logger logger(&output);
    logger.log<LogLevel::INFO>("context;");
    EXPECT_TRUE(output.visible.empty());
    logger.log<LogLevel::ERROR_LEVEL>("failure;");
    EXPECT_EQ(output.visible, "context;failure;");
    EXPECT_EQ(output.flushCount, 1);
}

TEST(LoggerTest, CriticalFlushesImmediately) {
    BufferedLogOutput output;
    Logger logger(&output);
    logger.log<LogLevel::CRITICAL>("fatal;");
    EXPECT_EQ(output.visible, "fatal;");
    EXPECT_EQ(output.flushCount, 1);
}

TEST(LoggerTest, OrdinaryMessagesRemainBuffered) {
    BufferedLogOutput output;
    Logger logger(&output);
    logger.log<LogLevel::INFO>("info;");
    logger.log<LogLevel::WARNING>("warning;");
    EXPECT_EQ(output.flushCount, 0);
    logger.flush();
    EXPECT_EQ(output.visible, "info;warning;");
}

TEST(LoggerTest, FilteredErrorsDoNotWriteOrFlush) {
    BufferedLogOutput output;
    Logger logger(&output, LogLevel::CRITICAL);
    logger.log<LogLevel::ERROR_LEVEL>("filtered;");
    EXPECT_TRUE(output.pending.empty());
    EXPECT_EQ(output.flushCount, 0);
}

}  // namespace
}  // namespace velocitydb
