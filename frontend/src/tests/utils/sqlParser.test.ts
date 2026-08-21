import { describe, expect, it } from 'vite-plus/test';
import { getStatementAtCursor, parseStatements } from '../../utils/sqlParser';

describe('parseStatements', () => {
  it('単一ステートメントをパース', () => {
    const result = parseStatements('SELECT * FROM users');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('SELECT * FROM users');
  });

  it('セミコロン付き単一ステートメント', () => {
    const result = parseStatements('SELECT * FROM users;');
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('SELECT * FROM users;');
  });

  it('複数ステートメントをパース', () => {
    const sql = 'SELECT 1; SELECT 2; SELECT 3';
    const result = parseStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('SELECT 1;');
    expect(result[1].text).toBe('SELECT 2;');
    expect(result[2].text).toBe('SELECT 3');
  });

  it('文字列リテラル内のセミコロンを無視', () => {
    const sql = "SELECT 'hello; world' FROM t; SELECT 2";
    const result = parseStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("SELECT 'hello; world' FROM t;");
    expect(result[1].text).toBe('SELECT 2');
  });

  it('エスケープされたシングルクォートを処理', () => {
    const sql = "SELECT 'it''s ok; really' FROM t; SELECT 2";
    const result = parseStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("SELECT 'it''s ok; really' FROM t;");
  });

  it('ダブルクォート内のセミコロンを無視', () => {
    const sql = 'SELECT "col;name" FROM t; SELECT 2';
    const result = parseStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('SELECT "col;name" FROM t;');
  });

  it('ラインコメント内のセミコロンを無視', () => {
    const sql = `SELECT 1 -- comment; here
SELECT 2; SELECT 3`;
    const result = parseStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[1].text).toBe('SELECT 3');
  });

  it('ブロックコメント内のセミコロンを無視', () => {
    const sql = 'SELECT 1 /* comment; here */ FROM t; SELECT 2';
    const result = parseStatements(sql);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('SELECT 1 /* comment; here */ FROM t;');
  });

  it('空文字列を処理', () => {
    const result = parseStatements('');
    expect(result).toHaveLength(0);
  });

  it('空白のみを処理', () => {
    const result = parseStatements('   \n\t  ');
    expect(result).toHaveLength(0);
  });

  it('連続セミコロンの扱い', () => {
    // 連続セミコロンは空白trimで1つのセミコロンとして扱われる
    const sql = 'SELECT 1;; SELECT 2';
    const result = parseStatements(sql);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('SELECT 1;');
    expect(result[1].text).toBe(';');
    expect(result[2].text).toBe('SELECT 2');
  });

  it('ネストされたクォートを処理', () => {
    const sql = `SELECT "a'b" FROM t; SELECT 'c"d' FROM t`;
    const result = parseStatements(sql);
    expect(result).toHaveLength(2);
  });

  it('start/endの位置が正しい', () => {
    const sql = 'SELECT 1; SELECT 2';
    const result = parseStatements(sql);
    expect(result[0].start).toBe(0);
    expect(result[0].end).toBe(9);
    expect(result[1].start).toBe(9);
    expect(result[1].end).toBe(18);
  });
});

describe('getStatementAtCursor', () => {
  it('カーソル位置のステートメントを返す', () => {
    const sql = 'SELECT 1; SELECT 2; SELECT 3';
    expect(getStatementAtCursor(sql, 0)).toBe('SELECT 1;');
    expect(getStatementAtCursor(sql, 5)).toBe('SELECT 1;');
    expect(getStatementAtCursor(sql, 10)).toBe('SELECT 2;');
    expect(getStatementAtCursor(sql, 20)).toBe('SELECT 3');
  });

  it('セミコロン位置でそのステートメントを返す', () => {
    const sql = 'SELECT 1; SELECT 2';
    // position 8 = ';' の位置、position 9 = end位置（含む）
    expect(getStatementAtCursor(sql, 8)).toBe('SELECT 1;');
    expect(getStatementAtCursor(sql, 9)).toBe('SELECT 1;');
    // position 10から次のステートメント
    expect(getStatementAtCursor(sql, 10)).toBe('SELECT 2');
  });

  it('最後のステートメント後のカーソルで最後を返す', () => {
    const sql = 'SELECT 1; SELECT 2';
    expect(getStatementAtCursor(sql, 100)).toBe('SELECT 2');
  });

  it('空文字列でnullを返す', () => {
    expect(getStatementAtCursor('', 0)).toBeNull();
  });

  it('空白のみでnullを返す', () => {
    expect(getStatementAtCursor('   ', 1)).toBeNull();
  });

  it('単一ステートメントでどの位置でも同じ結果', () => {
    const sql = 'SELECT * FROM users';
    expect(getStatementAtCursor(sql, 0)).toBe(sql);
    expect(getStatementAtCursor(sql, 10)).toBe(sql);
    expect(getStatementAtCursor(sql, 18)).toBe(sql);
  });
});
