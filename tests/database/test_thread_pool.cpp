#include "database/thread_pool.h"

#include <gtest/gtest.h>

#include <atomic>
#include <chrono>
#include <stdexcept>
#include <vector>

using namespace velocitydb;

// 1. タスク投入→結果取得できる
TEST(ThreadPoolTest, SubmitAndGetResult) {
    ThreadPool pool(2);
    auto future = pool.submit([] { return 42; });
    EXPECT_EQ(future.get(), 42);
}

// 2. 複数タスク同時実行→全結果取得
TEST(ThreadPoolTest, MultipleConcurrentTasks) {
    ThreadPool pool(4);
    std::vector<std::future<int>> futures;
    for (int i = 0; i < 10; ++i) {
        futures.push_back(pool.submit([i] { return i * i; }));
    }
    for (int i = 0; i < 10; ++i) {
        EXPECT_EQ(futures[i].get(), i * i);
    }
}

// 3. スレッド数上限を超えるタスク→正常にキューイング・完了
TEST(ThreadPoolTest, QueuesBeyondThreadCount) {
    ThreadPool pool(2);
    std::atomic<int> completed{0};
    std::vector<std::future<void>> futures;

    for (int i = 0; i < 20; ++i) {
        futures.push_back(pool.submit([&completed] {
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
            completed.fetch_add(1, std::memory_order_relaxed);
        }));
    }

    for (auto& f : futures) {
        f.get();
    }
    EXPECT_EQ(completed.load(), 20);
}

// 4. デストラクタで未完了タスク完了まで待機して安全終了
TEST(ThreadPoolTest, DestructorWaitsForPendingTasks) {
    std::atomic<int> completed{0};
    {
        ThreadPool pool(2);
        for (int i = 0; i < 10; ++i) {
            pool.submit([&completed] {
                std::this_thread::sleep_for(std::chrono::milliseconds(5));
                completed.fetch_add(1, std::memory_order_relaxed);
            });
        }
        // pool destructor should wait
    }
    EXPECT_EQ(completed.load(), 10);
}

// 5. threadCount() がコンストラクタ指定値と一致
TEST(ThreadPoolTest, ThreadCountMatchesSpecified) {
    ThreadPool pool(3);
    EXPECT_EQ(pool.threadCount(), 3u);
}

// 6. 例外を投げるタスク→future.get()で例外伝播
TEST(ThreadPoolTest, ExceptionPropagatedThroughFuture) {
    ThreadPool pool(2);
    auto future = pool.submit([] -> int { throw std::runtime_error("test error"); });
    EXPECT_THROW(future.get(), std::runtime_error);
}
