import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 構造的な「bridge / providers facade を import しない」検査は @types/node 未導入のため
// 振る舞いテスト群で間接担保 (循環参照が再発すると logger 自体が undefined を経由して下記テストが壊れる)。
// 永続的な強制は CLAUDE.md 規約 + 将来 biome の useImportRestrictions ルール導入で対応 (別 Issue)。
describe('logger', () => {
  const originalInvoke = window.invoke;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    window.invoke = originalInvoke;
    window.localStorage.removeItem('velocitydb_frontend_logs');
  });

  it('forceFlush で window.invoke を writeFrontendLog メソッドで呼ぶ', async () => {
    const invoke = vi.fn().mockResolvedValue(JSON.stringify({ success: true, data: null }));
    window.invoke = invoke;

    const { logger } = await import('../../utils/logger');
    logger.error('test message');
    await logger.forceFlush();

    expect(invoke).toHaveBeenCalledTimes(1);
    const rawRequest = invoke.mock.calls[0]?.[0];
    expect(typeof rawRequest).toBe('string');
    const request = JSON.parse(rawRequest as string) as {
      method: string;
      params: string;
    };
    expect(request.method).toBe('writeFrontendLog');
    const params = JSON.parse(request.params) as { content: string };
    expect(params.content).toContain('test message');
  });

  it('window.invoke が無くても forceFlush は throw しない (DEV mode 互換)', async () => {
    window.invoke = undefined;
    const { logger } = await import('../../utils/logger');
    logger.error('test');
    await expect(logger.forceFlush()).resolves.toBeUndefined();
  });

  it('window.invoke が throw しても logger は throw しない (無限ループ防止)', async () => {
    window.invoke = vi.fn().mockRejectedValue(new Error('backend down'));
    const { logger } = await import('../../utils/logger');
    logger.error('test');
    await expect(logger.forceFlush()).resolves.toBeUndefined();
  });

  it('backend が success=false を返しても logger は throw せず原本 console.error に出す', async () => {
    window.invoke = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ success: false, error: 'disk full' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { logger } = await import('../../utils/logger');
    logger.error('test');
    await expect(logger.forceFlush()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('disk full'));
    errorSpy.mockRestore();
  });
});
