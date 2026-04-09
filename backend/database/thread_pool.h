#pragma once

#include <condition_variable>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

namespace velocitydb {

class ThreadPool {
    static constexpr size_t MAX_THREADS = 8;
    static constexpr size_t FALLBACK_THREADS = 2;

public:
    explicit ThreadPool(size_t numThreads = 0) : m_shutdown(false) {
        if (numThreads == 0) {
            numThreads = std::thread::hardware_concurrency();
        }
        if (numThreads > MAX_THREADS) {
            numThreads = MAX_THREADS;
        }
        if (numThreads == 0) {
            numThreads = FALLBACK_THREADS;
        }

        m_workers.reserve(numThreads);
        for (size_t i = 0; i < numThreads; ++i) {
            m_workers.emplace_back([this] { workerLoop(); });
        }
    }

    ~ThreadPool() {
        {
            std::lock_guard lock(m_mutex);
            m_shutdown = true;
        }
        m_cv.notify_all();
        for (auto& w : m_workers) {
            if (w.joinable()) {
                w.join();
            }
        }
    }

    ThreadPool(const ThreadPool&) = delete;
    ThreadPool& operator=(const ThreadPool&) = delete;
    ThreadPool(ThreadPool&&) = delete;
    ThreadPool& operator=(ThreadPool&&) = delete;

    template <typename F, typename... Args>
    auto submit(F&& f, Args&&... args) -> std::future<std::invoke_result_t<F, Args...>> {
        using ReturnType = std::invoke_result_t<F, Args...>;

        auto task = std::make_shared<std::packaged_task<ReturnType()>>(
            [fn = std::forward<F>(f), ... captured_args = std::forward<Args>(args)]() mutable { return std::invoke(std::move(fn), std::move(captured_args)...); });

        auto future = task->get_future();

        {
            std::lock_guard lock(m_mutex);
            if (m_shutdown) {
                throw std::runtime_error("ThreadPool is shutting down");
            }
            m_tasks.emplace([task] { (*task)(); });
        }
        m_cv.notify_one();

        return future;
    }

    [[nodiscard]] size_t threadCount() const noexcept { return m_workers.size(); }

private:
    void workerLoop() {
        while (true) {
            std::function<void()> task;
            {
                std::unique_lock lock(m_mutex);
                m_cv.wait(lock, [this] { return m_shutdown || !m_tasks.empty(); });
                if (m_shutdown && m_tasks.empty()) {
                    return;
                }
                task = std::move(m_tasks.front());
                m_tasks.pop();
            }
            task();
        }
    }

    std::vector<std::thread> m_workers;
    std::queue<std::function<void()>> m_tasks;
    std::mutex m_mutex;
    std::condition_variable m_cv;
    bool m_shutdown;
};

}  // namespace velocitydb
