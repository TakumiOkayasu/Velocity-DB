import { type ComponentType, lazy } from 'react';

/**
 * チャンクロード失敗時にページリロードで復旧するReact.lazyラッパー。
 * sessionStorageフラグで無限リロードループを防止する。
 */
const CHUNK_RELOAD_KEY = 'chunk-reload';

// biome-ignore lint/suspicious/noExplicitAny: React.lazyの型定義に合わせる
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory().catch((error: unknown) => {
      const isChunkError =
        error instanceof Error &&
        (error.message.includes('dynamically imported module') ||
          error.message.includes('Failed to fetch dynamically imported module'));

      if (isChunkError) {
        if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
          window.location.reload();
          return new Promise<never>(() => {});
        }
        sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      }
      throw error;
    })
  );
}
