import { describe, expect, it, vi } from 'vitest';
import type { DatabaseObject } from '../../types';

// Mock bridge
vi.mock('../../api/bridge', () => ({
  bridge: {
    executeQuery: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  log: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Partial mock: fetchViewDefinition だけをモック (他は実装を維持)
vi.mock('../../utils/sqlIdentifier', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../utils/sqlIdentifier')>();
  return {
    ...orig,
    fetchViewDefinition: vi.fn().mockResolvedValue(''),
  };
});

import { act, renderHook } from '@testing-library/react';
import { useColumnActions } from '../../hooks/useColumnActions';
import { fetchViewDefinition } from '../../utils/sqlIdentifier';

function makeColumnNode(overrides: Partial<DatabaseObject> = {}): DatabaseObject {
  return {
    id: 'conn1-dbo-Users-name',
    name: 'name (varchar, NOT NULL)',
    type: 'column',
    metadata: {
      schema: 'dbo',
      tableName: 'Users',
      isPrimaryKey: false,
      nullable: false,
      columnType: 'varchar',
    },
    ...overrides,
  };
}

function makeViewColumnNode(overrides: Partial<DatabaseObject> = {}): DatabaseObject {
  return {
    id: 'conn1-dbo-vw_Users-name',
    name: 'name (varchar)',
    type: 'column',
    metadata: {
      schema: 'dbo',
      tableName: 'vw_Users',
      isPrimaryKey: false,
      nullable: true,
      columnType: 'varchar',
      objectType: 'view',
    },
    ...overrides,
  };
}

function createParams() {
  return {
    connectionId: 'conn1',
    dbType: 'sqlserver' as const,
    isReadOnly: false,
    loadColumns: vi.fn(),
    setTreeData: vi.fn(),
  };
}

describe('useColumnActions', () => {
  describe('テーブルカラム', () => {
    it('リネーム・削除が有効', () => {
      const { result } = renderHook(() => useColumnActions(createParams()));
      const items = result.current.getColumnMenuItems(makeColumnNode());
      const rename = items.find((i) => i.label === 'カラム名を変更');
      const drop = items.find((i) => i.label === 'カラムを削除');

      expect(rename?.disabled).toBeFalsy();
      expect(drop?.disabled).toBeFalsy();
    });

    it('コピー系メニューが有効', () => {
      const { result } = renderHook(() => useColumnActions(createParams()));
      const items = result.current.getColumnMenuItems(makeColumnNode());
      const copy = items.find((i) => i.label === 'カラム名をコピー');
      const where = items.find((i) => i.label === 'WHERE句をコピー');

      expect(copy?.disabled).toBeFalsy();
      expect(where?.disabled).toBeFalsy();
    });
  });

  describe('ビューカラム', () => {
    it('コピー系メニューが有効', () => {
      const { result } = renderHook(() => useColumnActions(createParams()));
      const items = result.current.getColumnMenuItems(makeViewColumnNode());
      const copy = items.find((i) => i.label === 'カラム名をコピー');
      const where = items.find((i) => i.label === 'WHERE句をコピー');

      expect(copy?.disabled).toBeFalsy();
      expect(where?.disabled).toBeFalsy();
    });

    it('リネームが有効 (ALTER VIEWで定義書き換え)', () => {
      const { result } = renderHook(() => useColumnActions(createParams()));
      const items = result.current.getColumnMenuItems(makeViewColumnNode());
      const rename = items.find((i) => i.label === 'カラム名を変更');

      expect(rename?.disabled).toBeFalsy();
    });

    it('削除が無効', () => {
      const { result } = renderHook(() => useColumnActions(createParams()));
      const items = result.current.getColumnMenuItems(makeViewColumnNode());
      const drop = items.find((i) => i.label === 'カラムを削除');

      expect(drop?.disabled).toBe(true);
    });

    it('fetchViewDefinition が throw した場合 onDdlError に委譲', async () => {
      const networkError = new Error('Network failure');
      vi.mocked(fetchViewDefinition).mockRejectedValueOnce(networkError);

      const onDdlError = vi.fn();
      const params = { ...createParams(), onDdlError };
      const { result } = renderHook(() => useColumnActions(params));

      // Set rename-input state for a view column
      const items = result.current.getColumnMenuItems(makeViewColumnNode());
      const rename = items.find((i) => i.label === 'カラム名を変更');
      await act(() => rename?.action());

      expect(result.current.columnAction?.type).toBe('rename-input');

      // handleRenameInput should catch the error
      await act(() => result.current.handleRenameInput('new_name'));

      expect(onDdlError).toHaveBeenCalledWith(networkError);
      expect(result.current.columnAction).toBeNull();
    });
  });
});
