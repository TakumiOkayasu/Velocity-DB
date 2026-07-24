import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockIpcInvoker } from '../../api/ipc/mock-ipc-invoker';
import { __setIpcInvokerForTest, schemaProvider } from '../../api/providers';
import { log } from '../../utils/logger';

describe('schemaProvider', () => {
  let mock: MockIpcInvoker;
  let infoSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    mock = new MockIpcInvoker();
    __setIpcInvokerForTest(mock);
  });

  // log singleton への spy は assertion 失敗時にも確実に剥がす (テスト独立性)
  afterEach(() => {
    infoSpy?.mockRestore();
    infoSpy = null;
  });

  it('getDatabases は IPC を呼び出し string[] を返す', async () => {
    mock.setResponse('getDatabases', ['db1', 'db2']);

    const result = await schemaProvider.getDatabases('conn-1');

    expect(result).toEqual(['db1', 'db2']);
    expect(mock.calls[0]).toEqual({ method: 'getDatabases', params: { connectionId: 'conn-1' } });
  });

  it('getDatabases が schema 不一致だと throw する', async () => {
    mock.setResponse('getDatabases', [{ wrong: 'shape' }]);

    await expect(schemaProvider.getDatabases('conn-1')).rejects.toThrow();
  });

  it('getTables はタプル応答をオブジェクトへ復元し loadTimeMs を含む結果を返す (#514)', async () => {
    mock.setResponse('getTables', [
      ['public', 't1', 'TABLE', ''],
      ['public', 't2', 'VIEW', 'c'],
    ]);

    const result = await schemaProvider.getTables('conn-1', 'db1');

    expect(result.tables).toHaveLength(2);
    expect(result.tables[0]).toEqual({ schema: 'public', name: 't1', type: 'TABLE' });
    expect(result.tables[1]).toEqual({ schema: 'public', name: 't2', type: 'VIEW', comment: 'c' });
    expect(typeof result.loadTimeMs).toBe('number');
    expect(result.loadTimeMs).toBeGreaterThanOrEqual(0);
    expect(mock.calls[0]).toEqual({
      method: 'getTables',
      params: { connectionId: 'conn-1', database: 'db1' },
    });
  });

  it('getTables は旧オブジェクト形式の応答に対して throw する (#514 ワイヤ形式検証)', async () => {
    mock.setResponse('getTables', [{ schema: 'public', name: 't1', type: 'TABLE' }]);

    await expect(schemaProvider.getTables('conn-1', 'db1')).rejects.toThrow();
  });

  it('getColumns はタプル応答を ColumnInfo へ復元する (#514)', async () => {
    mock.setResponse('getColumns', [['id', 'int', 4, false, true, '']]);

    const result = await schemaProvider.getColumns('conn-1', 'users');

    expect(result).toEqual([
      { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
    ]);
    expect(mock.calls[0]?.params).toEqual({ connectionId: 'conn-1', table: 'users' });
  });

  it('getColumns は comment 付きタプルの comment を保持する (#514)', async () => {
    mock.setResponse('getColumns', [['id', 'int', 4, false, true, '主キー']]);

    const result = await schemaProvider.getColumns('conn-1', 'users');

    expect(result[0]?.comment).toBe('主キー');
  });

  it('getAllColumns は connectionId を渡しテーブル毎の列配列を返す (#512, #514)', async () => {
    mock.setResponse('getAllColumns', [['dbo', 'users', [['id', 'int', 4, false, true, '']]]]);

    const result = await schemaProvider.getAllColumns('conn-1');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ schema: 'dbo', table: 'users' });
    expect(result[0].columns).toEqual([
      { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
    ]);
    expect(mock.calls[0]).toEqual({ method: 'getAllColumns', params: { connectionId: 'conn-1' } });
  });

  it('getIndexes は index 配列を返す', async () => {
    mock.setResponse('getIndexes', [
      { name: 'pk_users', columns: ['id'], isUnique: true, isPrimaryKey: true, type: 'BTREE' },
    ]);

    const result = await schemaProvider.getIndexes('conn-1', 'users');

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('pk_users');
    expect(mock.calls[0]?.method).toBe('getIndexes');
  });

  it('getConstraints は ConstraintInfo[] を返す', async () => {
    mock.setResponse('getConstraints', [
      { name: 'pk', type: 'PRIMARY KEY', columns: ['id'], definition: 'PK(id)' },
    ]);

    const result = await schemaProvider.getConstraints('conn-1', 'users');

    expect(result[0]?.type).toBe('PRIMARY KEY');
  });

  it('getForeignKeys は FK 配列を返す', async () => {
    mock.setResponse('getForeignKeys', [
      {
        name: 'fk_a',
        columns: ['user_id'],
        referencedTable: 'users',
        referencedColumns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ]);

    const result = await schemaProvider.getForeignKeys('conn-1', 'orders');

    expect(result[0]?.referencedTable).toBe('users');
  });

  it('getReferencingForeignKeys は逆参照 FK 配列を返す', async () => {
    mock.setResponse('getReferencingForeignKeys', [
      {
        name: 'fk_a',
        referencingTable: 'orders',
        referencingColumns: ['user_id'],
        columns: ['id'],
        onDelete: 'CASCADE',
        onUpdate: 'NO ACTION',
      },
    ]);

    const result = await schemaProvider.getReferencingForeignKeys('conn-1', 'users');

    expect(result[0]?.referencingTable).toBe('orders');
  });

  it('getTriggers は trigger 配列を返す', async () => {
    mock.setResponse('getTriggers', [
      {
        name: 'trg_audit',
        type: 'AFTER',
        events: ['INSERT'],
        isEnabled: true,
        definition: 'BEGIN ... END',
      },
    ]);

    const result = await schemaProvider.getTriggers('conn-1', 'users');

    expect(result[0]?.events).toEqual(['INSERT']);
  });

  it('getTableMetadata は TableMetadata を返す', async () => {
    mock.setResponse('getTableMetadata', {
      schema: 'public',
      name: 'users',
      type: 'TABLE',
      rowCount: 100,
      createdAt: '2026-01-01',
      modifiedAt: '2026-01-02',
      owner: 'postgres',
      comment: '',
    });

    const result = await schemaProvider.getTableMetadata('conn-1', 'users');

    expect(result.rowCount).toBe(100);
    expect(result.type).toBe('TABLE');
  });

  it('getTableDDL は { ddl } を返す', async () => {
    mock.setResponse('getTableDDL', { ddl: 'CREATE TABLE users (...)' });

    const result = await schemaProvider.getTableDDL('conn-1', 'users');

    expect(result.ddl).toContain('CREATE TABLE');
  });

  it('clearSchemaCache は { cleared } を返し空 params を渡す', async () => {
    mock.setResponse('clearSchemaCache', { cleared: true });

    const result = await schemaProvider.clearSchemaCache();

    expect(result).toEqual({ cleared: true });
    expect(mock.calls[0]).toEqual({ method: 'clearSchemaCache', params: {} });
  });

  it('parseERDiagram は params を渡し ERDiagramParseResult を返す', async () => {
    const fakeResult = {
      name: 'm',
      databaseType: 'postgres',
      tables: [],
      relations: [],
      shapes: [],
      ddl: '',
    };
    mock.setResponse('parseERDiagram', fakeResult);

    const result = await schemaProvider.parseERDiagram({ filename: 'a.erd', content: 'x' });

    expect(result).toEqual(fakeResult);
    expect(mock.calls[0]?.method).toBe('parseERDiagram');
    expect(mock.calls[0]?.params).toEqual({ filename: 'a.erd', content: 'x' });
  });

  it('parseERDiagram は不正形状の応答に対して throw する', async () => {
    mock.setResponse('parseERDiagram', 'wrong-shape');

    await expect(schemaProvider.parseERDiagram({})).rejects.toThrow();
  });

  it('メソッドを分割代入してから呼んでも this が失われない', async () => {
    mock.setResponse('getDatabases', ['db']);
    const { getDatabases } = schemaProvider;

    const result = await getDatabases('conn-1');

    expect(result).toEqual(['db']);
  });

  it('__setIpcInvokerForTest 後に再度差し替えると新しい invoker が使われる', async () => {
    const first = new MockIpcInvoker();
    first.setResponse('getDatabases', ['first']);
    __setIpcInvokerForTest(first);

    const second = new MockIpcInvoker();
    second.setResponse('getDatabases', ['second']);
    __setIpcInvokerForTest(second);

    const result = await schemaProvider.getDatabases('conn-1');

    expect(result).toEqual(['second']);
    expect(first.calls).toHaveLength(0);
  });

  it('getTables 中の log.info はログ呼び出しを 2 回行う (loadTimeMs 計測前後)', async () => {
    // BridgeLogger 注入経路の検証: 既存 log 実体が使われていることを spy で確認
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => {});
    mock.setResponse('getTables', []);

    await schemaProvider.getTables('conn-1', 'db1');

    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(infoSpy.mock.calls[0]?.[0]).toContain('Getting tables');
    expect(infoSpy.mock.calls[1]?.[0]).toContain('Received 0 tables');
    // restore は afterEach で実施 (assertion 失敗時にも剥がれるよう)
  });
});
