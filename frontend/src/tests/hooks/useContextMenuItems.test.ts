import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseObject, MenuItem } from '../../types';

vi.mock('../../api/providers', () => ({
  schemaProvider: {
    getColumns: vi.fn(),
  },
}));

vi.mock('../../utils/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { act, renderHook } from '@testing-library/react';
import { schemaProvider as bridge } from '../../api/providers';
import { useContextMenuItems } from '../../hooks/useContextMenuItems';

function makeNode(overrides: Partial<DatabaseObject> = {}): DatabaseObject {
  return {
    id: 'c1-dbo-Users',
    name: 'dbo.Users',
    type: 'table',
    metadata: { schema: 'dbo' },
    ...overrides,
  };
}

function createParams(overrides: Partial<Parameters<typeof useContextMenuItems>[0]> = {}) {
  return {
    connectionId: 'c1',
    dbType: 'sqlserver' as const,
    onTableOpen: vi.fn(),
    loadTables: vi.fn().mockResolvedValue([]),
    setTreeData: vi.fn(),
    setLoadingNodes: vi.fn(),
    getColumnMenuItems: vi.fn().mockReturnValue([] as MenuItem[]),
    getTableMenuItems: vi.fn().mockReturnValue([] as MenuItem[]),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    addToast: vi.fn(),
    closeConnection: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

describe('useContextMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('table ノード', () => {
    it('SELECT/INSERT/データを開く/カラム一覧をコピーが含まれる', () => {
      const { result } = renderHook(() => useContextMenuItems(createParams()));
      const items = result.current.getMenuItems(makeNode({ type: 'table' }));
      const labels = items.map((i) => i.label);

      expect(labels).toContain('SELECT文をコピー');
      expect(labels).toContain('INSERT文をコピー');
      expect(labels).toContain('データを開く');
      expect(labels).toContain('カラム一覧をコピー');
    });

    it('getTableMenuItems の項目が末尾に divider 付きで合成される', () => {
      const tableMenuItems: MenuItem[] = [{ label: 'テーブルを削除', action: vi.fn() }];
      const params = createParams({ getTableMenuItems: vi.fn().mockReturnValue(tableMenuItems) });
      const { result } = renderHook(() => useContextMenuItems(params));
      const items = result.current.getMenuItems(makeNode({ type: 'table' }));

      const dropIdx = items.findIndex((i) => i.label === 'テーブルを削除');
      expect(dropIdx).toBeGreaterThan(0);
      expect(items[dropIdx - 1].divider).toBe(true);
    });

    it('getTableMenuItems が空配列のとき末尾 divider は付与されない', () => {
      const { result } = renderHook(() => useContextMenuItems(createParams()));
      const items = result.current.getMenuItems(makeNode({ type: 'table' }));

      expect(items[items.length - 1].divider).toBeFalsy();
      expect(items[items.length - 1].label).toBe('カラム一覧をコピー');
    });
  });

  describe('view ノード', () => {
    it('INSERT文をコピー が含まれない (SELECT文は含まれる)', () => {
      const { result } = renderHook(() => useContextMenuItems(createParams()));
      const items = result.current.getMenuItems(makeNode({ type: 'view', name: 'dbo.vw_Users' }));
      const labels = items.map((i) => i.label);

      expect(labels).toContain('SELECT文をコピー');
      expect(labels).not.toContain('INSERT文をコピー');
    });

    it('view では getTableMenuItems の結果は反映されない (空)', () => {
      const tableMenuItems: MenuItem[] = [{ label: 'テーブルを削除', action: vi.fn() }];
      const getTableMenuItems = vi.fn((n: DatabaseObject) =>
        n.type === 'table' ? tableMenuItems : []
      );
      const { result } = renderHook(() => useContextMenuItems(createParams({ getTableMenuItems })));
      const items = result.current.getMenuItems(makeNode({ type: 'view', name: 'dbo.vw_Users' }));

      expect(items.find((i) => i.label === 'テーブルを削除')).toBeUndefined();
    });
  });

  describe('database ノード', () => {
    it('リフレッシュ + 接続を閉じる が含まれる', () => {
      const { result } = renderHook(() => useContextMenuItems(createParams()));
      const items = result.current.getMenuItems(makeNode({ type: 'database', name: 'srv/db' }));
      const labels = items.map((i) => i.label);

      expect(labels).toContain('リフレッシュ');
      expect(labels).toContain('接続を閉じる');
    });

    it('リフレッシュ実行 → setLoadingNodes/loadTables/setTreeData の順で呼ばれる', async () => {
      const params = createParams();
      vi.mocked(params.loadTables).mockResolvedValueOnce([{ id: 'x', name: 'x', type: 'folder' }]);
      const { result } = renderHook(() => useContextMenuItems(params));
      const items = result.current.getMenuItems(makeNode({ type: 'database' }));
      const refresh = items.find((i) => i.label === 'リフレッシュ');

      await act(async () => {
        await refresh?.action();
      });

      const lnOrder = vi.mocked(params.setLoadingNodes).mock.invocationCallOrder[0];
      const ltOrder = vi.mocked(params.loadTables).mock.invocationCallOrder[0];
      const tdOrder = vi.mocked(params.setTreeData).mock.invocationCallOrder[0];
      expect(lnOrder).toBeLessThan(ltOrder);
      expect(ltOrder).toBeLessThan(tdOrder);
    });

    it('接続を閉じる → 注入された closeConnection(connectionId) が呼ばれる', async () => {
      const params = createParams();
      const { result } = renderHook(() => useContextMenuItems(params));
      const items = result.current.getMenuItems(makeNode({ type: 'database' }));
      const close = items.find((i) => i.label === '接続を閉じる');

      await act(async () => {
        await close?.action();
      });

      expect(params.closeConnection).toHaveBeenCalledWith('c1');
    });
  });

  describe('column ノード', () => {
    it('getColumnMenuItems の結果がそのまま返る', () => {
      const columnItems: MenuItem[] = [{ label: '列名変更', action: vi.fn() }];
      const params = createParams({ getColumnMenuItems: vi.fn().mockReturnValue(columnItems) });
      const { result } = renderHook(() => useContextMenuItems(params));
      const items = result.current.getMenuItems(makeNode({ type: 'column', name: 'id' }));

      expect(items).toEqual(columnItems);
    });
  });

  describe('action 動作', () => {
    it('SELECT文をコピー → navigator.clipboard.writeText に SELECT SQL が渡る', async () => {
      const { result } = renderHook(() => useContextMenuItems(createParams()));
      const items = result.current.getMenuItems(makeNode({ type: 'table' }));
      const select = items.find((i) => i.label === 'SELECT文をコピー');

      await act(async () => {
        await select?.action();
      });

      expect(writeTextMock).toHaveBeenCalled();
      expect(writeTextMock.mock.calls[0][0]).toMatch(/SELECT/i);
    });

    it('INSERT文をコピー成功 → copyToClipboard に INSERT SQL とメッセージが渡る', async () => {
      vi.mocked(bridge.getColumns).mockResolvedValueOnce([
        { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
      ]);
      const params = createParams();
      const { result } = renderHook(() => useContextMenuItems(params));
      const items = result.current.getMenuItems(makeNode({ type: 'table' }));
      const insert = items.find((i) => i.label === 'INSERT文をコピー');

      await act(async () => {
        await insert?.action();
      });

      const copyMock = vi.mocked(params.copyToClipboard);
      expect(copyMock).toHaveBeenCalled();
      expect(copyMock.mock.calls[0][0]).toMatch(/INSERT/i);
      expect(copyMock.mock.calls[0][1]).toBe('INSERT文をコピーしました');
    });

    it('INSERT文をコピー失敗 → toast にエラー通知', async () => {
      vi.mocked(bridge.getColumns).mockRejectedValueOnce(new Error('boom'));
      const params = createParams();
      const { result } = renderHook(() => useContextMenuItems(params));
      const items = result.current.getMenuItems(makeNode({ type: 'table' }));
      const insert = items.find((i) => i.label === 'INSERT文をコピー');

      await act(async () => {
        await insert?.action();
      });

      expect(params.addToast).toHaveBeenCalledWith('INSERT文の生成に失敗しました', 'error');
    });

    it('データを開く → onTableOpen(name, type, connectionId)', () => {
      const params = createParams();
      const { result } = renderHook(() => useContextMenuItems(params));
      const items = result.current.getMenuItems(makeNode({ type: 'table' }));
      const open = items.find((i) => i.label === 'データを開く');

      act(() => {
        open?.action();
      });

      expect(params.onTableOpen).toHaveBeenCalledWith('dbo.Users', 'table', 'c1');
    });

    it('カラム一覧をコピー → カラム名カンマ連結を clipboard に書く', async () => {
      vi.mocked(bridge.getColumns).mockResolvedValueOnce([
        { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
        { name: 'name', type: 'varchar', size: 100, nullable: true, isPrimaryKey: false },
      ]);
      const { result } = renderHook(() => useContextMenuItems(createParams()));
      const items = result.current.getMenuItems(makeNode({ type: 'table' }));
      const copy = items.find((i) => i.label === 'カラム一覧をコピー');

      await act(async () => {
        await copy?.action();
      });

      expect(writeTextMock).toHaveBeenCalledWith('id, name');
    });
  });

  it('未対応 type (folder) → 空配列', () => {
    const { result } = renderHook(() => useContextMenuItems(createParams()));
    const items = result.current.getMenuItems(makeNode({ type: 'folder', name: 'Tables' }));
    expect(items).toEqual([]);
  });
});
