import type { IpcInvoker } from './ipc-invoker';

/** テスト用: 任意の method に対する応答を事前登録できる差し替え可能な invoker */
export class MockIpcInvoker implements IpcInvoker {
  private readonly responses = new Map<string, unknown>();
  private readonly errors = new Map<string, string>();
  readonly calls: { method: string; params: Record<string, unknown> }[] = [];

  setResponse(method: string, data: unknown): void {
    this.responses.set(method, data);
    this.errors.delete(method);
  }

  setError(method: string, message: string): void {
    this.errors.set(method, message);
    this.responses.delete(method);
  }

  async invoke(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    const error = this.errors.get(method);
    if (error !== undefined) {
      throw new Error(error);
    }
    if (!this.responses.has(method)) {
      throw new Error(`[MockIpcInvoker] No response registered for method: ${method}`);
    }
    return this.responses.get(method);
  }
}
