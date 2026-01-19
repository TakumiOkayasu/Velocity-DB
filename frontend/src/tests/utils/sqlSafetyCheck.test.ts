import { describe, expect, it } from 'vitest';
import { checkSqlSafety, getQueryWarnings, hasWhereClause } from '../../utils/sqlSafetyCheck';

describe('sqlSafetyCheck', () => {
  describe('checkSqlSafety', () => {
    it('should allow SELECT queries', () => {
      const result = checkSqlSafety('SELECT * FROM users');
      expect(result.isSafe).toBe(true);
    });

    it('should block INSERT queries', () => {
      const result = checkSqlSafety("INSERT INTO users (name) VALUES ('test')");
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('INSERT');
    });

    it('should block UPDATE queries', () => {
      const result = checkSqlSafety("UPDATE users SET name = 'test'");
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('UPDATE');
    });

    it('should block DELETE queries', () => {
      const result = checkSqlSafety('DELETE FROM users');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('DELETE');
    });

    it('should block DROP queries', () => {
      const result = checkSqlSafety('DROP TABLE users');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('DROP');
    });

    it('should block ALTER queries', () => {
      const result = checkSqlSafety('ALTER TABLE users ADD column1 INT');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('ALTER');
    });

    it('should block CREATE queries', () => {
      const result = checkSqlSafety('CREATE TABLE test (id INT)');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('CREATE');
    });

    it('should block TRUNCATE queries', () => {
      const result = checkSqlSafety('TRUNCATE TABLE users');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('TRUNCATE');
    });

    it('should block EXEC queries', () => {
      const result = checkSqlSafety('EXEC sp_some_procedure');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('EXEC');
    });

    it('should handle queries with leading comments', () => {
      const result = checkSqlSafety('-- This is a comment\nDELETE FROM users');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('DELETE');
    });

    it('should handle queries with block comments', () => {
      const result = checkSqlSafety('/* comment */ UPDATE users SET x = 1');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('UPDATE');
    });

    it('should handle empty queries', () => {
      const result = checkSqlSafety('');
      expect(result.isSafe).toBe(true);
    });

    it('should handle whitespace-only queries', () => {
      const result = checkSqlSafety('   \n\t  ');
      expect(result.isSafe).toBe(true);
    });

    it('should be case-insensitive', () => {
      const result = checkSqlSafety('delete from users');
      expect(result.isSafe).toBe(false);
      expect(result.detectedKeyword).toBe('DELETE');
    });
  });

  describe('hasWhereClause', () => {
    it('should detect WHERE clause in UPDATE', () => {
      expect(hasWhereClause('UPDATE users SET name = "test" WHERE id = 1')).toBe(true);
    });

    it('should detect missing WHERE clause in UPDATE', () => {
      expect(hasWhereClause('UPDATE users SET name = "test"')).toBe(false);
    });

    it('should detect WHERE clause in DELETE', () => {
      expect(hasWhereClause('DELETE FROM users WHERE id = 1')).toBe(true);
    });

    it('should detect missing WHERE clause in DELETE', () => {
      expect(hasWhereClause('DELETE FROM users')).toBe(false);
    });

    it('should return true for SELECT queries', () => {
      expect(hasWhereClause('SELECT * FROM users')).toBe(true);
    });

    it('should return true for INSERT queries', () => {
      expect(hasWhereClause("INSERT INTO users VALUES (1, 'test')")).toBe(true);
    });
  });

  describe('getQueryWarnings', () => {
    it('should warn about DML in production', () => {
      const warnings = getQueryWarnings("INSERT INTO users VALUES (1, 'test')", true);
      expect(warnings.length).toBe(1);
      expect(warnings[0].type).toBe('dml_in_production');
      expect(warnings[0].keyword).toBe('INSERT');
    });

    it('should warn about UPDATE without WHERE in production', () => {
      const warnings = getQueryWarnings("UPDATE users SET name = 'test'", true);
      expect(warnings.length).toBe(2);
      expect(warnings.some((w) => w.type === 'dml_in_production')).toBe(true);
      expect(warnings.some((w) => w.type === 'no_where')).toBe(true);
    });

    it('should warn about DELETE without WHERE in production', () => {
      const warnings = getQueryWarnings('DELETE FROM users', true);
      expect(warnings.length).toBe(2);
      expect(warnings.some((w) => w.type === 'no_where')).toBe(true);
    });

    it('should not warn about SELECT in production', () => {
      const warnings = getQueryWarnings('SELECT * FROM users', true);
      expect(warnings.length).toBe(0);
    });

    it('should not warn when not in production', () => {
      const warnings = getQueryWarnings("INSERT INTO users VALUES (1, 'test')", false);
      expect(warnings.length).toBe(0);
    });

    it('should still warn about missing WHERE even when not in production', () => {
      const warnings = getQueryWarnings("UPDATE users SET name = 'test'", false);
      expect(warnings.some((w) => w.type === 'no_where')).toBe(true);
    });

    it('should handle empty queries', () => {
      const warnings = getQueryWarnings('', true);
      expect(warnings.length).toBe(0);
    });
  });
});
