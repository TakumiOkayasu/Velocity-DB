import { describe, expect, it } from 'vitest';
import { escapeSingleQuotes, quoteIdentifier, quoteLiteral } from '../../../utils/sql/quoting';

describe('escapeSingleQuotes', () => {
  it('シングルクォートなしはそのまま', () => {
    expect(escapeSingleQuotes('hello')).toBe('hello');
  });

  it('単一シングルクォートを 2 重化', () => {
    expect(escapeSingleQuotes("O'Brien")).toBe("O''Brien");
  });

  it('複数のシングルクォートを全て 2 重化', () => {
    expect(escapeSingleQuotes("a'b'c")).toBe("a''b''c");
  });

  it('空文字列はそのまま', () => {
    expect(escapeSingleQuotes('')).toBe('');
  });
});

describe('quoteIdentifier', () => {
  it('SQL Server (default): 角括弧でクォート', () => {
    expect(quoteIdentifier('Users', 'sqlserver')).toBe('[Users]');
  });

  it('SQL Server: dbType 未指定時も角括弧', () => {
    expect(quoteIdentifier('Users')).toBe('[Users]');
  });

  it('SQL Server: 内部の ] を ]] にエスケープ', () => {
    expect(quoteIdentifier('a]b', 'sqlserver')).toBe('[a]]b]');
  });

  it('PostgreSQL: ダブルクォート', () => {
    expect(quoteIdentifier('users', 'postgresql')).toBe('"users"');
  });

  it('PostgreSQL: 内部の " を "" にエスケープ', () => {
    expect(quoteIdentifier('a"b', 'postgresql')).toBe('"a""b"');
  });

  it('MySQL: バッククォート', () => {
    expect(quoteIdentifier('users', 'mysql')).toBe('`users`');
  });

  it('MySQL: 内部の ` を `` にエスケープ', () => {
    expect(quoteIdentifier('a`b', 'mysql')).toBe('`a``b`');
  });
});

describe('quoteLiteral', () => {
  it('SQL Server (default): N プレフィックス付きシングルクォート', () => {
    expect(quoteLiteral('hello', 'sqlserver')).toBe("N'hello'");
  });

  it('SQL Server: dbType 未指定時も N プレフィックス', () => {
    expect(quoteLiteral('hello')).toBe("N'hello'");
  });

  it('SQL Server: シングルクォートを 2 重化してエスケープ', () => {
    expect(quoteLiteral("O'Brien", 'sqlserver')).toBe("N'O''Brien'");
  });

  it('PostgreSQL: シングルクォートのみ (N プレフィックスなし)', () => {
    expect(quoteLiteral('hello', 'postgresql')).toBe("'hello'");
  });

  it('PostgreSQL: シングルクォートを 2 重化', () => {
    expect(quoteLiteral("O'Brien", 'postgresql')).toBe("'O''Brien'");
  });

  it('MySQL: シングルクォートのみ', () => {
    expect(quoteLiteral('hello', 'mysql')).toBe("'hello'");
  });

  it('MySQL: シングルクォートを 2 重化', () => {
    expect(quoteLiteral("O'Brien", 'mysql')).toBe("'O''Brien'");
  });
});
