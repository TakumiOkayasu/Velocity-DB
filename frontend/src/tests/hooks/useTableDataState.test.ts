import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTableDataState } from '../../components/table/hooks/useTableDataState';
import type { ResultSet } from '../../types';

describe('useTableDataState', () => {
  it('returns null resultSet and empty whereClause as initial values', () => {
    const { result } = renderHook(() => useTableDataState());

    expect(result.current.resultSet).toBeNull();
    expect(result.current.whereClause).toBe('');
  });

  it('updates resultSet via setResultSet', () => {
    const { result } = renderHook(() => useTableDataState());
    const resultSet: ResultSet = {
      columns: [{ name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true }],
      rows: [['1']],
      affectedRows: 1,
      executionTimeMs: 10,
    };

    act(() => {
      result.current.setResultSet(resultSet);
    });

    expect(result.current.resultSet).toEqual(resultSet);
  });

  it('clears resultSet when set to null', () => {
    const { result } = renderHook(() => useTableDataState());
    const resultSet: ResultSet = {
      columns: [],
      rows: [],
      affectedRows: 0,
      executionTimeMs: 0,
    };

    act(() => {
      result.current.setResultSet(resultSet);
    });
    expect(result.current.resultSet).not.toBeNull();

    act(() => {
      result.current.setResultSet(null);
    });
    expect(result.current.resultSet).toBeNull();
  });

  it('updates whereClause via setWhereClause', () => {
    const { result } = renderHook(() => useTableDataState());

    act(() => {
      result.current.setWhereClause("name = 'foo'");
    });

    expect(result.current.whereClause).toBe("name = 'foo'");
  });

  it('resets whereClause to empty string', () => {
    const { result } = renderHook(() => useTableDataState());

    act(() => {
      result.current.setWhereClause('id > 10');
    });
    expect(result.current.whereClause).toBe('id > 10');

    act(() => {
      result.current.setWhereClause('');
    });
    expect(result.current.whereClause).toBe('');
  });

  it('keeps resultSet and whereClause independent', () => {
    const { result } = renderHook(() => useTableDataState());

    act(() => {
      result.current.setWhereClause('id > 10');
    });

    expect(result.current.whereClause).toBe('id > 10');
    expect(result.current.resultSet).toBeNull();
  });
});
