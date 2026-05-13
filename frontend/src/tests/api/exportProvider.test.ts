import { beforeEach, describe, expect, it } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, exportProvider } from '../../api/providers';
import type { ExportProvider } from '../../api/providers/export';

type ExportMethod = keyof ExportProvider;
const EXPORT_METHODS: readonly ExportMethod[] = ['exportCSV', 'exportJSON', 'exportExcel'] as const;

const SAMPLE_DATA: Record<string, string | null>[] = [
  { id: '1', name: 'alice', note: null },
  { id: '2', name: 'bob', note: 'memo' },
];
const SAMPLE_PATHS: Record<ExportMethod, string> = {
  exportCSV: 'C:/tmp/out.csv',
  exportJSON: 'C:/tmp/out.json',
  exportExcel: 'C:/tmp/out.xlsx',
};

describe('exportProvider', () => {
  let mock: MockIpcInvoker;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  describe.each(EXPORT_METHODS)('%s', (method) => {
    it('IPC を呼び data と filepath を渡す', async () => {
      mock.setResponse(method, {});

      await exportProvider[method](SAMPLE_DATA, SAMPLE_PATHS[method]);

      expect(mock.calls[0]).toEqual({
        method,
        params: { data: SAMPLE_DATA, filepath: SAMPLE_PATHS[method] },
      });
    });

    it('IPC エラー時に throw する', async () => {
      mock.setError(method, `${method} failed`);

      await expect(exportProvider[method](SAMPLE_DATA, SAMPLE_PATHS[method])).rejects.toThrow(
        `${method} failed`
      );
    });
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('exportCSV', {});
    const { exportCSV } = exportProvider;

    await exportCSV(SAMPLE_DATA, SAMPLE_PATHS.exportCSV);

    expect(mock.calls[0]?.method).toBe('exportCSV');
  });

  it('__setIpcInvokerForTest 後に再度差し替えると新しい invoker が使われる', async () => {
    const first = new MockIpcInvoker();
    first.setResponse('exportJSON', {});
    __setIpcInvokerForTest(first);

    const second = new MockIpcInvoker();
    second.setResponse('exportJSON', {});
    __setIpcInvokerForTest(second);

    await exportProvider.exportJSON(SAMPLE_DATA, SAMPLE_PATHS.exportJSON);

    expect(second.calls).toHaveLength(1);
    expect(first.calls).toHaveLength(0);
  });
});
