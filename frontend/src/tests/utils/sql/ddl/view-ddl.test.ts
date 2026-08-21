import { describe, expect, it } from 'vite-plus/test';
import { buildAlterViewSql, buildGetViewDefinitionSql } from '../../../../utils/sql/ddl/view-ddl';

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
    expect(result).not.toMatch(/CREATE OR REPLACE.*CREATE OR REPLACE/);
  });

  it('サブクエリ内の FROM に惑わされずカラムを正しくリネーム', () => {
    const viewDef =
      'CREATE VIEW [dbo].[vw_Test] AS\nSELECT (SELECT x FROM t1) AS sub, name FROM [dbo].[Main]';
    const result = buildAlterViewSql(viewDef, 'name', 'new_name', 'sqlserver');
    expect(result).toContain('[new_name]');
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

  it('SELECT が含まれない定義はそのまま返す (selectIdx=-1 早期return)', () => {
    const viewDef = 'CREATE VIEW [dbo].[vw_Empty] AS\nVALUES (1, 2)';
    const result = buildAlterViewSql(viewDef, 'name', 'new_name', 'sqlserver');
    expect(result).toMatch(/^ALTER VIEW/);
    expect(result).toContain('VALUES (1, 2)');
  });

  it('正規表現メタ文字を含むカラム名が正しくエスケープされる', () => {
    const viewDef = 'CREATE VIEW [dbo].[vw_Special] AS\nSELECT id, [col.with.dots] FROM [dbo].[T]';
    const result = buildAlterViewSql(viewDef, 'col.with.dots', 'renamed', 'sqlserver');
    expect(result).toContain('[renamed]');
  });

  it('ReDoS 耐性: oldCol が動的 regex に埋め込まれず正常終了する', () => {
    const viewDef = 'CREATE VIEW [dbo].[vw_Test] AS\nSELECT id, name FROM [dbo].[Users]';
    // 元実装で動的 RegExp に埋め込まれていた場合、入力サイズに対して指数的劣化する
    // パターン (a+)+! 系を想定。oldCol は文字列リテラルとしてのみ扱われ、
    // 識別子 'name' とは一致しないので非マッチで終了する。
    const evilCol = `${'a+'.repeat(50)}!`;
    const result = buildAlterViewSql(viewDef, evilCol, 'new_name', 'sqlserver');
    expect(result).toMatch(/^ALTER VIEW/);
    expect(result).not.toContain('new_name');
  });

  it('カラム名に部分一致するだけの識別子はリネーム対象外', () => {
    const viewDef = 'CREATE VIEW [dbo].[vw_Test] AS\nSELECT username, name FROM [dbo].[Users]';
    const result = buildAlterViewSql(viewDef, 'name', 'renamed', 'sqlserver');
    expect(result).toContain('username,');
    expect(result).toMatch(/\bname\s+AS\s+\[renamed\]/);
  });
});
