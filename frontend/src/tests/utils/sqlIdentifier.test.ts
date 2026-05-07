import { describe, expect, it } from 'vitest';
import {
  buildAlterViewSql,
  buildDropTableSql,
  buildGetViewDefinitionSql,
  buildInsertTemplateSql,
  buildTruncateTableSql,
  parseDropOrTruncate,
  type ReferencingFK,
} from '../../utils/sqlIdentifier';

describe('buildGetViewDefinitionSql', () => {
  it('SQL Server: OBJECT_DEFINITION を使用', () => {
    const sql = buildGetViewDefinitionSql('dbo', 'vw_Users', 'sqlserver');
    expect(sql).toContain('OBJECT_DEFINITION');
    expect(sql).toContain('dbo.vw_Users');
  });

  it('PostgreSQL: pg_get_viewdef を使用', () => {
    const sql = buildGetViewDefinitionSql('public', 'vw_Users', 'postgresql');
    expect(sql).toContain('pg_get_viewdef');
    expect(sql).toContain('public.vw_Users');
  });

  it('MySQL: INFORMATION_SCHEMA を使用', () => {
    const sql = buildGetViewDefinitionSql('mydb', 'vw_Users', 'mysql');
    expect(sql).toContain('INFORMATION_SCHEMA.VIEWS');
    expect(sql).toContain('mydb');
    expect(sql).toContain('vw_Users');
  });

  it('SQLインジェクション対策: シングルクォートをエスケープ', () => {
    const sql = buildGetViewDefinitionSql('dbo', "vw_O'Brien", 'sqlserver');
    expect(sql).not.toContain("O'B");
    expect(sql).toContain("O''B");
  });
});

describe('buildAlterViewSql', () => {
  it('SQL Server: CREATE VIEW → ALTER VIEW に変換しカラムにエイリアス追加', () => {
    const viewDef = 'CREATE VIEW [dbo].[vw_Users] AS\nSELECT id, name, email FROM [dbo].[Users]';
    const result = buildAlterViewSql(viewDef, 'name', 'user_name', 'sqlserver');
    expect(result).toMatch(/^ALTER VIEW/);
    expect(result).toContain('[user_name]');
    expect(result).not.toMatch(/CREATE VIEW/);
  });

  it('PostgreSQL: CREATE OR REPLACE VIEW に変換', () => {
    const viewDef = 'CREATE VIEW public.vw_users AS\nSELECT id, name FROM users';
    const result = buildAlterViewSql(viewDef, 'name', 'user_name', 'postgresql');
    expect(result).toMatch(/^CREATE OR REPLACE VIEW/);
    expect(result).toContain('"user_name"');
  });

  it('MySQL: ALTER VIEW に変換しバッククォートでエイリアス', () => {
    const viewDef = 'CREATE VIEW `vw_users` AS\nSELECT id, name FROM users';
    const result = buildAlterViewSql(viewDef, 'name', 'user_name', 'mysql');
    expect(result).toMatch(/^ALTER VIEW/);
    expect(result).toContain('`user_name`');
  });

  it('既存エイリアスを置換', () => {
    const viewDef =
      'CREATE VIEW [dbo].[vw_Users] AS\nSELECT id, name AS [old_alias] FROM [dbo].[Users]';
    const result = buildAlterViewSql(viewDef, 'name', 'user_name', 'sqlserver');
    expect(result).toContain('[user_name]');
    expect(result).not.toContain('[old_alias]');
  });

  it('テーブルプレフィックス付きカラムを処理', () => {
    const viewDef = 'CREATE VIEW [dbo].[vw_Users] AS\nSELECT u.id, u.name FROM [dbo].[Users] u';
    const result = buildAlterViewSql(viewDef, 'name', 'user_name', 'sqlserver');
    expect(result).toContain('[user_name]');
  });

  it('カラムが見つからない場合はエイリアスなしで変換のみ', () => {
    const viewDef = 'CREATE VIEW [dbo].[vw_Users] AS\nSELECT id FROM [dbo].[Users]';
    const result = buildAlterViewSql(viewDef, 'nonexistent', 'new_name', 'sqlserver');
    expect(result).toMatch(/^ALTER VIEW/);
    expect(result).not.toContain('new_name');
  });

  it('CREATE OR REPLACE VIEW が既にある場合そのまま維持 (PostgreSQL)', () => {
    const viewDef = 'CREATE OR REPLACE VIEW public.vw_users AS\nSELECT id, name FROM users';
    const result = buildAlterViewSql(viewDef, 'name', 'user_name', 'postgresql');
    expect(result).toMatch(/^CREATE OR REPLACE VIEW/);
    // CREATE OR REPLACE CREATE OR REPLACE のように二重にならない
    expect(result).not.toMatch(/CREATE OR REPLACE.*CREATE OR REPLACE/);
  });

  it('サブクエリ内の FROM に惑わされずカラムを正しくリネーム', () => {
    const viewDef =
      'CREATE VIEW [dbo].[vw_Test] AS\nSELECT (SELECT x FROM t1) AS sub, name FROM [dbo].[Main]';
    const result = buildAlterViewSql(viewDef, 'name', 'new_name', 'sqlserver');
    expect(result).toContain('[new_name]');
    // sub カラムは変更されない
    expect(result).toContain('(SELECT x FROM t1) AS sub');
  });

  it('複数サブクエリがある場合でも最後のFROMまでの範囲で処理', () => {
    const viewDef =
      'CREATE VIEW [dbo].[vw_Multi] AS\nSELECT (SELECT a FROM t1) AS c1, (SELECT b FROM t2) AS c2, name FROM [dbo].[Main]';
    const result = buildAlterViewSql(viewDef, 'name', 'renamed', 'sqlserver');
    expect(result).toContain('[renamed]');
    expect(result).toContain('(SELECT a FROM t1) AS c1');
    expect(result).toContain('(SELECT b FROM t2) AS c2');
  });
});

