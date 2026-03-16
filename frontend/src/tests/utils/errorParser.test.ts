import { describe, expect, it } from 'vitest';
import { parseErrorMessage } from '../../utils/errorParser';

describe('parseErrorMessage', () => {
  describe('PostgreSQL', () => {
    it('psqlプレフィックス付きERRORを抽出', () => {
      const raw = 'psql:C:/Users/test/tmp/query.tmp:3: ERROR:  relation "bp" already exists';
      const result = parseErrorMessage(raw);
      expect(result.summary).toBe('relation "bp" already exists');
      expect(result.detail).toBe(raw);
    });

    it('psqlプレフィックスなしERRORを抽出', () => {
      const raw = 'ERROR:  syntax error at or near "SELEC"';
      const result = parseErrorMessage(raw);
      expect(result.summary).toBe('syntax error at or near "SELEC"');
      expect(result.detail).toBe(raw);
    });

    it('LINE情報付きのエラー', () => {
      const raw =
        'psql:C:/tmp/q.tmp:1: ERROR:  column "foo" does not exist\nLINE 1: SELECT foo FROM bar\n               ^';
      const result = parseErrorMessage(raw);
      expect(result.summary).toBe('column "foo" does not exist');
      expect(result.detail).toBe(raw);
    });
  });

  describe('SQL Server', () => {
    it('Msg NNNNパターンを抽出', () => {
      const raw = "Msg 208, Level 16, State 1, Line 1\nInvalid object name 'nonexistent'.";
      const result = parseErrorMessage(raw);
      expect(result.summary).toBe("Invalid object name 'nonexistent'.");
      expect(result.detail).toBe(raw);
    });

    it('複数行エラーの最初のメッセージ行を抽出', () => {
      const raw =
        "Msg 2627, Level 14, State 1, Line 1\nViolation of PRIMARY KEY constraint 'PK_users'. Cannot insert duplicate key.";
      const result = parseErrorMessage(raw);
      expect(result.summary).toBe(
        "Violation of PRIMARY KEY constraint 'PK_users'. Cannot insert duplicate key."
      );
      expect(result.detail).toBe(raw);
    });
  });

  describe('MySQL', () => {
    it('ERROR NNNN (NNNNN)パターンを抽出', () => {
      const raw = "ERROR 1045 (28000): Access denied for user 'root'@'localhost'";
      const result = parseErrorMessage(raw);
      expect(result.summary).toBe("Access denied for user 'root'@'localhost'");
      expect(result.detail).toBe(raw);
    });
  });

  describe('不明形式', () => {
    it('パースできない場合はrawメッセージをsummaryに返す', () => {
      const raw = 'Something went wrong';
      const result = parseErrorMessage(raw);
      expect(result.summary).toBe('Something went wrong');
      expect(result.detail).toBe(raw);
    });

    it('複数行の不明形式は1行目のみsummaryに返す', () => {
      const raw = 'Unknown error occurred\nDetails: something\nMore info';
      const result = parseErrorMessage(raw);
      expect(result.summary).toBe('Unknown error occurred');
      expect(result.detail).toBe(raw);
    });

    it('空文字列', () => {
      const result = parseErrorMessage('');
      expect(result.summary).toBe('');
      expect(result.detail).toBe('');
    });
  });
});
