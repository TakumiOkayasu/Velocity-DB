import type { BridgeLogger, IpcInvoker, ResponseValidator } from './types';

export interface ExportProvider {
  exportCSV(data: Record<string, string | null>[], filepath: string): Promise<void>;
  exportJSON(data: Record<string, string | null>[], filepath: string): Promise<void>;
  exportExcel(data: Record<string, string | null>[], filepath: string): Promise<void>;
}

class ExportProviderImpl implements ExportProvider {
  constructor(
    private readonly invoker: IpcInvoker,
    // 共通シグネチャ維持 (#517 軸③): 現状未使用だが将来 log.info 等を実利用するため
    private readonly logger: BridgeLogger,
    // 共通シグネチャ維持 (#517 軸③): zVoid のため現状 parse を省略しているが、
    // 将来 structured schema 化された際に差し替えられるよう受け取りは維持する
    private readonly validator: ResponseValidator
  ) {
    void this.logger; // TS6138 抑制: 共通シグネチャ維持のため未使用受け取りを許可
    void this.validator; // TS6138 抑制: 同上
  }

  async exportCSV(data: Record<string, string | null>[], filepath: string): Promise<void> {
    // S.exportCSV は z.any() で実質 noop のため parse を省略 (transaction.ts と同方針)
    await this.invoker.invoke('exportCSV', { data, filepath });
  }

  async exportJSON(data: Record<string, string | null>[], filepath: string): Promise<void> {
    // S.exportJSON は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('exportJSON', { data, filepath });
  }

  async exportExcel(data: Record<string, string | null>[], filepath: string): Promise<void> {
    // S.exportExcel は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('exportExcel', { data, filepath });
  }
}

export function createExportProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): ExportProvider {
  return new ExportProviderImpl(invoker, logger, validator);
}