describe('buildDropTableSql', () => {
  const noFKs: ReferencingFK[] = [];

  const singleFK: ReferencingFK[] = [
    {
      name: 'FK_Orders_Users',
      referencingTable: 'dbo.Orders',
      referencingColumns: ['userId'],
      columns: ['id'],
      onDelete: 'NO_ACTION',
      onUpdate: 'NO_ACTION',
    },
  ];

  const multipleFKs: ReferencingFK[] = [
    {
      name: 'FK_Orders_Users',
      referencingTable: 'dbo.Orders',
      referencingColumns: ['userId'],
      columns: ['id'],
      onDelete: 'NO_ACTION',
      onUpdate: 'NO_ACTION',
    },
    {
      name: 'FK_Reviews_Users',
      referencingTable: 'dbo.Reviews',
      referencingColumns: ['authorId'],
      columns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  ];

  // テスト1: FK無し・SQL Server
  it('FK無し・SQL Server → DROP TABLE文を返す', () => {
    const sqls = buildDropTableSql('dbo', 'Users', 'sqlserver', noFKs);
    expect(sqls).toEqual(['DROP TABLE [dbo].[Users]']);
  });

  // テスト2: FK無し・PostgreSQL
  it('FK無し・PostgreSQL → DROP TABLE文を返す', () => {
    const sqls = buildDropTableSql('public', 'Users', 'postgresql', noFKs);
    expect(sqls).toEqual(['DROP TABLE "public"."Users"']);
  });

  // テスト3: FK有り・SQL Server → FK制約DROP + DROP TABLE
  it('FK有り・SQL Server → FK制約DROP文 + DROP TABLE文の配列', () => {
    const sqls = buildDropTableSql('dbo', 'Users', 'sqlserver', singleFK);
    expect(sqls).toEqual([
      'ALTER TABLE [dbo].[Orders] DROP CONSTRAINT [FK_Orders_Users]',
      'DROP TABLE [dbo].[Users]',
    ]);
  });

  // テスト4: FK有り・PostgreSQL → CASCADE
  it('FK有り・PostgreSQL → CASCADE付きDROP TABLE', () => {
    const sqls = buildDropTableSql('public', 'Users', 'postgresql', singleFK);
    expect(sqls).toEqual(['DROP TABLE "public"."Users" CASCADE']);
  });

  // テスト5: 複数FK・SQL Server
  it('複数FK・SQL Server → 各FK分のDROP CONSTRAINT + DROP TABLE', () => {
    const sqls = buildDropTableSql('dbo', 'Users', 'sqlserver', multipleFKs);
    expect(sqls).toEqual([
      'ALTER TABLE [dbo].[Orders] DROP CONSTRAINT [FK_Orders_Users]',
      'ALTER TABLE [dbo].[Reviews] DROP CONSTRAINT [FK_Reviews_Users]',
      'DROP TABLE [dbo].[Users]',
    ]);
  });

  // テスト6: 特殊文字のエスケープ
  it('テーブル名に ] が含まれる場合にエスケープ', () => {
    const sqls = buildDropTableSql('dbo', 'User]s', 'sqlserver', noFKs);
    expect(sqls).toEqual(['DROP TABLE [dbo].[User]]s]']);
  });
});

describe('buildTruncateTableSql', () => {
  const noFKs: ReferencingFK[] = [];

  const singleFK: ReferencingFK[] = [
    {
      name: 'FK_Orders_Users',
      referencingTable: 'dbo.Orders',
      referencingColumns: ['userId'],
      columns: ['id'],
      onDelete: 'NO_ACTION',
      onUpdate: 'NO_ACTION',
    },
  ];

  const multipleFKs: ReferencingFK[] = [
    {
      name: 'FK_Orders_Users',
      referencingTable: 'dbo.Orders',
      referencingColumns: ['userId'],
      columns: ['id'],
      onDelete: 'NO_ACTION',
      onUpdate: 'NO_ACTION',
    },
    {
      name: 'FK_Reviews_Users',
      referencingTable: 'dbo.Reviews',
      referencingColumns: ['authorId', 'authorType'],
      columns: ['id', 'type'],
      onDelete: 'CASCADE',
      onUpdate: 'SET_NULL',
    },
  ];

  // テスト7: FK無し・SQL Server
  it('FK無し・SQL Server → TRUNCATE TABLE文を返す', () => {
    const sqls = buildTruncateTableSql('dbo', 'Users', 'sqlserver', noFKs);
    expect(sqls).toEqual(['TRUNCATE TABLE [dbo].[Users]']);
  });

  // テスト8: FK無し・PostgreSQL
  it('FK無し・PostgreSQL → TRUNCATE TABLE文を返す', () => {
    const sqls = buildTruncateTableSql('public', 'Users', 'postgresql', noFKs);
    expect(sqls).toEqual(['TRUNCATE TABLE "public"."Users"']);
  });

  // テスト9: FK有り・PostgreSQL → CASCADE
  it('FK有り・PostgreSQL → CASCADE付きTRUNCATE TABLE', () => {
    const sqls = buildTruncateTableSql('public', 'Users', 'postgresql', singleFK);
    expect(sqls).toEqual(['TRUNCATE TABLE "public"."Users" CASCADE']);
  });

  // テスト10: FK有り・SQL Server → トランザクション付き
  it('FK有り・SQL Server → BEGIN TRANSACTION〜COMMITで包む', () => {
    const sqls = buildTruncateTableSql('dbo', 'Users', 'sqlserver', singleFK);
    expect(sqls[0]).toBe('BEGIN TRANSACTION');
    expect(sqls[1]).toBe('ALTER TABLE [dbo].[Orders] DROP CONSTRAINT [FK_Orders_Users]');
    expect(sqls[2]).toBe('TRUNCATE TABLE [dbo].[Users]');
    expect(sqls[3]).toContain('WITH CHECK ADD CONSTRAINT [FK_Orders_Users]');
    expect(sqls[3]).toContain('FOREIGN KEY ([userId])');
    expect(sqls[3]).toContain('REFERENCES [dbo].[Users] ([id])');
    expect(sqls[3]).toContain('ON DELETE NO ACTION');
    expect(sqls[3]).toContain('ON UPDATE NO ACTION');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });

  // テスト11: FK有り・SQL Server・複数FK
  it('複数FK・SQL Server → 各FK分のDROP+再作成がトランザクション内', () => {
    const sqls = buildTruncateTableSql('dbo', 'Users', 'sqlserver', multipleFKs);
    expect(sqls[0]).toBe('BEGIN TRANSACTION');
    // DROP CONSTRAINT x2
    expect(sqls[1]).toContain('DROP CONSTRAINT [FK_Orders_Users]');
    expect(sqls[2]).toContain('DROP CONSTRAINT [FK_Reviews_Users]');
    // TRUNCATE
    expect(sqls[3]).toBe('TRUNCATE TABLE [dbo].[Users]');
    // ADD CONSTRAINT x2
    expect(sqls[4]).toContain('ADD CONSTRAINT [FK_Orders_Users]');
    expect(sqls[5]).toContain('ADD CONSTRAINT [FK_Reviews_Users]');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });

  // テスト12: ON DELETE/ON UPDATE アクションの反映
  it('FK再作成SQLにON DELETE/ON UPDATEアクションが正しく反映', () => {
    const sqls = buildTruncateTableSql('dbo', 'Users', 'sqlserver', multipleFKs);
    // 2つ目のFK: CASCADE/SET_NULL、複合キー
    const recreateSql = sqls[5];
    expect(recreateSql).toContain('FOREIGN KEY ([authorId], [authorType])');
    expect(recreateSql).toContain('REFERENCES [dbo].[Users] ([id], [type])');
    expect(recreateSql).toContain('ON DELETE CASCADE');
    expect(recreateSql).toContain('ON UPDATE SET NULL');
  });
});

describe('parseDropOrTruncate', () => {
  it('TRUNCATE TABLE locations; → schema空、table=locations', () => {
    const result = parseDropOrTruncate('TRUNCATE TABLE locations;');
    expect(result).toEqual({ type: 'truncate', schema: '', table: 'locations' });
  });

  it('DROP TABLE dbo.Users → schema=dbo, table=Users', () => {
    const result = parseDropOrTruncate('DROP TABLE dbo.Users');
    expect(result).toEqual({ type: 'drop', schema: 'dbo', table: 'Users' });
  });

  it('DROP TABLE [dbo].[Users] → ブラケット除去', () => {
    const result = parseDropOrTruncate('DROP TABLE [dbo].[Users]');
    expect(result).toEqual({ type: 'drop', schema: 'dbo', table: 'Users' });
  });

  it('DROP TABLE "public"."Users" → ダブルクォート除去', () => {
    const result = parseDropOrTruncate('DROP TABLE "public"."Users"');
    expect(result).toEqual({ type: 'drop', schema: 'public', table: 'Users' });
  });

  it('DROP TABLE IF EXISTS Users → IF EXISTS対応', () => {
    const result = parseDropOrTruncate('DROP TABLE IF EXISTS Users');
    expect(result).toEqual({ type: 'drop', schema: '', table: 'Users' });
  });

  it('SELECT * FROM Users → null', () => {
    expect(parseDropOrTruncate('SELECT * FROM Users')).toBeNull();
  });
});

describe('buildDropTableSql - schema省略', () => {
  it('schema空・FK無し → テーブル名のみ', () => {
    const sqls = buildDropTableSql('', 'locations', 'sqlserver', []);
    expect(sqls).toEqual(['DROP TABLE [locations]']);
  });

  it('schema空・FK有り → FK DROP + テーブルDROP', () => {
    const sqls = buildDropTableSql('', 'locations', 'sqlserver', [
      {
        name: 'FK_Events_Locations',
        referencingTable: 'dbo.Events',
        referencingColumns: ['locationId'],
        columns: ['id'],
        onDelete: 'NO_ACTION',
        onUpdate: 'NO_ACTION',
      },
    ]);
    expect(sqls[0]).toBe('ALTER TABLE [dbo].[Events] DROP CONSTRAINT [FK_Events_Locations]');
    expect(sqls[1]).toBe('DROP TABLE [locations]');
  });
});

describe('buildTruncateTableSql - schema省略', () => {
  it('schema空・FK無し → テーブル名のみ', () => {
    const sqls = buildTruncateTableSql('', 'locations', 'sqlserver', []);
    expect(sqls).toEqual(['TRUNCATE TABLE [locations]']);
  });
});

describe('buildInsertTemplateSql', () => {
  it('SQL Server: schema.table + 複数カラム → 角括弧でクォート', () => {
    const sql = buildInsertTemplateSql('dbo.Users', ['id', 'name'], 'sqlserver');
    expect(sql).toBe('INSERT INTO [dbo].[Users] ([id], [name]) VALUES (?, ?);');
  });

  it('PostgreSQL: schema.table + 複数カラム → ダブルクォート', () => {
    const sql = buildInsertTemplateSql('public.users', ['id', 'name'], 'postgresql');
    expect(sql).toBe('INSERT INTO "public"."users" ("id", "name") VALUES (?, ?);');
  });

  it('MySQL: schema.table + 複数カラム → バッククォート', () => {
    const sql = buildInsertTemplateSql('mydb.users', ['id', 'name'], 'mysql');
    expect(sql).toBe('INSERT INTO `mydb`.`users` (`id`, `name`) VALUES (?, ?);');
  });

  it('スキーマなし: テーブル名のみで生成', () => {
    const sql = buildInsertTemplateSql('Users', ['id'], 'sqlserver');
    expect(sql).toBe('INSERT INTO [Users] ([id]) VALUES (?);');
  });

  it('単一カラム: プレースホルダも1つ', () => {
    const sql = buildInsertTemplateSql('dbo.Log', ['message'], 'sqlserver');
    expect(sql).toBe('INSERT INTO [dbo].[Log] ([message]) VALUES (?);');
  });

  it('カラム名に特殊文字 (SQL Server)', () => {
    const sql = buildInsertTemplateSql('dbo.Users', ['user]id'], 'sqlserver');
    expect(sql).toContain('[user]]id]');
  });

  it('カラム空: 空のプレースホルダ (呼び出し側が防ぐべき入力を明示的に契約化)', () => {
    const sql = buildInsertTemplateSql('dbo.Empty', [], 'sqlserver');
    expect(sql).toBe('INSERT INTO [dbo].[Empty] () VALUES ();');
  });
});
