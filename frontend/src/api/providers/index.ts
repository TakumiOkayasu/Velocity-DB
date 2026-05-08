import { log } from '../../utils/logger';
import { type IpcInvoker, WindowIpcInvoker } from '../ipc/ipc-invoker';

let invokerInstance: IpcInvoker = new WindowIpcInvoker(log);

// loggerInstance / validatorInstance / 各 provider は #518-#526 で順次追加する。

/** テスト専用: invoker を差し替えて全 provider を再構築する */
export function __setIpcInvokerForTest(invoker: IpcInvoker): void {
  invokerInstance = invoker;
}

/** テスト専用: 現在の invoker を取得する (DI 検証用) */
export function __getIpcInvokerForTest(): IpcInvoker {
  return invokerInstance;
}
