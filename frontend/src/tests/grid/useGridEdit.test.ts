import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridEdit } from '../../components/grid/hooks/useGridEdit';
import type { Query, ResultSet } from '../../types';

// Mock editStore
const mockSetEditMode = vi.fn();
const mockRevertAll = vi.fn();
const mockAddNewRow = vi.fn();

vi.mock('../../store/editStore', () => ({
  useEditStore: () => ({
    isEditMode: false,
    setEditMode: mockSetEditMode,
    updateCell: vi.fn(),
    revertAll: mockRevertAll,
    hasChanges: () => false,
    getCellChange: () => null,
    isRowDeleted: () => false,
    isRowInserted: () => false,
    insertedRows: new Map(),
    markRowDeleted: vi.fn(),
    unmarkRowDeleted: vi.fn(),
    addNewRow: mockAddNewRow,
    getDmlParams: () => null,
    setTableContext: vi.fn(),
    clearTableContext: vi.fn(),
    primaryKeyColumns: [],
    pendingChanges: new Map(),
    setValidationErrors: vi.fn(),
    getValidationError: () => null,
    hasValidationErrors: () => false,
  }),
}));

vi.mock('../../api/bridge', () => ({
  bridge: {
    buildDmlStatements: vi.fn(),
    executeQuery: vi.fn(),
  },
}));

vi.mock('../../utils/logger', () => ({
  log: { debug: vi.fn() },
}));

const baseOptions = {
  resultSet: null,
  currentQuery: undefined,
  activeConnectionId: null,
  rowData: [],
  selectedRows: new Set<number>(),
  isReadOnly: false,
};

const mockResultSet = {
  columns: [
    { name: 'id', type: 'int', isPrimaryKey: true },
    { name: 'name', type: 'varchar', isPrimaryKey: false },
  ],
  rows: [],
  executionTimeMs: 1,
  affectedRows: 0,
  truncated: false,
} as unknown as ResultSet;

const mockQuery = {
  id: 'q1',
  connectionId: 'conn-1',
  sourceTable: 'users',
  sql: 'SELECT * FROM users',
} as unknown as Query;

describe('useGridEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('always-on edit mode', () => {
    it('sourceTable存在 + isReadOnly=false → isEditMode=true', () => {
      const { result } = renderHook(() =>
        useGridEdit({
          ...baseOptions,
          currentQuery: mockQuery,
          resultSet: mockResultSet,
          activeConnectionId: 'conn-1',
        })
      );
      expect(result.current.isEditMode).toBe(true);
    });

    it('sourceTable存在 + isReadOnly=true → isEditMode=false', () => {
      const { result } = renderHook(() =>
        useGridEdit({
          ...baseOptions,
          currentQuery: mockQuery,
          resultSet: mockResultSet,
          activeConnectionId: 'conn-1',
          isReadOnly: true,
        })
      );
      expect(result.current.isEditMode).toBe(false);
    });

    it('sourceTableなし → isEditMode=false', () => {
      const { result } = renderHook(() =>
        useGridEdit({
          ...baseOptions,
          currentQuery: { ...mockQuery, sourceTable: undefined } as unknown as Query,
        })
      );
      expect(result.current.isEditMode).toBe(false);
    });

    it('setEditModeがisEditModeと同期される', () => {
      renderHook(() =>
        useGridEdit({
          ...baseOptions,
          currentQuery: mockQuery,
          resultSet: mockResultSet,
          activeConnectionId: 'conn-1',
        })
      );
      expect(mockSetEditMode).toHaveBeenCalledWith(true);
    });
  });

  describe('read-only guard', () => {
    it('isReadOnly=true で buildPreview がブロック+エラーメッセージ', async () => {
      const { result } = renderHook(() =>
        useGridEdit({
          ...baseOptions,
          isReadOnly: true,
          activeConnectionId: 'conn-1',
          currentQuery: mockQuery,
        })
      );

      await act(async () => {
        await result.current.buildPreview();
      });

      expect(result.current.applyError).toBe('読み取り専用モードのため変更を適用できません');
    });

    it('isReadOnly=true で deleteRow がブロック+エラーメッセージ', () => {
      const { result } = renderHook(() =>
        useGridEdit({ ...baseOptions, isReadOnly: true, selectedRows: new Set([0]) })
      );

      act(() => {
        result.current.deleteRow();
      });

      expect(result.current.applyError).toBe('読み取り専用モードのため変更できません');
    });

    it('isReadOnly=true で cloneRow がブロック+エラーメッセージ', () => {
      const { result } = renderHook(() =>
        useGridEdit({
          ...baseOptions,
          isReadOnly: true,
          selectedRows: new Set([0]),
          rowData: [{ __rowIndex: '1', __originalIndex: '0', name: 'test' }],
        })
      );

      act(() => {
        result.current.cloneRow();
      });

      expect(result.current.applyError).toBe('読み取り専用モードのため変更できません');
    });

    it('isReadOnly=true で insertRow がブロック+エラーメッセージ', () => {
      const { result } = renderHook(() =>
        useGridEdit({
          ...baseOptions,
          isReadOnly: true,
          resultSet: mockResultSet,
        })
      );

      act(() => {
        result.current.insertRow();
      });

      expect(result.current.applyError).toBe('読み取り専用モードのため変更できません');
    });
  });

  describe('insertRow', () => {
    it('resultSetがある場合、全カラムNULLの新規行を追加', () => {
      const { result } = renderHook(() =>
        useGridEdit({
          ...baseOptions,
          resultSet: mockResultSet,
          currentQuery: mockQuery,
          activeConnectionId: 'conn-1',
        })
      );

      act(() => {
        result.current.insertRow();
      });

      expect(mockAddNewRow).toHaveBeenCalledWith({ id: null, name: null });
    });

    it('resultSetがない場合、何もしない', () => {
      const { result } = renderHook(() => useGridEdit({ ...baseOptions, resultSet: null }));

      act(() => {
        result.current.insertRow();
      });

      expect(mockAddNewRow).not.toHaveBeenCalled();
    });
  });
});
