import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { queryProvider } from '../../api/providers';
import { useGridEdit } from '../../components/grid/hooks/useGridEdit';
import { useEditStore } from '../../store/editStore';
import type { Query, ResultSet } from '../../types';

vi.mock('../../api/providers', () => ({
  queryProvider: {
    buildDmlStatements: vi.fn(),
    executeQuery: vi.fn(),
  },
}));
vi.mock('../../utils/logger', () => ({ log: { debug: vi.fn() } }));

const resultSet: ResultSet = {
  columns: [
    { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
    { name: 'name', type: 'varchar', size: 50, nullable: true, isPrimaryKey: false },
  ],
  rows: [
    ['1', 'old'],
    ['2', null],
  ],
  affectedRows: 0,
  executionTimeMs: 0,
};
const query: Query = {
  id: 'q1',
  name: 'users',
  sourceTable: 'dbo.users',
  connectionId: 'c1',
  content: '',
  isDirty: false,
};
const rows = [
  { __rowIndex: '1', __originalIndex: '0', id: '1', name: 'old' },
  { __rowIndex: '2', __originalIndex: '1', id: '2', name: null },
];
const options = {
  resultSet,
  currentQuery: query,
  activeConnectionId: 'c1',
  rowData: rows,
  selectedRows: new Set<number>(),
  isReadOnly: false,
};
const sql = [
  "UPDATE users SET id = 3, name = 'new' WHERE id = 1;",
  "UPDATE users SET name = 'other' WHERE id = 2;",
];

beforeEach(() => {
  useEditStore.getState().clearTableContext();
  useEditStore.getState().revertAll();
  vi.resetAllMocks();
  vi.mocked(queryProvider.buildDmlStatements).mockResolvedValue({ statements: sql });
  vi.mocked(queryProvider.executeQuery).mockResolvedValue({ ...resultSet, cached: false });
});

describe('batch save', () => {
  it('sends all columns/rows once, preserves original keys on re-edit, then refreshes', async () => {
    const onApplied = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useGridEdit({ ...options, onApplied }));
    act(() => {
      result.current.updateCell(0, 'id', '1', '3');
      result.current.updateCell(0, 'name', 'old', 'first');
      result.current.updateCell(0, 'name', 'first', 'new');
      result.current.updateCell(1, 'name', null, 'other');
    });
    expect(result.current.getCellChange(0, 'name')?.newValue).toBe('new');
    await act(() => result.current.applyChanges());
    expect(queryProvider.buildDmlStatements).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({
        updates: [
          {
            changes: { id: '3', name: 'new' },
            originalData: expect.objectContaining({ id: '1', name: 'old' }),
          },
          {
            changes: { name: 'other' },
            originalData: expect.objectContaining({ id: '2', name: null }),
          },
        ],
      })
    );
    expect(queryProvider.executeQuery).toHaveBeenCalledExactlyOnceWith('c1', sql.join('\n'), false);
    expect(onApplied).toHaveBeenCalledOnce();
    expect(result.current.hasChanges).toBe(false);
  });

  it('keeps edits on execution failure and supports retry', async () => {
    vi.mocked(queryProvider.executeQuery).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useGridEdit(options));
    act(() => result.current.updateCell(0, 'name', 'old', 'new'));
    await act(() => result.current.applyChanges());
    expect(result.current.applyError).toBe('offline');
    expect(result.current.hasChanges).toBe(true);
    expect(result.current.getCellChange(0, 'name')?.newValue).toBe('new');
    await act(() => result.current.applyChanges());
    expect(result.current.hasChanges).toBe(false);
  });

  it('validates the latest store synchronously, including the active cell committed by Ctrl+S', async () => {
    const { result } = renderHook(() => useGridEdit(options));
    await act(async () => {
      result.current.updateCell(0, 'id', '1', null);
      await result.current.applyChanges();
    });
    expect(queryProvider.buildDmlStatements).not.toHaveBeenCalled();
    expect(result.current.hasValidationErrors).toBe(true);
  });

  it('guards duplicate save and further edits while DML is being built', async () => {
    let finish: ((value: { statements: string[] }) => void) | undefined;
    vi.mocked(queryProvider.buildDmlStatements).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result } = renderHook(() => useGridEdit(options));
    act(() => result.current.updateCell(0, 'name', 'old', 'new'));
    let saving: Promise<void> | undefined;
    act(() => {
      saving = result.current.applyChanges();
    });
    await act(async () => {
      await result.current.applyChanges();
      result.current.updateCell(0, 'name', 'new', 'lost');
      result.current.revertChanges();
    });
    expect(queryProvider.buildDmlStatements).toHaveBeenCalledTimes(1);
    expect(result.current.getCellChange(0, 'name')?.newValue).toBe('new');
    await act(async () => {
      finish?.({ statements: sql });
      await saving;
    });
    expect(queryProvider.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('does not execute a stale build after switching tables', async () => {
    let finish: ((value: { statements: string[] }) => void) | undefined;
    vi.mocked(queryProvider.buildDmlStatements).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result, rerender } = renderHook(
      ({ currentQuery }) => useGridEdit({ ...options, currentQuery }),
      { initialProps: { currentQuery: query } }
    );
    act(() => result.current.updateCell(0, 'name', 'old', 'new'));
    let saving: Promise<void> | undefined;
    act(() => {
      saving = result.current.applyChanges();
    });
    rerender({ currentQuery: { ...query, id: 'q2', sourceTable: 'dbo.other' } });
    await act(async () => {
      finish?.({ statements: sql });
      await saving;
    });
    expect(queryProvider.executeQuery).not.toHaveBeenCalled();
  });

  it('re-editing back to original null removes the pending change', () => {
    const { result } = renderHook(() => useGridEdit(options));
    act(() => {
      result.current.updateCell(1, 'name', null, 'temporary');
      result.current.updateCell(1, 'name', 'temporary', null);
    });
    expect(result.current.hasChanges).toBe(false);
  });
});
