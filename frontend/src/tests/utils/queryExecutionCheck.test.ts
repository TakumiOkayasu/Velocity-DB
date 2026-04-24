import { describe, expect, it } from 'vitest';
import {
  checkQueryExecutability,
  previewSql,
  SQL_PREVIEW_MAX_LENGTH,
} from '../../utils/queryExecutionCheck';

describe('previewSql', () => {
  it('should return original string when length <= 200', () => {
    const sql = 'SELECT * FROM users';
    expect(previewSql(sql)).toBe(sql);
  });

  it('should return exact boundary (200 chars) without truncation', () => {
    const sql = 'a'.repeat(SQL_PREVIEW_MAX_LENGTH);
    expect(previewSql(sql)).toBe(sql);
    expect(previewSql(sql).endsWith('...')).toBe(false);
  });

  it('should truncate and append "..." when length > 200', () => {
    const sql = 'a'.repeat(250);
    const result = previewSql(sql);
    expect(result).toBe(`${'a'.repeat(200)}...`);
    expect(result.length).toBe(203);
  });

  it('should return empty string for empty input', () => {
    expect(previewSql('')).toBe('');
  });
});

describe('checkQueryExecutability', () => {
  describe('execute action', () => {
    it('should allow SELECT in read-only + production', () => {
      const result = checkQueryExecutability('SELECT * FROM users', {
        isReadOnly: true,
        isProduction: true,
      });
      expect(result).toEqual({ action: 'execute' });
    });

    it('should allow any SQL when not read-only and not production', () => {
      const result = checkQueryExecutability('DELETE FROM users', {
        isReadOnly: false,
        isProduction: false,
      });
      expect(result).toEqual({ action: 'execute' });
    });
  });

  describe('block action (read-only)', () => {
    it('should block DML in read-only mode', () => {
      const result = checkQueryExecutability('DELETE FROM users', {
        isReadOnly: true,
        isProduction: false,
      });
      expect(result.action).toBe('block');
      if (result.action === 'block') {
        expect(result.title).toBe('Read-Only Mode');
        expect(result.message).toContain('DELETE');
        expect(result.details).toBe('DELETE FROM users');
      }
    });

    it('should include truncated preview for long blocked SQL', () => {
      const longSql = `UPDATE users SET name = '${'x'.repeat(300)}' WHERE id = 1`;
      const result = checkQueryExecutability(longSql, {
        isReadOnly: true,
        isProduction: false,
      });
      expect(result.action).toBe('block');
      if (result.action === 'block') {
        expect(result.details.endsWith('...')).toBe(true);
        expect(result.details.length).toBe(203);
      }
    });
  });

  describe('warn action (production)', () => {
    it('should warn on DML in production when not read-only', () => {
      const result = checkQueryExecutability('DELETE FROM users WHERE id = 1', {
        isReadOnly: false,
        isProduction: true,
      });
      expect(result.action).toBe('warn');
      if (result.action === 'warn') {
        expect(result.title).toBe('Production Warning');
        expect(result.message).toContain('DELETE');
        expect(result.details).toBe('DELETE FROM users WHERE id = 1');
      }
    });

    it('should warn with multiple messages for UPDATE without WHERE in production', () => {
      const result = checkQueryExecutability('UPDATE users SET status = 1', {
        isReadOnly: false,
        isProduction: true,
      });
      expect(result.action).toBe('warn');
      if (result.action === 'warn') {
        expect(result.message).toContain('production');
        expect(result.message).toContain('WHERE');
      }
    });

    it('should allow SELECT in production without warning', () => {
      const result = checkQueryExecutability('SELECT * FROM users', {
        isReadOnly: false,
        isProduction: true,
      });
      expect(result).toEqual({ action: 'execute' });
    });
  });

  describe('priority: read-only takes precedence over production', () => {
    it('should block (not warn) when both flags true and SQL is DML', () => {
      const result = checkQueryExecutability('DELETE FROM users', {
        isReadOnly: true,
        isProduction: true,
      });
      expect(result.action).toBe('block');
    });
  });

  describe('edge cases', () => {
    it('should allow empty SQL in read-only mode', () => {
      const result = checkQueryExecutability('', {
        isReadOnly: true,
        isProduction: true,
      });
      expect(result).toEqual({ action: 'execute' });
    });

    it('should allow commented-out DML in read-only mode (not executed as DML)', () => {
      const result = checkQueryExecutability('-- DELETE FROM users\nSELECT 1', {
        isReadOnly: true,
        isProduction: false,
      });
      expect(result).toEqual({ action: 'execute' });
    });

    it('should include both dml_in_production and no_where warnings joined by newline', () => {
      const result = checkQueryExecutability('UPDATE users SET status = 1', {
        isReadOnly: false,
        isProduction: true,
      });
      expect(result.action).toBe('warn');
      if (result.action === 'warn') {
        const lines = result.message.split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('production');
        expect(lines[1]).toContain('WHERE');
      }
    });

    it('should emit single warning for UPDATE with WHERE in production', () => {
      const result = checkQueryExecutability('UPDATE users SET status = 1 WHERE id = 1', {
        isReadOnly: false,
        isProduction: true,
      });
      expect(result.action).toBe('warn');
      if (result.action === 'warn') {
        expect(result.message.split('\n')).toHaveLength(1);
        expect(result.message).toContain('production');
      }
    });
  });
});
