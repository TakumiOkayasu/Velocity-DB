import { describe, expect, it } from 'vitest';
import type { Column } from '../../types';
import { diffSchemas, isEmptyDiff, type SchemaTable, tableKey } from '../../utils/schemaDiff';

function col(name: string, overrides: Partial<Column> = {}): Column {
  return {
    name,
    type: 'int',
    size: 4,
    nullable: true,
    isPrimaryKey: false,
    ...overrides,
  };
}

function table(schema: string, name: string, columns: Column[]): SchemaTable {
  return { schema, name, columns };
}

describe('tableKey', () => {
  it('schema ありは "schema.name" を返す', () => {
    expect(tableKey({ schema: 'dbo', name: 'users' })).toBe('dbo.users');
  });

  it('schema 空は name のみ返す', () => {
    expect(tableKey({ schema: '', name: 'users' })).toBe('users');
  });
});

describe('diffSchemas: テーブル集合', () => {
  it('追加・削除・共通テーブルを分類する', () => {
    const from = [table('dbo', 't1', [col('id')]), table('dbo', 't2', [col('id')])];
    const to = [table('dbo', 't2', [col('id')]), table('dbo', 't3', [col('id')])];

    const diff = diffSchemas(from, to);

    expect(diff.addedTables.map(tableKey)).toEqual(['dbo.t3']);
    expect(diff.removedTables.map(tableKey)).toEqual(['dbo.t1']);
    expect(diff.changedTables).toEqual([]);
    expect(diff.unchangedTableCount).toBe(1);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it('両方空なら差分なし', () => {
    const diff = diffSchemas([], []);
    expect(diff.addedTables).toEqual([]);
    expect(diff.removedTables).toEqual([]);
    expect(diff.changedTables).toEqual([]);
    expect(diff.unchangedTableCount).toBe(0);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it('移行元が空なら全テーブルが追加になる', () => {
    const to = [table('dbo', 'a', [col('id')]), table('dbo', 'b', [col('id')])];
    const diff = diffSchemas([], to);
    expect(diff.addedTables.map(tableKey)).toEqual(['dbo.a', 'dbo.b']);
    expect(diff.removedTables).toEqual([]);
  });

  it('移行先が空なら全テーブルが削除になる', () => {
    const from = [table('dbo', 'a', [col('id')])];
    const diff = diffSchemas(from, []);
    expect(diff.addedTables).toEqual([]);
    expect(diff.removedTables.map(tableKey)).toEqual(['dbo.a']);
  });

  it('テーブル名の大文字小文字は区別する (Users と users は別テーブル)', () => {
    const from = [table('dbo', 'Users', [col('id')])];
    const to = [table('dbo', 'users', [col('id')])];
    const diff = diffSchemas(from, to);
    expect(diff.addedTables.map(tableKey)).toEqual(['dbo.users']);
    expect(diff.removedTables.map(tableKey)).toEqual(['dbo.Users']);
  });

  it('同名テーブルでもスキーマが異なれば別テーブル扱い', () => {
    const from = [table('sales', 'orders', [col('id')])];
    const to = [table('archive', 'orders', [col('id')])];
    const diff = diffSchemas(from, to);
    expect(diff.addedTables.map(tableKey)).toEqual(['archive.orders']);
    expect(diff.removedTables.map(tableKey)).toEqual(['sales.orders']);
  });

  it('出力はテーブルキー昇順で決定的に整列される', () => {
    const from = [
      table('dbo', 'zebra', [col('id')]),
      table('dbo', 'alpha', [col('id')]),
      table('abc', 'middle', [col('id')]),
    ];
    const diff = diffSchemas(from, []);
    expect(diff.removedTables.map(tableKey)).toEqual(['abc.middle', 'dbo.alpha', 'dbo.zebra']);
  });
});

describe('diffSchemas: カラム差分', () => {
  it('カラム追加を検出する (移行先の定義順)', () => {
    const from = [table('dbo', 't', [col('id')])];
    const to = [table('dbo', 't', [col('id'), col('email'), col('age')])];

    const diff = diffSchemas(from, to);

    expect(diff.changedTables).toHaveLength(1);
    expect(diff.changedTables[0].addedColumns.map((c) => c.name)).toEqual(['email', 'age']);
    expect(diff.changedTables[0].removedColumns).toEqual([]);
    expect(diff.changedTables[0].changedColumns).toEqual([]);
  });

  it('カラム削除を検出する', () => {
    const from = [table('dbo', 't', [col('id'), col('legacy')])];
    const to = [table('dbo', 't', [col('id')])];

    const diff = diffSchemas(from, to);

    expect(diff.changedTables[0].removedColumns.map((c) => c.name)).toEqual(['legacy']);
  });

  it('type / size / nullable / isPrimaryKey の変更を属性別に検出する', () => {
    const from = [
      table('dbo', 't', [
        col('a', { type: 'int' }),
        col('b', { type: 'varchar', size: 50 }),
        col('c', { nullable: true }),
        col('d', { isPrimaryKey: false }),
      ]),
    ];
    const to = [
      table('dbo', 't', [
        col('a', { type: 'bigint', size: 8 }),
        col('b', { type: 'varchar', size: 100 }),
        col('c', { nullable: false }),
        col('d', { isPrimaryKey: true }),
      ]),
    ];

    const diff = diffSchemas(from, to);
    const changed = diff.changedTables[0].changedColumns;

    expect(changed.map((c) => c.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(changed[0].changes).toEqual(['type', 'size']);
    expect(changed[1].changes).toEqual(['size']);
    expect(changed[2].changes).toEqual(['nullable']);
    expect(changed[3].changes).toEqual(['isPrimaryKey']);
  });

  it('変更前後の定義を from / to として保持する', () => {
    const from = [table('dbo', 't', [col('a', { type: 'int' })])];
    const to = [table('dbo', 't', [col('a', { type: 'bigint' })])];

    const change = diffSchemas(from, to).changedTables[0].changedColumns[0];
    expect(change.from.type).toBe('int');
    expect(change.to.type).toBe('bigint');
  });

  it('カラム名の大文字小文字は区別する', () => {
    const from = [table('dbo', 't', [col('Id')])];
    const to = [table('dbo', 't', [col('id')])];

    const diff = diffSchemas(from, to);
    expect(diff.changedTables[0].addedColumns.map((c) => c.name)).toEqual(['id']);
    expect(diff.changedTables[0].removedColumns.map((c) => c.name)).toEqual(['Id']);
  });

  it('差分のない共通テーブルは changedTables に含まれない', () => {
    const shared = [col('id', { isPrimaryKey: true, nullable: false }), col('name')];
    const diff = diffSchemas([table('dbo', 't', shared)], [table('dbo', 't', [...shared])]);
    expect(diff.changedTables).toEqual([]);
    expect(diff.unchangedTableCount).toBe(1);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it('comment の変更は差分として扱わない (比較対象外)', () => {
    const from = [table('dbo', 't', [col('id', { comment: 'old' })])];
    const to = [table('dbo', 't', [col('id', { comment: 'new' })])];
    expect(isEmptyDiff(diffSchemas(from, to))).toBe(true);
  });
});
