import { bridge } from '../api/bridge';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

class Logger {
  private minLevel: LogLevel = LogLevel.DEBUG;
  private logQueue: string[] = [];
  private flushTimer: number | null = null;

  setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARNING, LogLevel.ERROR];
    const currentIndex = levels.indexOf(this.minLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  private getCurrentTimestamp(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  private log(level: LogLevel, message: string): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = this.getCurrentTimestamp();
    const logMessage = `[${timestamp}] [${level}] ${message}`;

    // コンソールに出力
    switch (level) {
      case LogLevel.DEBUG:
        console.log(logMessage);
        break;
      case LogLevel.INFO:
        console.info(logMessage);
        break;
      case LogLevel.WARNING:
        console.warn(logMessage);
        break;
      case LogLevel.ERROR:
        console.error(logMessage);
        break;
    }

    // Add to queue for file output
    this.logQueue.push(logMessage);

    // Periodically flush to file (buffering)
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flush();
      }, 1000); // Flush every 1 second
    }
  }

  private async flush(): Promise<void> {
    if (this.logQueue.length === 0) {
      return;
    }

    const logs = `${this.logQueue.join('\n')}\n`;
    this.logQueue = [];
    this.flushTimer = null;

    try {
      // Save to localStorage in browser environment (max 1MB)
      if (typeof window !== 'undefined' && window.localStorage) {
        const storageKey = 'predategrip_frontend_logs';
        const existingLogs = window.localStorage.getItem(storageKey) || '';
        const newLogs = existingLogs + logs;

        // Delete old logs if they become too large
        const maxSize = 1024 * 1024; // 1MB
        if (newLogs.length > maxSize) {
          // Keep only the latest half
          const truncatedLogs = newLogs.slice(-maxSize / 2);
          window.localStorage.setItem(storageKey, truncatedLogs);
        } else {
          window.localStorage.setItem(storageKey, newLogs);
        }
      }

      // Write to backend file (log/frontend.log)
      await bridge.writeFrontendLog(logs);
    } catch (_error) {
      // Ignore log write errors (to avoid infinite loops)
      // Note: Does not error even in environments without localStorage
    }
  }

  // Clear logs
  clearLogs(): void {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('predategrip_frontend_logs');
    }
  }

  // Get logs
  getLogs(): string {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem('predategrip_frontend_logs') || '';
    }
    return '';
  }

  debug(message: string): void {
    this.log(LogLevel.DEBUG, message);
  }

  info(message: string): void {
    this.log(LogLevel.INFO, message);
  }

  warning(message: string): void {
    this.log(LogLevel.WARNING, message);
  }

  error(message: string): void {
    this.log(LogLevel.ERROR, message);
  }

  // アプリ終了時などに強制的にフラッシュ
  async forceFlush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
    }
    await this.flush();
  }
}

export const logger = new Logger();

// グローバルなログ関数
export const log = {
  debug: (message: string) => logger.debug(message),
  info: (message: string) => logger.info(message),
  warning: (message: string) => logger.warning(message),
  error: (message: string) => logger.error(message),
};

// Override console methods to capture browser console logs
if (typeof window !== 'undefined') {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    const message = args.map((arg) => String(arg)).join(' ');
    // Don't call logger.debug() to avoid infinite recursion
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const logMessage = `[${timestamp}] [DEBUG] [Console] ${message}`;
    logger['logQueue'].push(logMessage);
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    const message = args.map((arg) => String(arg)).join(' ');
    // Don't call logger.info() to avoid infinite recursion
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const logMessage = `[${timestamp}] [INFO] [Console] ${message}`;
    logger['logQueue'].push(logMessage);
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    const message = args.map((arg) => String(arg)).join(' ');
    // Don't call logger.warning() to avoid infinite recursion
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const logMessage = `[${timestamp}] [WARNING] [Console] ${message}`;
    logger['logQueue'].push(logMessage);
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    const message = args.map((arg) => String(arg)).join(' ');
    // Don't call logger.error() to avoid infinite recursion
    // Instead, directly format and add to queue
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const logMessage = `[${timestamp}] [ERROR] [Console] ${message}`;
    logger['logQueue'].push(logMessage);
  };
}
