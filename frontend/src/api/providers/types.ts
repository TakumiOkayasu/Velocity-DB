import type { ZodType } from 'zod';

export type { IpcInvoker } from '../ipc/ipc-invoker';

/** Provider 内で使うログ IF (utils/logger の log と同形) */
export interface BridgeLogger {
  debug(message: string): void;
  info(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

/** zod parse をラップ。Provider は schema を渡し ResponseValidator が parse する */
export interface ResponseValidator {
  parse<T>(schema: ZodType<T>, data: unknown): T;
}
