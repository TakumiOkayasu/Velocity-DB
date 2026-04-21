import { describe, expect, it } from 'vitest';
import { extractUpdateTargets } from '../../utils/updateHintExtractor';
import { sliceAt as slice } from './_helpers';

describe('extractUpdateTargets', () => {
  describe('基本的なUPDATE構文', () => {
    it('UPDATE t SET c1=1, c2=2 - 2カラム代入', () => {
      const sql = 'UPDATE users SET id = 1, name = 2';
      const targets = extractUpdateTargets(sql);
      expect(targets).toHaveLength(1);
      expect(targets[0].tableName).toBe('users');
      expect(targets[0].assignments).toHaveLength(2);
      expect(targets[0].assignments[0].columnName).toBe('id');
      expect(targets[0].assignments[1].columnName).toBe('name');
    });

    it('値のoffset/lengthが元SQLの値と一致', () => {
      const sql = 'UPDATE t SET a = 42, b = 100';
      const [t] = extractUpdateTargets(sql);
      expect(slice(sql, t.assignments[0].value)).toBe('42');
      expect(slice(sql, t.assignments[1].value)).toBe('100');
    });

    it('大文字小文字を区別しない (update ... set)', () => {
      const targets = extractUpdateTargets('update users set name = 1');
      expect(targets).toHaveLength(1);
      expect(targets[0].tableName).toBe('users');
      expect(targets[0].assignments[0].columnName).toBe('name');
    });
  });

  describe('終端キーワード', () => {
    it('WHERE で SET 句が終端', () => {
      const sql = 'UPDATE t SET a = 1, b = 2 WHERE id = 5';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(slice(sql, t.assignments[1].value)).toBe('2');
    });

    it('FROM で SET 句が終端 (SQL Server / PostgreSQL)', () => {
      const sql = 'UPDATE t SET a = s.v FROM src s WHERE t.id = s.id';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(1);
      expect(slice(sql, t.assignments[0].value)).toBe('s.v');
    });

    it('RETURNING で SET 句が終端 (PostgreSQL)', () => {
      const sql = 'UPDATE t SET a = 1 RETURNING id';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(1);
      expect(slice(sql, t.assignments[0].value)).toBe('1');
    });

    it('; で SET 句が終端', () => {
      const sql = 'UPDATE t SET a = 1, b = 2;';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(slice(sql, t.assignments[1].value)).toBe('2');
    });

    it('EOF で SET 句が終端 (WHERE無し)', () => {
      const sql = 'UPDATE t SET a = 1, b = 2';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(slice(sql, t.assignments[1].value)).toBe('2');
    });

    it('LIMIT で SET 句が終端 (MySQL)', () => {
      const sql = 'UPDATE t SET a = 1 LIMIT 10';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(1);
      expect(slice(sql, t.assignments[0].value)).toBe('1');
    });

    it('ORDER BY で SET 句が終端 (MySQL)', () => {
      const sql = 'UPDATE t SET a = 1 ORDER BY id';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(1);
      expect(slice(sql, t.assignments[0].value)).toBe('1');
    });
  });

  describe('alias (PostgreSQL / MySQL)', () => {
    it('AS 付き alias: UPDATE t AS x SET ...', () => {
      const sql = 'UPDATE users AS u SET name = 1';
      const [t] = extractUpdateTargets(sql);
      expect(t.tableName).toBe('users');
      expect(t.assignments).toHaveLength(1);
      expect(t.assignments[0].columnName).toBe('name');
    });

    it('AS なし alias: UPDATE t x SET ...', () => {
      const sql = 'UPDATE users u SET name = 1';
      const [t] = extractUpdateTargets(sql);
      expect(t.tableName).toBe('users');
      expect(t.assignments).toHaveLength(1);
      expect(t.assignments[0].columnName).toBe('name');
    });
  });

  describe('識別子quote', () => {
    it('[bracket] テーブル名', () => {
      const targets = extractUpdateTargets('UPDATE [my table] SET a = 1');
      expect(targets[0].tableName).toBe('my table');
    });

    it('`backtick` テーブル名', () => {
      const targets = extractUpdateTargets('UPDATE `my-table` SET a = 1');
      expect(targets[0].tableName).toBe('my-table');
    });

    it('"doubleQuote" テーブル名', () => {
      const targets = extractUpdateTargets('UPDATE "my.table" SET a = 1');
      expect(targets[0].tableName).toBe('my.table');
    });

    it('schema.table 形式', () => {
      const targets = extractUpdateTargets('UPDATE public.users SET a = 1');
      expect(targets[0].tableName).toBe('public.users');
    });

    it('カラム名のquote解除', () => {
      const sql = 'UPDATE t SET [col 1] = 1, `col-2` = 2, "col.3" = 3';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments.map((a) => a.columnName)).toEqual(['col 1', 'col-2', 'col.3']);
    });
  });

  describe('値内の特殊文字', () => {
    it('文字列リテラル内のカンマは値区切りとみなさない', () => {
      const sql = "UPDATE t SET a = 'x, y', b = 'z'";
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(t.assignments[0].columnName).toBe('a');
      expect(t.assignments[1].columnName).toBe('b');
    });

    it("文字列リテラル値のoffset/lengthが '...' 全体を指す", () => {
      const sql = "UPDATE t SET a = 'x, y', b = 'z'";
      const [t] = extractUpdateTargets(sql);
      expect(slice(sql, t.assignments[0].value)).toBe("'x, y'");
      expect(slice(sql, t.assignments[1].value)).toBe("'z'");
    });

    it('関数呼び出しのネスト括弧', () => {
      const sql = 'UPDATE t SET a = COALESCE(x, y), b = 1';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(slice(sql, t.assignments[0].value)).toBe('COALESCE(x, y)');
      expect(slice(sql, t.assignments[1].value)).toBe('1');
    });

    it("エスケープされたシングルクォート '' は文字列内扱い", () => {
      const sql = "UPDATE t SET a = 'it''s, ok', b = 1";
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(t.assignments[0].columnName).toBe('a');
      expect(t.assignments[1].columnName).toBe('b');
    });
  });

  describe('複数UPDATE文', () => {
    it('2つのUPDATE文を両方抽出', () => {
      const sql = 'UPDATE t1 SET a = 1; UPDATE t2 SET b = 2;';
      const targets = extractUpdateTargets(sql);
      expect(targets).toHaveLength(2);
      expect(targets[0].tableName).toBe('t1');
      expect(targets[1].tableName).toBe('t2');
    });
  });

  describe('コメント', () => {
    it('行コメント内のUPDATEは無視', () => {
      const sql = '-- UPDATE fake SET a = 1\nUPDATE real SET b = 2';
      const targets = extractUpdateTargets(sql);
      expect(targets).toHaveLength(1);
      expect(targets[0].tableName).toBe('real');
    });

    it('ブロックコメント内のUPDATEは無視', () => {
      const sql = '/* UPDATE fake SET a = 1 */ UPDATE real SET b = 2';
      const targets = extractUpdateTargets(sql);
      expect(targets).toHaveLength(1);
      expect(targets[0].tableName).toBe('real');
    });
  });

  describe('異常系', () => {
    it('UPDATE文なし - 空配列', () => {
      expect(extractUpdateTargets('SELECT * FROM t')).toEqual([]);
    });

    it('空文字列', () => {
      expect(extractUpdateTargets('')).toEqual([]);
    });

    it('SET句なし (書きかけ) - 抽出しない', () => {
      expect(extractUpdateTargets('UPDATE t')).toEqual([]);
    });

    it('= のない SET 項目 - 該当項目のみスキップ', () => {
      const sql = 'UPDATE t SET invalid, a = 1';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(1);
      expect(t.assignments[0].columnName).toBe('a');
    });

    it('UPDATE 直後にテーブル名なしで SET 開始 (不正SQL) - 抽出しない', () => {
      expect(extractUpdateTargets('UPDATE SET a = 1')).toEqual([]);
    });

    it('値が空 - 抽出しない', () => {
      const sql = 'UPDATE t SET a = , b = 1';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(1);
      expect(t.assignments[0].columnName).toBe('b');
    });
  });

  describe('実用的な UPDATE クエリ', () => {
    it('式・関数呼び出し・文字列の混在', () => {
      const sql = "UPDATE users SET name = 'John', count = count + 1, updated_at = NOW()";
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(3);
      expect(t.assignments.map((a) => a.columnName)).toEqual(['name', 'count', 'updated_at']);
      expect(slice(sql, t.assignments[0].value)).toBe("'John'");
      expect(slice(sql, t.assignments[1].value)).toBe('count + 1');
      expect(slice(sql, t.assignments[2].value)).toBe('NOW()');
    });

    it('CASE 式を値として含む', () => {
      const sql =
        "UPDATE t SET status = CASE WHEN x > 0 THEN 'active' ELSE 'inactive' END, flag = 1";
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(t.assignments[0].columnName).toBe('status');
      expect(slice(sql, t.assignments[0].value)).toBe(
        "CASE WHEN x > 0 THEN 'active' ELSE 'inactive' END"
      );
      expect(slice(sql, t.assignments[1].value)).toBe('1');
    });

    it('サブクエリを値として含む', () => {
      const sql = 'UPDATE t SET total = (SELECT SUM(x) FROM items WHERE t.id = items.tid)';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(1);
      expect(slice(sql, t.assignments[0].value)).toBe(
        '(SELECT SUM(x) FROM items WHERE t.id = items.tid)'
      );
    });

    it('WHERE 句ありで複数列を更新する典型パターン', () => {
      const sql =
        "UPDATE orders SET status = 'shipped', shipped_at = NOW() WHERE id = 123 AND status = 'pending'";
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(slice(sql, t.assignments[0].value)).toBe("'shipped'");
      expect(slice(sql, t.assignments[1].value)).toBe('NOW()');
    });
  });

  describe('空白・改行の柔軟性', () => {
    it('改行を跨いだUPDATE', () => {
      const sql = 'UPDATE t\nSET\n  a = 1,\n  b = 2\nWHERE id = 3';
      const [t] = extractUpdateTargets(sql);
      expect(t.assignments).toHaveLength(2);
      expect(t.assignments.map((x) => x.columnName)).toEqual(['a', 'b']);
    });

    it('値前後の空白はlengthに含めない', () => {
      const sql = 'UPDATE t SET a =  42  , b =  99  ';
      const [t] = extractUpdateTargets(sql);
      expect(slice(sql, t.assignments[0].value)).toBe('42');
      expect(slice(sql, t.assignments[1].value)).toBe('99');
    });
  });
});
