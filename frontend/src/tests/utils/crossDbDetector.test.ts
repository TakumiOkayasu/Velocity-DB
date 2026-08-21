import { describe, expect, it } from 'vite-plus/test';
import { extractReferencedDatabases } from '../../utils/crossDbDetector';

describe('extractReferencedDatabases', () => {
  it('空SQLでは空配列を返す', () => {
    expect(extractReferencedDatabases('', 'db1')).toEqual([]);
    expect(extractReferencedDatabases('   \n  ', 'db1')).toEqual([]);
  });

  it('3-part nameなしなら空配列', () => {
    expect(extractReferencedDatabases('SELECT * FROM dbo.Users', 'db1')).toEqual([]);
    expect(extractReferencedDatabases('SELECT * FROM Users', 'db1')).toEqual([]);
  });

  it('接続中DBと同じ3-part nameは除外', () => {
    expect(extractReferencedDatabases('SELECT * FROM db1.dbo.T1', 'db1')).toEqual([]);
  });

  it('接続中DBと異なる3-part nameを抽出', () => {
    expect(extractReferencedDatabases('SELECT * FROM db2.dbo.T1', 'db1')).toEqual(['db2']);
  });

  it('JOIN 内の複数cross-DB参照を抽出', () => {
    const sql = 'SELECT * FROM db1.dbo.T1 JOIN db2.dbo.T2 ON T1.id = T2.id';
    expect(extractReferencedDatabases(sql, 'db1')).toEqual(['db2']);
  });

  it('3つ以上のDB参照を順序保持で抽出', () => {
    const sql = 'SELECT * FROM db1.s.a JOIN db2.s.b JOIN db3.s.c';
    expect(extractReferencedDatabases(sql, 'db1')).toEqual(['db2', 'db3']);
  });

  it('重複は1回だけ', () => {
    const sql = 'SELECT * FROM db2.s.a JOIN db2.s.b ON db2.s.a.id = db2.s.b.id';
    expect(extractReferencedDatabases(sql, 'db1')).toEqual(['db2']);
  });

  it('角括弧識別子 [db]', () => {
    expect(extractReferencedDatabases('SELECT * FROM [db2].[dbo].[T1]', 'db1')).toEqual(['db2']);
  });

  it('バッククォート識別子', () => {
    expect(extractReferencedDatabases('SELECT * FROM `db2`.`dbo`.`T1`', 'db1')).toEqual(['db2']);
  });

  it('ダブルクォート識別子', () => {
    expect(extractReferencedDatabases('SELECT * FROM "db2"."dbo"."T1"', 'db1')).toEqual(['db2']);
  });

  it('行コメント内の3-part nameは無視', () => {
    const sql = '-- SELECT * FROM db2.dbo.T1\nSELECT 1';
    expect(extractReferencedDatabases(sql, 'db1')).toEqual([]);
  });

  it('ブロックコメント内の3-part nameは無視', () => {
    const sql = '/* SELECT * FROM db2.dbo.T1 */ SELECT 1';
    expect(extractReferencedDatabases(sql, 'db1')).toEqual([]);
  });

  it('文字列リテラル内の3-part nameは無視', () => {
    const sql = "SELECT 'db2.dbo.T1' AS label FROM Users";
    expect(extractReferencedDatabases(sql, 'db1')).toEqual([]);
  });

  it('接続DB比較は大文字小文字を区別しない', () => {
    expect(extractReferencedDatabases('SELECT * FROM DB1.dbo.T1', 'db1')).toEqual([]);
    expect(extractReferencedDatabases('SELECT * FROM db1.dbo.T1', 'DB1')).toEqual([]);
  });

  it('currentDbが空文字なら全ての参照DBを返す', () => {
    expect(extractReferencedDatabases('SELECT * FROM db1.dbo.T', '')).toEqual(['db1']);
  });

  it('2-part name (db.table) は抽出対象外', () => {
    expect(extractReferencedDatabases('SELECT * FROM db2.T1', 'db1')).toEqual([]);
  });

  it('抽出結果は元の綴りを保持', () => {
    const sql = 'SELECT * FROM MyDB.dbo.T1';
    expect(extractReferencedDatabases(sql, 'db1')).toEqual(['MyDB']);
  });

  it('角括弧内にスペース含むDB名', () => {
    const sql = 'SELECT * FROM [My Database].[dbo].[T1]';
    expect(extractReferencedDatabases(sql, 'db1')).toEqual(['My Database']);
  });

  it('角括弧内のDB名が接続DBと一致すれば除外', () => {
    const sql = 'SELECT * FROM [My Database].[dbo].[T1]';
    expect(extractReferencedDatabases(sql, 'My Database')).toEqual([]);
  });
});
