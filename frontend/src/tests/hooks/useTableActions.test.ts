import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseObject } from '../../types';

// Mock bridge
vi.mock('../../api/bridge', () => ({
  bridge: {
    executeQuery: vi.fn(),
    getReferencingForeignKeys: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { act, renderHook } from '@testing-library/react';
import { bridge } from '../../api/bridge';
import { useTableActions } from '../../hooks/useTableActions';

function makeTableNode(overrides: Partial<DatabaseObject> = {}): DatabaseObject {
  return {
    id: 'conn1-dbo-Users',
    name: 'dbo.Users',
    type: 'table',
    metadata: { schema: 'dbo' },
    ...overrides,
  };
}

function makeViewNode(overrides: Partial<DatabaseObject> = {}): DatabaseObject {
  return {
    id: 'conn1-dbo-vw_Users',
    name: 'dbo.vw_Users',
    type: 'view',
    metadata: { schema: 'dbo' },
    ...overrides,
  };
}

function createParams() {
  return {
    connectionId: 'conn1',
    dbType: 'sqlserver' as const,
    loadTables: vi.fn(),
    setTreeData: vi.fn(),
  };
}

describe('useTableActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // テスト13: tableノードにDROP/TRUNCATEメニュー
  it('tableノード → 「テーブルを削除」「テーブルを空にする」が含まれる', () => {
    const { result } = renderHook(() => useTableActions(createParams()));
    const items = result.current.getTableMenuItems(makeTableNode());
    const drop = items.find((i) => i.label === 'テーブルを削除');
    const truncate = items.find((i) => i.label === 'テーブルを空にする');

    expect(drop).toBeDefined();
    expect(truncate).toBeDefined();
  });

  // テスト14: viewノードにはDROP/TRUNCATEメニューなし
  it('viewノード → DROP/TRUNCATEメニューが含まれない', () => {
    const { result } = renderHook(() => useTableActions(createParams()));
    const items = result.current.getTableMenuItems(makeViewNode());
    const drop = items.find((i) => i.label === 'テーブルを削除');
    const truncate = items.find((i) => i.label === 'テーブルを空にする');

    expect(drop).toBeUndefined();
    expect(truncate).toBeUndefined();
  });

  // テスト15: requestDrop FK無し
  it('requestDrop: FK無し → drop-confirm状態、hasFK=false', async () => {
    vi.mocked(bridge.getReferencingForeignKeys).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useTableActions(createParams()));

    await act(() => result.current.requestDrop(makeTableNode()));

    expect(result.current.tableAction?.type).toBe('drop-confirm');
    if (result.current.tableAction?.type === 'drop-confirm') {
      expect(result.current.tableAction.hasFK).toBe(false);
      expect(result.current.tableAction.sqls).toEqual(['DROP TABLE [dbo].[Users]']);
    }
  });

  // テスト16: requestDrop FK有り
  it('requestDrop: FK有り → drop-confirm状態、hasFK=true、sqls にFK DROP含む', async () => {
    vi.mocked(bridge.getReferencingForeignKeys).mockResolvedValueOnce([
      {
        name: 'FK_Orders_Users',
        referencingTable: 'dbo.Orders',
        referencingColumns: ['userId'],
        columns: ['id'],
        onDelete: 'NO_ACTION',
        onUpdate: 'NO_ACTION',
      },
    ]);
    const { result } = renderHook(() => useTableActions(createParams()));

    await act(() => result.current.requestDrop(makeTableNode()));

    expect(result.current.tableAction?.type).toBe('drop-confirm');
    if (result.current.tableAction?.type === 'drop-confirm') {
      expect(result.current.tableAction.hasFK).toBe(true);
      expect(result.current.tableAction.sqls[0]).toContain('DROP CONSTRAINT');
    }
  });

  // テスト17: requestTruncate FK無し
  it('requestTruncate: FK無し → truncate-confirm状態', async () => {
    vi.mocked(bridge.getReferencingForeignKeys).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useTableActions(createParams()));

    await act(() => result.current.requestTruncate(makeTableNode()));

    expect(result.current.tableAction?.type).toBe('truncate-confirm');
    if (result.current.tableAction?.type === 'truncate-confirm') {
      expect(result.current.tableAction.sqls).toEqual(['TRUNCATE TABLE [dbo].[Users]']);
    }
  });

  // テスト18: requestTruncate FK有り
  it('requestTruncate: FK有り → sqls にトランザクション含む', async () => {
    vi.mocked(bridge.getReferencingForeignKeys).mockResolvedValueOnce([
      {
        name: 'FK_Orders_Users',
        referencingTable: 'dbo.Orders',
        referencingColumns: ['userId'],
        columns: ['id'],
        onDelete: 'NO_ACTION',
        onUpdate: 'NO_ACTION',
      },
    ]);
    const { result } = renderHook(() => useTableActions(createParams()));

    await act(() => result.current.requestTruncate(makeTableNode()));

    expect(result.current.tableAction?.type).toBe('truncate-confirm');
    if (result.current.tableAction?.type === 'truncate-confirm') {
      expect(result.current.tableAction.hasFK).toBe(true);
      expect(result.current.tableAction.sqls[0]).toBe('BEGIN TRANSACTION');
      expect(result.current.tableAction.sqls[result.current.tableAction.sqls.length - 1]).toBe(
        'COMMIT'
      );
    }
  });

  // テスト19: confirmDrop → executeQuery実行 + コールバック
  it('confirmDrop: sqls を順にexecuteQuery実行 → 成功時loadTables+setTreeData呼び出し', async () => {
    vi.mocked(bridge.getReferencingForeignKeys).mockResolvedValueOnce([]);
    vi.mocked(bridge.executeQuery).mockResolvedValue({
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
      cached: false,
    });
    const params = createParams();
    params.loadTables.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useTableActions(params));

    await act(() => result.current.requestDrop(makeTableNode()));
    await act(() => result.current.confirmDrop());

    expect(bridge.executeQuery).toHaveBeenCalledWith('conn1', 'DROP TABLE [dbo].[Users]', false);
    expect(params.loadTables).toHaveBeenCalled();
    expect(params.setTreeData).toHaveBeenCalled();
    expect(result.current.tableAction).toBeNull();
  });

  // テスト20: confirmTruncate → executeQuery実行
  it('confirmTruncate: sqls を順にexecuteQuery実行', async () => {
    vi.mocked(bridge.getReferencingForeignKeys).mockResolvedValueOnce([]);
    vi.mocked(bridge.executeQuery).mockResolvedValue({
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
      cached: false,
    });
    const { result } = renderHook(() => useTableActions(createParams()));

    await act(() => result.current.requestTruncate(makeTableNode()));
    await act(() => result.current.confirmTruncate());

    expect(bridge.executeQuery).toHaveBeenCalledWith(
      'conn1',
      'TRUNCATE TABLE [dbo].[Users]',
      false
    );
    expect(result.current.tableAction).toBeNull();
  });

  // テスト21: confirmDrop失敗時 → onDdlError
  it('confirmDrop: executeQuery失敗時 → onDdlErrorコールバック', async () => {
    const error = new Error('SQL error');
    vi.mocked(bridge.getReferencingForeignKeys).mockResolvedValueOnce([]);
    vi.mocked(bridge.executeQuery).mockRejectedValueOnce(error);
    const onDdlError = vi.fn();
    const params = { ...createParams(), onDdlError };
    const { result } = renderHook(() => useTableActions(params));

    await act(() => result.current.requestDrop(makeTableNode()));
    await act(() => result.current.confirmDrop());

    expect(onDdlError).toHaveBeenCalledWith(error);
  });

  // テスト22: dismiss
  it('dismiss: tableAction が null にリセット', async () => {
    vi.mocked(bridge.getReferencingForeignKeys).mockResolvedValueOnce([]);
    const { result } = renderHook(() => useTableActions(createParams()));

    await act(() => result.current.requestDrop(makeTableNode()));
    expect(result.current.tableAction).not.toBeNull();

    act(() => result.current.dismiss());
    expect(result.current.tableAction).toBeNull();
  });
});
