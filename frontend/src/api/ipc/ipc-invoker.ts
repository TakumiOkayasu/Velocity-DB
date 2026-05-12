import { type IPCRequest, type IPCResponse, isIPCResponse } from './ipc-protocol';

const MOCK_NETWORK_DELAY_MS = 50;

// ログ送信自体が backend へ writeFrontendLog として渡るため、ログ出力で無限ループしないようスキップ
const SILENT_LOG_METHOD = 'writeFrontendLog';

/** 操作層: IPC 呼び出しの抽象。Provider 内で利用 */
export interface IpcInvoker {
  invoke(method: string, params: Record<string, unknown>): Promise<unknown>;
}

/** WindowIpcInvoker が利用する logger の最小 IF (providers/types.ts の BridgeLogger と互換) */
export interface IpcInvokerLogger {
  debug(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

/** 本番用: window.invoke 経由で backend と通信。DEV mode で window.invoke 不在時は mockData にフォールバック */
export class WindowIpcInvoker implements IpcInvoker {
  constructor(private readonly logger: IpcInvokerLogger) {}

  async invoke(method: string, params: Record<string, unknown>): Promise<unknown> {
    const winInvoke = window.invoke;
    if (winInvoke) {
      return this.callBackend(method, params, winInvoke);
    }
    if (import.meta.env.DEV) {
      return this.callMock(method);
    }
    throw new Error('Backend not available');
  }

  private async callBackend(
    method: string,
    params: Record<string, unknown>,
    winInvoke: (request: string) => Promise<string>
  ): Promise<unknown> {
    const request: IPCRequest = {
      method,
      params: JSON.stringify(params),
    };
    const requestStr = JSON.stringify(request);
    const shouldLog = method !== SILENT_LOG_METHOD;

    if (shouldLog) {
      this.logger.debug(`[Bridge] Sending request: ${method}`);
    }

    const responseRaw = await winInvoke(requestStr);

    if (shouldLog) {
      this.logger.debug(`[Bridge] Received response for ${method} (type: ${typeof responseRaw})`);
    }

    const response = this.parseIpcResponse(method, responseRaw);

    if (!response.success) {
      this.logger.error(`[Bridge] Error response for ${method}: ${response.error}`);
      throw new Error(response.error || 'Unknown error');
    }

    if (shouldLog) {
      this.logger.debug(`[Bridge] Successfully processed ${method}`);
    }
    return response.data;
  }

  private parseIpcResponse(method: string, responseRaw: unknown): IPCResponse {
    if (typeof responseRaw === 'string') {
      const parsed: unknown = JSON.parse(responseRaw);
      if (!isIPCResponse(parsed)) {
        this.logger.error(`[Bridge] Invalid response structure for ${method}`);
        throw new Error(`Invalid response structure for ${method}`);
      }
      return parsed;
    }
    if (isIPCResponse(responseRaw)) {
      return responseRaw;
    }
    this.logger.error(`[Bridge] Unexpected response type: ${typeof responseRaw}`);
    throw new Error(`Unexpected response type: ${typeof responseRaw}`);
  }

  private async callMock(method: string): Promise<unknown> {
    const { mockData } = await import('../mockData');
    await new Promise((resolve) => setTimeout(resolve, MOCK_NETWORK_DELAY_MS));
    const data = mockData[method];
    if (data === undefined) {
      this.logger.warning(`[Bridge DEV] No mock data for method: ${method}`);
      throw new Error(`[Bridge DEV] No mock data for method: ${method}`);
    }
    this.logger.debug(`[Bridge DEV] Returning mock data for ${method}`);
    return data;
  }
}
