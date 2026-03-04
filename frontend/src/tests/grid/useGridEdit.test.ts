import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridEdit } from '../../components/grid/hooks/useGridEdit';
import type { Query } from '../../types';

// Mock editStore
const mockSetEditMode = vi.fn();
const mockRevertAll = vi.fn();
let mockIsEditMode = false;

vi.mock('../../store/editStore', () => ({
  useEditStore: () => ({
    isEditMode: mockIsEditMode,
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
    addNewRow: vi.fn(),
    getDmlParams: () => null,
    setTableContext: vi.fn(),
    clearTableContext: vi.fn(),
    primaryKeyColumns: [],
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

describe('useGridEdit read-only guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEditMode = false;
  });

  it('isReadOnly=true で handleToggleEditMode が編集開始をブロック', () => {
    const { result } = renderHook(() => useGridEdit({ ...baseOptions, isReadOnly: true }));

    act(() => {
      result.current.handleToggleEditMode();
    });

    expect(mockSetEditMode).not.toHaveBeenCalled();
  });

  it('isReadOnly=true でも isEditMode=true なら編集終了できる', () => {
    mockIsEditMode = true;
    const { result } = renderHook(() => useGridEdit({ ...baseOptions, isReadOnly: true }));

    act(() => {
      result.current.handleToggleEditMode();
    });

    expect(mockSetEditMode).toHaveBeenCalledWith(false);
    expect(mockRevertAll).toHaveBeenCalled();
  });

  it('isReadOnly=true で handleApplyChanges がブロック+エラーメッセージ設定', async () => {
    const { result } = renderHook(() =>
      useGridEdit({
        ...baseOptions,
        isReadOnly: true,
        activeConnectionId: 'conn-1',
        currentQuery: {
          id: 'q1',
          connectionId: 'conn-1',
          sourceTable: 'users',
          sql: 'SELECT * FROM users',
        } as unknown as Query,
      })
    );

    await act(async () => {
      await result.current.handleApplyChanges();
    });

    expect(result.current.applyError).toBe('読み取り専用モードのため変更を適用できません');
  });

  it('isReadOnly=true で handleDeleteRow がブロック+エラーメッセージ設定', () => {
    const { result } = renderHook(() =>
      useGridEdit({ ...baseOptions, isReadOnly: true, selectedRows: new Set([0]) })
    );

    act(() => {
      result.current.handleDeleteRow();
    });

    expect(result.current.applyError).toBe('読み取り専用モードのため変更できません');
  });

  it('isReadOnly=true で handleCloneRow がブロック+エラーメッセージ設定', () => {
    const { result } = renderHook(() =>
      useGridEdit({
        ...baseOptions,
        isReadOnly: true,
        selectedRows: new Set([0]),
        rowData: [{ __rowIndex: '1', __originalIndex: '0', name: 'test' }],
      })
    );

    act(() => {
      result.current.handleCloneRow();
    });

    expect(result.current.applyError).toBe('読み取り専用モードのため変更できません');
  });

  it('isReadOnly=false で handleToggleEditMode が通常動作', () => {
    const { result } = renderHook(() => useGridEdit({ ...baseOptions, isReadOnly: false }));

    act(() => {
      result.current.handleToggleEditMode();
    });

    expect(mockSetEditMode).toHaveBeenCalledWith(true);
  });
});
