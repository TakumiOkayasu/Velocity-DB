import type { ZodType } from 'zod';
import type { IpcInvoker } from '../ipc/ipc-invoker';

export type { IpcInvoker };

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

/**
 * Provider が `info`/`profile` 等のドメインオブジェクトを IPC params に渡すための型変換。
 * `as unknown as Record<string, unknown>` キャストを集約する。
 */
export function asIpcParams(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * `invoke + validator.parse` の定型パターンを必要とする Provider の base。
 *
 * - {@link invokeAndParse}: schema が structured な場合 (戻り値の zod 検証あり)
 * - {@link invokeRaw}: schema が `z.any()` / `zVoid` の場合 (検証スキップ)
 *
 * Note: `parse` が不要な provider (transaction, export 等) は継承せず invoker 直接利用。
 * 将来 protected メソッドが 5+ に肥大化する場合は IpcCaller への合成 (DI) へ移行を検討。
 */
export abstract class BaseProvider {
  constructor(
    protected readonly invoker: IpcInvoker,
    protected readonly validator: ResponseValidator
  ) {}

  protected async invokeAndParse<T>(
    method: string,
    params: Record<string, unknown>,
    schema: ZodType<T>
  ): Promise<T> {
    const raw = await this.invoker.invoke(method, params);
    return this.validator.parse(schema, raw);
  }

  protected async invokeRaw(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.invoker.invoke(method, params);
  }
}
