import { describe, expect, it } from 'vite-plus/test';
import { parseAliases } from '../../../components/editor/parseAliases';

describe('parseAliases', () => {
  describe('with explicit alias', () => {
    it('parses FROM table AS alias', () => {
      expect(parseAliases('SELECT * FROM authorities AS a')).toEqual([
        { alias: 'a', tableName: 'authorities' },
      ]);
    });

    it('parses FROM table alias (no AS)', () => {
      expect(parseAliases('SELECT * FROM authorities a')).toEqual([
        { alias: 'a', tableName: 'authorities' },
      ]);
    });

    it('parses JOIN with alias', () => {
      expect(parseAliases('SELECT * FROM users u JOIN orders o ON u.id = o.user_id')).toEqual([
        { alias: 'u', tableName: 'users' },
        { alias: 'o', tableName: 'orders' },
      ]);
    });

    it('handles [bracketed] identifiers', () => {
      expect(parseAliases('SELECT * FROM [authorities] AS a')).toEqual([
        { alias: 'a', tableName: 'authorities' },
      ]);
    });

    it('handles schema.table', () => {
      expect(parseAliases('SELECT * FROM [dbo].[users] u')).toEqual([
        { alias: 'u', tableName: 'dbo.users' },
      ]);
    });
  });

  describe('without alias (new behavior)', () => {
    it('parses FROM table WHERE (WHERE not treated as alias)', () => {
      expect(parseAliases('SELECT * FROM authorities WHERE id=1')).toEqual([
        { alias: 'authorities', tableName: 'authorities' },
      ]);
    });

    it('parses FROM table at end of string', () => {
      expect(parseAliases('SELECT * FROM authorities')).toEqual([
        { alias: 'authorities', tableName: 'authorities' },
      ]);
    });

    it('parses FROM table ORDER BY', () => {
      expect(parseAliases('SELECT * FROM users ORDER BY id')).toEqual([
        { alias: 'users', tableName: 'users' },
      ]);
    });

    it('parses FROM table GROUP BY', () => {
      expect(parseAliases('SELECT name FROM users GROUP BY name')).toEqual([
        { alias: 'users', tableName: 'users' },
      ]);
    });

    it('parses FROM table JOIN table2 (both without alias)', () => {
      expect(parseAliases('SELECT * FROM users JOIN orders ON users.id=orders.user_id')).toEqual([
        { alias: 'users', tableName: 'users' },
        { alias: 'orders', tableName: 'orders' },
      ]);
    });

    it('parses FROM table INNER JOIN (INNER not treated as alias)', () => {
      expect(parseAliases('SELECT * FROM users INNER JOIN orders o ON users.id=o.user_id')).toEqual(
        [
          { alias: 'users', tableName: 'users' },
          { alias: 'o', tableName: 'orders' },
        ]
      );
    });

    it('parses FROM table LEFT JOIN', () => {
      expect(parseAliases('SELECT * FROM users LEFT JOIN orders o ON users.id=o.user_id')).toEqual([
        { alias: 'users', tableName: 'users' },
        { alias: 'o', tableName: 'orders' },
      ]);
    });

    it('handles [bracketed] table without alias', () => {
      expect(parseAliases('SELECT * FROM [authorities] WHERE id=1')).toEqual([
        { alias: 'authorities', tableName: 'authorities' },
      ]);
    });
  });

  describe('mixed cases', () => {
    it('mixes aliased and non-aliased tables', () => {
      expect(
        parseAliases('SELECT * FROM users u JOIN orders ON u.id=orders.user_id WHERE u.active=1')
      ).toEqual([
        { alias: 'u', tableName: 'users' },
        { alias: 'orders', tableName: 'orders' },
      ]);
    });
  });
});
