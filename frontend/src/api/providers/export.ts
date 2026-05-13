import * as S from '../schemas';
import { BaseProvider, type IpcInvoker, type ResponseValidator } from './types';

export interface ExportProvider {
  exportCSV(data: Record<string, string | null>[], filepath: string): Promise<void>;
  exportJSON(data: Record<string, string | null>[], filepath: string): Promise<void>;
  exportExcel(data: Record<string, string | null>[], filepath: string): Promise<void>;
}

class ExportProviderImpl extends BaseProvider implements ExportProvider {
  async exportCSV(data: Record<string, string | null>[], filepath: string): Promise<void> {
    await this.invokeAndParse('exportCSV', { data, filepath }, S.exportCSV);
  }

  async exportJSON(data: Record<string, string | null>[], filepath: string): Promise<void> {
    await this.invokeAndParse('exportJSON', { data, filepath }, S.exportJSON);
  }

  async exportExcel(data: Record<string, string | null>[], filepath: string): Promise<void> {
    await this.invokeAndParse('exportExcel', { data, filepath }, S.exportExcel);
  }
}

export function createExportProvider(
  invoker: IpcInvoker,
  validator: ResponseValidator
): ExportProvider {
  return new ExportProviderImpl(invoker, validator);
}
