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

import { renderHook } from '@testing-library/react';
import { useColumnActions } from '../../hooks/useColumnActions';

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

    it('リネームが無効', () => {
      const { result } = renderHook(() => useColumnActions(createParams()));
      const items = result.current.getColumnMenuItems(makeViewColumnNode());
      const rename = items.find((i) => i.label === 'カラム名を変更');

      expect(rename?.disabled).toBe(true);
    });

    it('削除が無効', () => {
      const { result } = renderHook(() => useColumnActions(createParams()));
      const items = result.current.getColumnMenuItems(makeViewColumnNode());
      const drop = items.find((i) => i.label === 'カラムを削除');

      expect(drop?.disabled).toBe(true);
    });
  });
});
