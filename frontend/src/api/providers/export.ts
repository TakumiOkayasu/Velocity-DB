import type { IpcInvoker } from './types';

// 全 method の schema が zVoid (parse 不要) のため BaseProvider は継承しない。
// validator を持たず invoker のみで完結する設計 (transaction.ts と同方針)。

export interface ExportProvider {
  exportCSV(data: Record<string, string | null>[], filepath: string): Promise<void>;
  exportJSON(data: Record<string, string | null>[], filepath: string): Promise<void>;
  exportExcel(data: Record<string, string | null>[], filepath: string): Promise<void>;
}

class ExportProviderImpl implements ExportProvider {
  constructor(private readonly invoker: IpcInvoker) {}

  async exportCSV(data: Record<string, string | null>[], filepath: string): Promise<void> {
    // S.exportCSV は z.any() で実質 noop のため parse を省略
    await this.invoker.invoke('exportCSV', { data, filepath });
  }

  async exportJSON(data: Record<string, string | null>[], filepath: string): Promise<void> {
    await this.invoker.invoke('exportJSON', { data, filepath });
  }

  async exportExcel(data: Record<string, string | null>[], filepath: string): Promise<void> {
    await this.invoker.invoke('exportExcel', { data, filepath });
  }
}

export function createExportProvider(invoker: IpcInvoker): ExportProvider {
  return new ExportProviderImpl(invoker);
}
