import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import { useTableSchemaState } from '../../components/table/hooks/useTableSchemaState';
import type {
  Column,
  ConstraintInfo,
  ForeignKeyInfo,
  IndexInfo,
  ReferencingForeignKeyInfo,
  TableMetadata,
  TriggerInfo,
} from '../../types';

describe('useTableSchemaState', () => {
  it('returns empty initial values', () => {
    const { result } = renderHook(() => useTableSchemaState());

    expect(result.current.columns).toEqual([]);
    expect(result.current.indexes).toEqual([]);
    expect(result.current.constraints).toEqual([]);
    expect(result.current.foreignKeys).toEqual([]);
    expect(result.current.referencingForeignKeys).toEqual([]);
    expect(result.current.triggers).toEqual([]);
    expect(result.current.metadata).toBeNull();
    expect(result.current.ddl).toBe('');
  });

  it('updates columns via setColumns', () => {
    const { result } = renderHook(() => useTableSchemaState());
    const columns: Column[] = [
      {
        name: 'id',
        type: 'int',
        size: 4,
        nullable: false,
        isPrimaryKey: true,
      },
    ];

    act(() => {
      result.current.setColumns(columns);
    });

    expect(result.current.columns).toEqual(columns);
  });

  it('updates indexes via setIndexes', () => {
    const { result } = renderHook(() => useTableSchemaState());
    const indexes: IndexInfo[] = [
      { name: 'idx_id', columns: ['id'], isUnique: true, isPrimaryKey: true, type: 'CLUSTERED' },
    ];

    act(() => {
      result.current.setIndexes(indexes);
    });

    expect(result.current.indexes).toEqual(indexes);
  });

  it('updates constraints via setConstraints', () => {
    const { result } = renderHook(() => useTableSchemaState());
    const constraints: ConstraintInfo[] = [
      { name: 'pk_users', type: 'PRIMARY KEY', columns: ['id'], definition: 'PRIMARY KEY (id)' },
    ];

    act(() => {
      result.current.setConstraints(constraints);
    });

    expect(result.current.constraints).toEqual(constraints);
  });

  it('updates foreignKeys via setForeignKeys', () => {
    const { result } = renderHook(() => useTableSchemaState());
    const foreignKeys: ForeignKeyInfo[] = [
      {
        name: 'fk_user_role',
        columns: ['role_id'],
        referencedTable: 'roles',
        referencedColumns: ['id'],
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
      },
    ];

    act(() => {
      result.current.setForeignKeys(foreignKeys);
    });

    expect(result.current.foreignKeys).toEqual(foreignKeys);
  });

  it('updates referencingForeignKeys via setReferencingForeignKeys', () => {
    const { result } = renderHook(() => useTableSchemaState());
    const referencingForeignKeys: ReferencingForeignKeyInfo[] = [
      {
        name: 'fk_order_user',
        referencingTable: 'orders',
        referencingColumns: ['user_id'],
        columns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ];

    act(() => {
      result.current.setReferencingForeignKeys(referencingForeignKeys);
    });

    expect(result.current.referencingForeignKeys).toEqual(referencingForeignKeys);
  });

  it('updates triggers via setTriggers', () => {
    const { result } = renderHook(() => useTableSchemaState());
    const triggers: TriggerInfo[] = [
      {
        name: 'trg_users_audit',
        type: 'AFTER',
        events: ['INSERT'],
        isEnabled: true,
        definition: 'CREATE TRIGGER ...',
      },
    ];

    act(() => {
      result.current.setTriggers(triggers);
    });

    expect(result.current.triggers).toEqual(triggers);
  });

  it('updates metadata via setMetadata', () => {
    const { result } = renderHook(() => useTableSchemaState());
    const metadata: TableMetadata = {
      schema: 'dbo',
      name: 'users',
      type: 'TABLE',
      rowCount: 100,
      createdAt: '2024-01-01',
      modifiedAt: '2024-06-01',
      owner: 'dbo',
      comment: '',
    };

    act(() => {
      result.current.setMetadata(metadata);
    });

    expect(result.current.metadata).toEqual(metadata);
  });

  it('updates ddl via setDdl', () => {
    const { result } = renderHook(() => useTableSchemaState());

    act(() => {
      result.current.setDdl('CREATE TABLE users (id INT)');
    });

    expect(result.current.ddl).toBe('CREATE TABLE users (id INT)');
  });

  it('keeps each state independent', () => {
    const { result } = renderHook(() => useTableSchemaState());

    act(() => {
      result.current.setDdl('SELECT 1');
    });

    expect(result.current.ddl).toBe('SELECT 1');
    expect(result.current.columns).toEqual([]);
    expect(result.current.indexes).toEqual([]);
    expect(result.current.metadata).toBeNull();
  });
});
