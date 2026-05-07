import { describe, expect, it } from 'vitest';
import { buildInsertTemplateSql } from '../../utils/sqlIdentifier';

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
