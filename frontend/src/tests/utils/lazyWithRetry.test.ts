import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

// lazyWithRetry内部ロジックを直接テストするため、
// React.lazyをモックしてfactory関数の振る舞いを検証する
vi.mock('react', () => ({
  lazy: (factory: () => Promise<unknown>) => factory,
}));

const { lazyWithRetry } = await import('../../utils/lazyWithRetry');

describe('lazyWithRetry', () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });
  });

  it('正常インポート時はモジュールをそのまま返す', async () => {
    const module = { default: () => null };
    const factory = () => Promise.resolve(module);
    const result = await (lazyWithRetry(factory) as unknown as () => Promise<unknown>)();
    expect(result).toBe(module);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('チャンクエラー（dynamically imported module）で初回はリロードする', async () => {
    const factory = () =>
      Promise.reject(
        new TypeError('Failed to fetch dynamically imported module: /assets/Foo-abc.js')
      );

    const promise = (lazyWithRetry(factory) as unknown as () => Promise<unknown>)();

    // リロード前にpromiseは解決しない（pending）ことを確認
    const settled = await Promise.race([
      promise.then(() => 'resolved').catch(() => 'rejected'),
      new Promise((r) => setTimeout(() => r('pending'), 50)),
    ]);

    expect(settled).toBe('pending');
    expect(reloadMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('chunk-reload')).toBe('1');
  });

  it('チャンクエラー（Failed to fetch dynamically imported module）で初回はリロードする', async () => {
    const factory = () =>
      Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/Bar-xyz.js'));

    (lazyWithRetry(factory) as unknown as () => Promise<unknown>)();
    await new Promise((r) => setTimeout(r, 10));

    expect(reloadMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem('chunk-reload')).toBe('1');
  });

  it('チャンクエラー2回目（フラグ済）はリロードせずエラーをthrowする', async () => {
    sessionStorage.setItem('chunk-reload', '1');
    const error = new TypeError('Failed to fetch dynamically imported module: /assets/Foo-abc.js');
    const factory = () => Promise.reject(error);

    await expect((lazyWithRetry(factory) as unknown as () => Promise<unknown>)()).rejects.toThrow(
      error
    );

    expect(reloadMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('chunk-reload')).toBeNull();
  });

  it('非チャンクエラーはそのままthrowする', async () => {
    const error = new Error('Some other error');
    const factory = () => Promise.reject(error);

    await expect((lazyWithRetry(factory) as unknown as () => Promise<unknown>)()).rejects.toThrow(
      error
    );

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('メッセージなしのTypeErrorはチャンクエラーとして扱わない', async () => {
    const error = new TypeError('Cannot read properties of undefined');
    const factory = () => Promise.reject(error);

    await expect((lazyWithRetry(factory) as unknown as () => Promise<unknown>)()).rejects.toThrow(
      error
    );

    expect(reloadMock).not.toHaveBeenCalled();
  });
});
