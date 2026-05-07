import { describe, expect, it } from 'vitest';
import {
  buildDropColumnSql,
  buildDropTableSql,
  buildRenameColumnSql,
  buildTruncateTableSql,
  parseDropOrTruncate,
  type ReferencingFK,
} from '../../../../utils/sql/ddl/table-ddl';

describe('buildRenameColumnSql', () => {
  it('SQL Server: sp_rename を使用しシングルクォートをエスケープ', () => {
    const sql = buildRenameColumnSql('dbo', 'Users', "user's_id", 'user_id', 'sqlserver');
    expect(sql).toBe("EXEC sp_rename 'dbo.Users.user''s_id', 'user_id', 'COLUMN'");
  });

  it('PostgreSQL: ALTER TABLE ... RENAME COLUMN ダブルクォート', () => {
    const sql = buildRenameColumnSql('public', 'users', 'old', 'new', 'postgresql');
    expect(sql).toBe('ALTER TABLE "public"."users" RENAME COLUMN "old" TO "new"');
  });

  it('MySQL: schema 不使用・バッククォート', () => {
    const sql = buildRenameColumnSql('mydb', 'users', 'old', 'new', 'mysql');
    expect(sql).toBe('ALTER TABLE `users` RENAME COLUMN `old` TO `new`');
  });
});

describe('buildDropColumnSql', () => {
  it('SQL Server: ALTER TABLE schema.table DROP COLUMN col', () => {
    const sql = buildDropColumnSql('dbo', 'Users', 'name', 'sqlserver');
    expect(sql).toBe('ALTER TABLE [dbo].[Users] DROP COLUMN [name]');
  });

  it('PostgreSQL: 同形式・ダブルクォート', () => {
    const sql = buildDropColumnSql('public', 'users', 'name', 'postgresql');
    expect(sql).toBe('ALTER TABLE "public"."users" DROP COLUMN "name"');
  });

  it('MySQL: schema 不使用・バッククォート', () => {
    const sql = buildDropColumnSql('mydb', 'users', 'name', 'mysql');
    expect(sql).toBe('ALTER TABLE `users` DROP COLUMN `name`');
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

  it('FK無し・SQL Server → DROP TABLE文を返す', () => {
    const sqls = buildDropTableSql('dbo', 'Users', 'sqlserver', noFKs);
    expect(sqls).toEqual(['DROP TABLE [dbo].[Users]']);
  });

  it('FK無し・PostgreSQL → DROP TABLE文を返す', () => {
    const sqls = buildDropTableSql('public', 'Users', 'postgresql', noFKs);
    expect(sqls).toEqual(['DROP TABLE "public"."Users"']);
  });

  it('FK有り・SQL Server → FK制約DROP文 + DROP TABLE文の配列', () => {
    const sqls = buildDropTableSql('dbo', 'Users', 'sqlserver', singleFK);
    expect(sqls).toEqual([
      'ALTER TABLE [dbo].[Orders] DROP CONSTRAINT [FK_Orders_Users]',
      'DROP TABLE [dbo].[Users]',
    ]);
  });

  it('FK有り・PostgreSQL → CASCADE付きDROP TABLE', () => {
    const sqls = buildDropTableSql('public', 'Users', 'postgresql', singleFK);
    expect(sqls).toEqual(['DROP TABLE "public"."Users" CASCADE']);
  });

  it('複数FK・SQL Server → 各FK分のDROP CONSTRAINT + DROP TABLE', () => {
    const sqls = buildDropTableSql('dbo', 'Users', 'sqlserver', multipleFKs);
    expect(sqls).toEqual([
      'ALTER TABLE [dbo].[Orders] DROP CONSTRAINT [FK_Orders_Users]',
      'ALTER TABLE [dbo].[Reviews] DROP CONSTRAINT [FK_Reviews_Users]',
      'DROP TABLE [dbo].[Users]',
    ]);
  });

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

  it('FK無し・SQL Server → TRUNCATE TABLE文を返す', () => {
    const sqls = buildTruncateTableSql('dbo', 'Users', 'sqlserver', noFKs);
    expect(sqls).toEqual(['TRUNCATE TABLE [dbo].[Users]']);
  });

  it('FK無し・PostgreSQL → TRUNCATE TABLE文を返す', () => {
    const sqls = buildTruncateTableSql('public', 'Users', 'postgresql', noFKs);
    expect(sqls).toEqual(['TRUNCATE TABLE "public"."Users"']);
  });

  it('FK有り・PostgreSQL → CASCADE付きTRUNCATE TABLE', () => {
    const sqls = buildTruncateTableSql('public', 'Users', 'postgresql', singleFK);
    expect(sqls).toEqual(['TRUNCATE TABLE "public"."Users" CASCADE']);
  });

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

  it('複数FK・SQL Server → 各FK分のDROP+再作成がトランザクション内', () => {
    const sqls = buildTruncateTableSql('dbo', 'Users', 'sqlserver', multipleFKs);
    expect(sqls[0]).toBe('BEGIN TRANSACTION');
    expect(sqls[1]).toContain('DROP CONSTRAINT [FK_Orders_Users]');
    expect(sqls[2]).toContain('DROP CONSTRAINT [FK_Reviews_Users]');
    expect(sqls[3]).toBe('TRUNCATE TABLE [dbo].[Users]');
    expect(sqls[4]).toContain('ADD CONSTRAINT [FK_Orders_Users]');
    expect(sqls[5]).toContain('ADD CONSTRAINT [FK_Reviews_Users]');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });

  it('FK再作成SQLにON DELETE/ON UPDATEアクションが正しく反映', () => {
    const sqls = buildTruncateTableSql('dbo', 'Users', 'sqlserver', multipleFKs);
    const recreateSql = sqls[5];
    expect(recreateSql).toContain('FOREIGN KEY ([authorId], [authorType])');
    expect(recreateSql).toContain('REFERENCES [dbo].[Users] ([id], [type])');
    expect(recreateSql).toContain('ON DELETE CASCADE');
    expect(recreateSql).toContain('ON UPDATE SET NULL');
  });

  it('未知のFKアクションは NO ACTION にフォールバック (sanitizeFkAction)', () => {
    const sqls = buildTruncateTableSql('dbo', 'Users', 'sqlserver', [
      {
        name: 'FK_Bad',
        referencingTable: 'dbo.Bad',
        referencingColumns: ['x'],
        columns: ['id'],
        onDelete: 'UNKNOWN_VALUE',
        onUpdate: 'INVALID',
      },
    ]);
    expect(sqls[3]).toContain('ON DELETE NO ACTION');
    expect(sqls[3]).toContain('ON UPDATE NO ACTION');
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
