import { describe, expect, it } from 'vite-plus/test';
import { extractInsertTargets } from '../../utils/insertHintExtractor';
import { sliceAt as slice } from './_helpers';

describe('extractInsertTargets', () => {
  describe('基本的なINSERT構文', () => {
    it('INSERT INTO t VALUES (1, 2, 3) - カラムリストなし', () => {
      const targets = extractInsertTargets('INSERT INTO users VALUES (1, 2, 3)');
      expect(targets).toHaveLength(1);
      expect(targets[0].tableName).toBe('users');
      expect(targets[0].columnNames).toBeNull();
      expect(targets[0].valueRows).toHaveLength(1);
      expect(targets[0].valueRows[0]).toHaveLength(3);
    });

    it('INSERT INTO t (c1, c2) VALUES (1, 2) - 明示的カラムリスト', () => {
      const sql = 'INSERT INTO users (id, name) VALUES (1, 2)';
      const targets = extractInsertTargets(sql);
      expect(targets[0].tableName).toBe('users');
      expect(targets[0].columnNames).toEqual(['id', 'name']);
      expect(targets[0].valueRows[0]).toHaveLength(2);
    });

    it('値のoffset/lengthが元SQLの値と一致', () => {
      const sql = 'INSERT INTO t VALUES (42, 100, 999)';
      const row = extractInsertTargets(sql)[0].valueRows[0];
      expect(slice(sql, row[0])).toBe('42');
      expect(slice(sql, row[1])).toBe('100');
      expect(slice(sql, row[2])).toBe('999');
    });

    it('大文字小文字を区別しない (insert into)', () => {
      const targets = extractInsertTargets('insert into users values (1)');
      expect(targets).toHaveLength(1);
      expect(targets[0].tableName).toBe('users');
    });
  });

  describe('識別子quote', () => {
    it('[bracket] テーブル名', () => {
      const targets = extractInsertTargets('INSERT INTO [my table] VALUES (1)');
      expect(targets[0].tableName).toBe('my table');
    });

    it('`backtick` テーブル名', () => {
      const targets = extractInsertTargets('INSERT INTO `my-table` VALUES (1)');
      expect(targets[0].tableName).toBe('my-table');
    });

    it('"doubleQuote" テーブル名', () => {
      const targets = extractInsertTargets('INSERT INTO "my.table" VALUES (1)');
      expect(targets[0].tableName).toBe('my.table');
    });

    it('schema.table 形式', () => {
      const targets = extractInsertTargets('INSERT INTO public.users VALUES (1)');
      expect(targets[0].tableName).toBe('public.users');
    });

    it('カラム名のquote解除', () => {
      const sql = 'INSERT INTO t ([col 1], `col-2`, "col.3") VALUES (1, 2, 3)';
      const targets = extractInsertTargets(sql);
      expect(targets[0].columnNames).toEqual(['col 1', 'col-2', 'col.3']);
    });
  });

  describe('複数値行', () => {
    it('INSERT ... VALUES (...), (...), (...) - 3行', () => {
      const sql = 'INSERT INTO t VALUES (1, 2), (3, 4), (5, 6)';
      const targets = extractInsertTargets(sql);
      expect(targets).toHaveLength(1);
      expect(targets[0].valueRows).toHaveLength(3);
      expect(targets[0].valueRows[0]).toHaveLength(2);
      expect(targets[0].valueRows[1]).toHaveLength(2);
      expect(targets[0].valueRows[2]).toHaveLength(2);
    });

    it('複数行の各値 offset が元SQLの値位置を正確に指す', () => {
      const sql = 'INSERT INTO t VALUES (11, 22), (33, 44)';
      const rows = extractInsertTargets(sql)[0].valueRows;
      expect(slice(sql, rows[0][0])).toBe('11');
      expect(slice(sql, rows[0][1])).toBe('22');
      expect(slice(sql, rows[1][0])).toBe('33');
      expect(slice(sql, rows[1][1])).toBe('44');
    });
  });

  describe('値内の特殊文字', () => {
    it('文字列リテラル内のカンマは値区切りとみなさない', () => {
      const sql = "INSERT INTO t VALUES ('a, b', 'c')";
      const targets = extractInsertTargets(sql);
      expect(targets[0].valueRows[0]).toHaveLength(2);
    });

    it("文字列リテラル値のoffset/lengthが '...' 全体を指す", () => {
      const sql = "INSERT INTO t VALUES ('a, b', 'c')";
      const [v1, v2] = extractInsertTargets(sql)[0].valueRows[0];
      expect(slice(sql, v1)).toBe("'a, b'");
      expect(slice(sql, v2)).toBe("'c'");
    });

    it('関数呼び出しのネスト括弧', () => {
      const sql = 'INSERT INTO t VALUES (COALESCE(a, b), c)';
      const targets = extractInsertTargets(sql);
      expect(targets[0].valueRows[0]).toHaveLength(2);
    });

    it("エスケープされたシングルクォート '' は文字列内扱い", () => {
      const sql = "INSERT INTO t VALUES ('it''s, ok', 1)";
      const targets = extractInsertTargets(sql);
      expect(targets[0].valueRows[0]).toHaveLength(2);
    });
  });

  describe('複数INSERT文', () => {
    it('2つのINSERT文を両方抽出', () => {
      const sql = 'INSERT INTO t1 VALUES (1); INSERT INTO t2 VALUES (2);';
      const targets = extractInsertTargets(sql);
      expect(targets).toHaveLength(2);
      expect(targets[0].tableName).toBe('t1');
      expect(targets[1].tableName).toBe('t2');
    });
  });

  describe('コメント', () => {
    it('行コメント内のINSERTは無視', () => {
      const sql = '-- INSERT INTO fake VALUES (1)\nINSERT INTO real VALUES (2)';
      const targets = extractInsertTargets(sql);
      expect(targets).toHaveLength(1);
      expect(targets[0].tableName).toBe('real');
    });

    it('ブロックコメント内のINSERTは無視', () => {
      const sql = '/* INSERT INTO fake VALUES (1) */ INSERT INTO real VALUES (2)';
      const targets = extractInsertTargets(sql);
      expect(targets).toHaveLength(1);
      expect(targets[0].tableName).toBe('real');
    });
  });

  describe('異常系', () => {
    it('INSERT文なし - 空配列', () => {
      expect(extractInsertTargets('SELECT * FROM t')).toEqual([]);
    });

    it('空文字列', () => {
      expect(extractInsertTargets('')).toEqual([]);
    });

    it('VALUES句なし (書きかけ) - 抽出しない', () => {
      expect(extractInsertTargets('INSERT INTO t')).toEqual([]);
    });

    it('閉じ括弧なし - 抽出しない', () => {
      expect(extractInsertTargets('INSERT INTO t VALUES (1, 2')).toEqual([]);
    });

    it('INSERT ... SELECT 構文 - VALUES句なしなので抽出しない', () => {
      const targets = extractInsertTargets('INSERT INTO t SELECT * FROM u');
      expect(targets).toEqual([]);
    });
  });

  describe('空白・改行の柔軟性', () => {
    it('改行を跨いだINSERT', () => {
      const sql = 'INSERT INTO t\n  (a, b)\nVALUES\n  (1, 2)';
      const targets = extractInsertTargets(sql);
      expect(targets[0].columnNames).toEqual(['a', 'b']);
      expect(targets[0].valueRows[0]).toHaveLength(2);
    });

    it('値前後の空白はlengthに含めない', () => {
      const sql = 'INSERT INTO t VALUES (  42  ,  99  )';
      const row = extractInsertTargets(sql)[0].valueRows[0];
      expect(slice(sql, row[0])).toBe('42');
      expect(slice(sql, row[1])).toBe('99');
    });
  });
});
