import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { schemaProvider } from '../../api/providers';
import { useRelatedRows } from '../../components/grid/hooks/useRelatedRows';
import type { ForeignKeyInfo } from '../../types';

vi.mock('../../api/providers', () => ({
  schemaProvider: { getForeignKeys: vi.fn() },
}));

it('テーブル切り替え後に古い応答が届いても、現在の外部キーだけを使う', async () => {
  let resolveOrders: (keys: ForeignKeyInfo[]) => void;
  const orders = new Promise<ForeignKeyInfo[]>((resolve) => {
    resolveOrders = resolve;
  });
  vi.mocked(schemaProvider.getForeignKeys)
    .mockReturnValueOnce(orders)
    .mockResolvedValueOnce([
      {
        name: 'invoices_customer',
        columns: ['customer_id'],
        referencedTable: 'customers',
        referencedColumns: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    ]);
  const onOpenRelatedTable = vi.fn();
  const { result, rerender } = renderHook(
    ({ tableName }) => useRelatedRows({ connectionId: 'db', tableName, onOpenRelatedTable }),
    { initialProps: { tableName: 'orders' } }
  );

  await act(async () => rerender({ tableName: 'invoices' }));
  expect(result.current.isForeignKeyColumn('customer_id')).toBe(true);

  // 古い空の応答で現在の外部キーが消えると、関連行を開けなくなる。
  await act(async () => resolveOrders([]));
  expect(result.current.isForeignKeyColumn('customer_id')).toBe(true);
});
