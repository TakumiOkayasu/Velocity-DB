import { describe, expect, it } from 'vitest';
import { toBaseSql } from '../../store/query/helpers/fetchTable';

describe('toBaseSql', () => {
  it('SQL Server: TOP N を除去する', () => {
    const sql = 'SELECT TOP 10001 * FROM [dbo].[Users]';
    expect(toBaseSql(sql)).toBe('SELECT * FROM [dbo].[Users]');
  });

  it('PostgreSQL: 末尾の LIMIT N を除去する', () => {
    const sql = 'SELECT * FROM "public"."users" LIMIT 10001';
    expect(toBaseSql(sql)).toBe('SELECT * FROM "public"."users"');
  });

  it('WHERE句付きでTOP Nを除去する', () => {
    const sql = 'SELECT TOP 10001 * FROM [dbo].[Orders] WHERE status = 1';
    expect(toBaseSql(sql)).toBe('SELECT * FROM [dbo].[Orders] WHERE status = 1');
  });

  it('WHERE句付きでLIMIT Nを除去する', () => {
    const sql = 'SELECT * FROM "public"."orders" WHERE status = 1 LIMIT 10001';
    expect(toBaseSql(sql)).toBe('SELECT * FROM "public"."orders" WHERE status = 1');
  });

  it('TOP/LIMITなしのSQLはそのまま返す', () => {
    const sql = 'SELECT * FROM users';
    expect(toBaseSql(sql)).toBe('SELECT * FROM users');
  });

  it('LIMIT が列名に含まれる場合は除去しない', () => {
    const sql = 'SELECT limitation FROM config LIMIT 10001';
    const result = toBaseSql(sql);
    expect(result).toContain('limitation');
  });
});
