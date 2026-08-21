import { describe, expect, it } from 'vite-plus/test';
import { getStatementType } from '../../../utils/sql/statement-type';

describe('getStatementType', () => {
  it('SELECT 文', () => {
    expect(getStatementType('SELECT * FROM users')).toBe('SELECT');
  });

  it('小文字 select', () => {
    expect(getStatementType('select id from t')).toBe('SELECT');
  });

  it('INSERT 文', () => {
    expect(getStatementType('INSERT INTO t (id) VALUES (1)')).toBe('INSERT');
  });

  it('UPDATE 文', () => {
    expect(getStatementType('UPDATE t SET x = 1 WHERE id = 2')).toBe('UPDATE');
  });

  it('DELETE 文', () => {
    expect(getStatementType('DELETE FROM t WHERE id = 1')).toBe('DELETE');
  });

  it('TRUNCATE 文', () => {
    expect(getStatementType('TRUNCATE TABLE t')).toBe('TRUNCATE');
  });

  it('DROP 文', () => {
    expect(getStatementType('DROP TABLE t')).toBe('DROP');
  });

  it('CREATE 文', () => {
    expect(getStatementType('CREATE TABLE t (id INT)')).toBe('CREATE');
  });

  it('ALTER 文', () => {
    expect(getStatementType('ALTER TABLE t ADD c INT')).toBe('ALTER');
  });

  it('先頭空白', () => {
    expect(getStatementType('   \n\t  UPDATE t SET x=1')).toBe('UPDATE');
  });

  it('単一行コメント剥離', () => {
    expect(getStatementType('-- comment\nDELETE FROM t')).toBe('DELETE');
  });

  it('複数単一行コメント連続', () => {
    expect(getStatementType('-- one\n-- two\nINSERT INTO t VALUES (1)')).toBe('INSERT');
  });

  it('ブロックコメント剥離', () => {
    expect(getStatementType('/* leading */ TRUNCATE TABLE t')).toBe('TRUNCATE');
  });

  it('複数行ブロックコメント', () => {
    expect(getStatementType('/* one\ntwo\nthree */ UPDATE t SET x=1')).toBe('UPDATE');
  });

  it('WITH (CTE) → SELECT', () => {
    expect(getStatementType('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe('SELECT');
  });

  it('WITH (CTE) → INSERT', () => {
    expect(getStatementType('WITH cte AS (SELECT 1) INSERT INTO t SELECT * FROM cte')).toBe(
      'INSERT'
    );
  });

  it('WITH (CTE) → UPDATE', () => {
    expect(
      getStatementType('WITH cte AS (SELECT id FROM s) UPDATE t SET x=1 FROM cte WHERE t.id=cte.id')
    ).toBe('UPDATE');
  });

  it('WITH (CTE) → DELETE', () => {
    expect(
      getStatementType(
        'WITH cte AS (SELECT id FROM s) DELETE FROM t WHERE id IN (SELECT id FROM cte)'
      )
    ).toBe('DELETE');
  });

  it('WITH ネスト CTE', () => {
    expect(getStatementType('WITH a AS (SELECT 1), b AS (SELECT * FROM a) SELECT * FROM b')).toBe(
      'SELECT'
    );
  });

  it('CTE カラムリスト (a, b) を skipCteDefinitions で消費して主動詞へ到達', () => {
    expect(getStatementType('WITH cte (a, b) AS (SELECT 1, 2) SELECT * FROM cte')).toBe('SELECT');
  });

  it('CTE サブクエリ内の入れ子括弧を skipBalancedParens の深度追跡で踏破', () => {
    expect(
      getStatementType('WITH cte AS (SELECT (SELECT MAX(x) FROM s) AS m) SELECT * FROM cte')
    ).toBe('SELECT');
  });

  it('未知の動詞は OTHER', () => {
    expect(getStatementType('EXPLAIN SELECT 1')).toBe('OTHER');
  });

  it('空文字列は OTHER', () => {
    expect(getStatementType('')).toBe('OTHER');
  });

  it('空白のみは OTHER', () => {
    expect(getStatementType('   \n\n  ')).toBe('OTHER');
  });

  it('コメントのみは OTHER', () => {
    expect(getStatementType('-- only a comment')).toBe('OTHER');
  });
});
