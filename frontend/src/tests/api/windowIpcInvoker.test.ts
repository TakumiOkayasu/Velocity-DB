import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { type IpcInvokerLogger, WindowIpcInvoker } from '../../api/ipc/ipc-invoker';

function createSilentLogger(): IpcInvokerLogger {
  return {
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  };
}

function setInvokeResponse(value: unknown): void {
  window.invoke = vi.fn().mockResolvedValue(value as string);
}

describe('WindowIpcInvoker', () => {
  const originalInvoke = window.invoke;
  let logger: IpcInvokerLogger;
  let invoker: WindowIpcInvoker;

  beforeEach(() => {
    logger = createSilentLogger();
    invoker = new WindowIpcInvoker(logger);
  });

  afterEach(() => {
    window.invoke = originalInvoke;
  });

  it('文字列で返る IPCResponse をパースして data を返す', async () => {
    setInvokeResponse(JSON.stringify({ success: true, data: { ok: 1 } }));
    await expect(invoker.invoke('m', {})).resolves.toEqual({ ok: 1 });
  });

  it('object 形式の IPCResponse もそのまま受理する', async () => {
    // webview が事前にパース済みオブジェクトを返すケース
    setInvokeResponse({ success: true, data: 42 });
    await expect(invoker.invoke('m', {})).resolves.toBe(42);
  });

  it('success=false で error を throw する', async () => {
    setInvokeResponse(JSON.stringify({ success: false, error: 'bad' }));
    await expect(invoker.invoke('m', {})).rejects.toThrow('bad');
  });

  it('success=false で error が空なら Unknown error を throw する', async () => {
    setInvokeResponse(JSON.stringify({ success: false }));
    await expect(invoker.invoke('m', {})).rejects.toThrow('Unknown error');
  });

  it('構造不正な response は Invalid response structure を throw', async () => {
    setInvokeResponse(JSON.stringify({ foo: 1 }));
    await expect(invoker.invoke('m', {})).rejects.toThrow(/Invalid response structure/);
  });

  it('予期しない型の response は Unexpected response type を throw', async () => {
    setInvokeResponse(123);
    await expect(invoker.invoke('m', {})).rejects.toThrow(/Unexpected response type/);
  });

  it('writeFrontendLog では debug ログをスキップする (無限ループ防止)', async () => {
    setInvokeResponse(JSON.stringify({ success: true, data: null }));
    await invoker.invoke('writeFrontendLog', { content: 'x' });
    expect(logger.debug).not.toHaveBeenCalled();
  });
});
