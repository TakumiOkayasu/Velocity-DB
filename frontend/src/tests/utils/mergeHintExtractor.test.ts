import { describe, expect, it } from 'vitest';
import { extractMergeTargets } from '../../utils/mergeHintExtractor';
import { sliceAt as slice } from './_helpers';

describe('extractMergeTargets', () => {
  describe('基本的なMERGE構文 (SQL Server / PostgreSQL 共通)', () => {
    it('MERGE INTO ... USING ... ON ... WHEN MATCHED THEN UPDATE SET ...', () => {
      const sql =
        'MERGE INTO users AS t USING staging AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET name = s.name, age = s.age;';
      const { updateTargets, insertTargets } = extractMergeTargets(sql);
      expect(insertTargets).toHaveLength(0);
      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].tableName).toBe('users');
      expect(updateTargets[0].assignments.map((a) => a.columnName)).toEqual(['name', 'age']);
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe('s.name');
      expect(slice(sql, updateTargets[0].assignments[1].value)).toBe('s.age');
    });

    it('WHEN NOT MATCHED THEN INSERT (cols) VALUES (vals) - 明示カラムリスト', () => {
      const sql =
        'MERGE INTO users USING staging ON users.id = staging.id WHEN NOT MATCHED THEN INSERT (id, name) VALUES (staging.id, staging.name);';
      const { insertTargets, updateTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(0);
      expect(insertTargets).toHaveLength(1);
      expect(insertTargets[0].tableName).toBe('users');
      expect(insertTargets[0].columnNames).toEqual(['id', 'name']);
      expect(insertTargets[0].valueRows).toHaveLength(1);
      expect(slice(sql, insertTargets[0].valueRows[0][0])).toBe('staging.id');
      expect(slice(sql, insertTargets[0].valueRows[0][1])).toBe('staging.name');
    });

    it('WHEN MATCHED UPDATE + WHEN NOT MATCHED INSERT の両方', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id ' +
        'WHEN MATCHED THEN UPDATE SET a = s.a, b = s.b ' +
        'WHEN NOT MATCHED THEN INSERT (a, b) VALUES (s.a, s.b);';
      const { updateTargets, insertTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(1);
      expect(insertTargets).toHaveLength(1);
      expect(updateTargets[0].tableName).toBe('t');
      expect(insertTargets[0].tableName).toBe('t');
      expect(updateTargets[0].assignments.map((a) => a.columnName)).toEqual(['a', 'b']);
      expect(insertTargets[0].columnNames).toEqual(['a', 'b']);
    });

    it('大文字小文字を区別しない', () => {
      const sql =
        'merge into t using s on t.id = s.id when matched then update set a = 1 when not matched then insert (a) values (2);';
      const { updateTargets, insertTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].tableName).toBe('t');
      expect(updateTargets[0].assignments[0].columnName).toBe('a');
      expect(insertTargets[0].columnNames).toEqual(['a']);
    });
  });

  describe('WHEN 句のバリエーション', () => {
    it('AND 条件付き WHEN MATCHED', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED AND s.active = 1 THEN UPDATE SET x = s.x;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].assignments[0].columnName).toBe('x');
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe('s.x');
    });

    it('WHEN NOT MATCHED BY TARGET - PostgreSQL / SQL Server 両対応', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN NOT MATCHED BY TARGET THEN INSERT (a) VALUES (s.a);';
      const { insertTargets } = extractMergeTargets(sql);
      expect(insertTargets).toHaveLength(1);
      expect(insertTargets[0].columnNames).toEqual(['a']);
    });

    it('WHEN NOT MATCHED BY SOURCE - UPDATE 適用 (SQL Server / PostgreSQL)', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN NOT MATCHED BY SOURCE THEN UPDATE SET flag = 0;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].assignments[0].columnName).toBe('flag');
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe('0');
    });

    it('DELETE / DO NOTHING 句はスキップ', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id ' +
        'WHEN MATCHED AND s.del = 1 THEN DELETE ' +
        'WHEN MATCHED THEN UPDATE SET x = s.x ' +
        'WHEN NOT MATCHED THEN DO NOTHING;';
      const { updateTargets, insertTargets } = extractMergeTargets(sql);
      expect(insertTargets).toHaveLength(0);
      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].assignments[0].columnName).toBe('x');
    });

    it('複数の UPDATE 句 (BY SOURCE + BY TARGET)', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id ' +
        'WHEN MATCHED THEN UPDATE SET a = s.a ' +
        'WHEN NOT MATCHED BY SOURCE THEN UPDATE SET b = 0;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(2);
      expect(updateTargets[0].assignments[0].columnName).toBe('a');
      expect(updateTargets[1].assignments[0].columnName).toBe('b');
    });
  });

  describe('テーブル修飾とエイリアス', () => {
    it('WITH (NOLOCK) テーブルヒントをスキップ (SQL Server)', () => {
      const sql =
        'MERGE INTO users WITH (HOLDLOCK) AS t USING staging s ON t.id = s.id WHEN MATCHED THEN UPDATE SET name = s.name;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].tableName).toBe('users');
      expect(updateTargets[0].assignments[0].columnName).toBe('name');
    });

    it('INTO 省略 (SQL Server 旧構文)', () => {
      const sql =
        'MERGE users t USING staging s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].tableName).toBe('users');
    });

    it('schema.table 形式', () => {
      const sql =
        'MERGE INTO public.users USING staging ON users.id = staging.id WHEN MATCHED THEN UPDATE SET a = 1;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].tableName).toBe('public.users');
    });

    it('[bracket] テーブル名', () => {
      const sql =
        'MERGE INTO [my table] USING src ON [my table].id = src.id WHEN MATCHED THEN UPDATE SET a = 1;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].tableName).toBe('my table');
    });
  });

  describe('終端キーワード', () => {
    it('OUTPUT 句で WHEN 句群が終端 (SQL Server)', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a OUTPUT $action, inserted.id;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].assignments).toHaveLength(1);
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe('s.a');
    });

    it('OPTION 句で終端 (SQL Server)', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a OPTION (RECOMPILE);';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].assignments).toHaveLength(1);
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe('s.a');
    });

    it('RETURNING 句で終端 (PostgreSQL)', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a RETURNING *;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].assignments).toHaveLength(1);
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe('s.a');
    });

    it('; で終端', () => {
      const sql = 'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = 1, b = 2;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].assignments).toHaveLength(2);
      expect(slice(sql, updateTargets[0].assignments[1].value)).toBe('2');
    });
  });

  describe('値の特殊パターン', () => {
    it('関数呼び出し・式を含む値', () => {
      const sql =
        "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET name = COALESCE(s.name, 'unknown'), ts = NOW();";
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].assignments).toHaveLength(2);
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe("COALESCE(s.name, 'unknown')");
      expect(slice(sql, updateTargets[0].assignments[1].value)).toBe('NOW()');
    });

    it('文字列リテラル内のカンマは値区切りとみなさない', () => {
      const sql =
        "MERGE INTO t USING s ON t.id = s.id WHEN NOT MATCHED THEN INSERT (a, b) VALUES ('x, y', 'z');";
      const { insertTargets } = extractMergeTargets(sql);
      expect(insertTargets[0].valueRows[0]).toHaveLength(2);
      expect(slice(sql, insertTargets[0].valueRows[0][0])).toBe("'x, y'");
      expect(slice(sql, insertTargets[0].valueRows[0][1])).toBe("'z'");
    });

    it('INSERT の複数行 VALUES は通常 MERGE では非対応 (1行想定)', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN NOT MATCHED THEN INSERT (a) VALUES (1);';
      const { insertTargets } = extractMergeTargets(sql);
      expect(insertTargets[0].valueRows).toHaveLength(1);
      expect(insertTargets[0].valueRows[0]).toHaveLength(1);
    });
  });

  describe('コメント', () => {
    it('ブロックコメント内の MERGE は無視', () => {
      const sql =
        '/* MERGE INTO fake USING fakesrc ON true WHEN MATCHED THEN UPDATE SET x = 1 */ ' +
        'MERGE INTO real USING src ON real.id = src.id WHEN MATCHED THEN UPDATE SET y = src.y;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].tableName).toBe('real');
      expect(updateTargets[0].assignments[0].columnName).toBe('y');
    });

    it('行コメント内の MERGE は無視', () => {
      const sql =
        '-- MERGE INTO fake USING s ON true WHEN MATCHED THEN UPDATE SET z = 1\n' +
        'MERGE INTO real USING s ON real.id = s.id WHEN MATCHED THEN UPDATE SET y = s.y;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].tableName).toBe('real');
    });
  });

  describe('複数MERGE文', () => {
    it('2つの MERGE 文を両方抽出', () => {
      const sql =
        'MERGE INTO t1 USING s ON t1.id = s.id WHEN MATCHED THEN UPDATE SET a = 1; ' +
        'MERGE INTO t2 USING s ON t2.id = s.id WHEN NOT MATCHED THEN INSERT (x) VALUES (2);';
      const { updateTargets, insertTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(1);
      expect(insertTargets).toHaveLength(1);
      expect(updateTargets[0].tableName).toBe('t1');
      expect(insertTargets[0].tableName).toBe('t2');
    });
  });

  describe('異常系', () => {
    it('MERGE文なし - 空', () => {
      const result = extractMergeTargets('SELECT * FROM t');
      expect(result.insertTargets).toEqual([]);
      expect(result.updateTargets).toEqual([]);
    });

    it('空文字列 - 空', () => {
      const result = extractMergeTargets('');
      expect(result.insertTargets).toEqual([]);
      expect(result.updateTargets).toEqual([]);
    });

    it('WHEN 句なし (書きかけ) - 空', () => {
      const result = extractMergeTargets('MERGE INTO t USING s ON t.id = s.id');
      expect(result.insertTargets).toEqual([]);
      expect(result.updateTargets).toEqual([]);
    });

    it('テーブル名なしの MERGE - 抽出しない', () => {
      const result = extractMergeTargets(
        'MERGE USING s ON true WHEN MATCHED THEN UPDATE SET a = 1'
      );
      expect(result.updateTargets).toEqual([]);
    });
  });

  describe('実用的な MERGE クエリ (UPSERT パターン)', () => {
    it('典型的な UPSERT (UPDATE + INSERT) パターン', () => {
      const sql = `MERGE INTO target AS t
USING (SELECT id, name, price FROM staging) AS s
ON t.id = s.id
WHEN MATCHED AND t.price <> s.price THEN
  UPDATE SET name = s.name, price = s.price, updated_at = NOW()
WHEN NOT MATCHED THEN
  INSERT (id, name, price) VALUES (s.id, s.name, s.price);`;
      const { updateTargets, insertTargets } = extractMergeTargets(sql);

      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].tableName).toBe('target');
      expect(updateTargets[0].assignments.map((a) => a.columnName)).toEqual([
        'name',
        'price',
        'updated_at',
      ]);
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe('s.name');
      expect(slice(sql, updateTargets[0].assignments[1].value)).toBe('s.price');
      expect(slice(sql, updateTargets[0].assignments[2].value)).toBe('NOW()');

      expect(insertTargets).toHaveLength(1);
      expect(insertTargets[0].tableName).toBe('target');
      expect(insertTargets[0].columnNames).toEqual(['id', 'name', 'price']);
      expect(slice(sql, insertTargets[0].valueRows[0][0])).toBe('s.id');
      expect(slice(sql, insertTargets[0].valueRows[0][1])).toBe('s.name');
      expect(slice(sql, insertTargets[0].valueRows[0][2])).toBe('s.price');
    });

    it('CASE 式を UPDATE SET の値として含む', () => {
      const sql =
        "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET status = CASE WHEN s.v > 0 THEN 'A' ELSE 'B' END, flag = 1;";
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].assignments).toHaveLength(2);
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe(
        "CASE WHEN s.v > 0 THEN 'A' ELSE 'B' END"
      );
      expect(slice(sql, updateTargets[0].assignments[1].value)).toBe('1');
    });

    it('サブクエリを UPDATE SET の値として含む', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET total = (SELECT SUM(x) FROM items WHERE items.tid = t.id);';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets[0].assignments).toHaveLength(1);
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe(
        '(SELECT SUM(x) FROM items WHERE items.tid = t.id)'
      );
    });

    it('USING (SELECT ...) - source がサブクエリ (実用で頻出)', () => {
      const sql =
        'MERGE INTO users t USING (SELECT id, name FROM staging WHERE active = 1) s ON t.id = s.id WHEN MATCHED THEN UPDATE SET name = s.name;';
      const { updateTargets } = extractMergeTargets(sql);
      expect(updateTargets).toHaveLength(1);
      expect(updateTargets[0].tableName).toBe('users');
      expect(updateTargets[0].assignments[0].columnName).toBe('name');
      expect(slice(sql, updateTargets[0].assignments[0].value)).toBe('s.name');
    });

    it('ラベル↔値の因果: 多列 UPDATE で各値 offset が左辺カラムに対応', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET col_a = 10, col_b = 20, col_c = 30;';
      const { updateTargets } = extractMergeTargets(sql);
      const a = updateTargets[0].assignments;
      expect(a[0].columnName).toBe('col_a');
      expect(a[0].value.offset).toBe(sql.indexOf('10'));
      expect(a[1].columnName).toBe('col_b');
      expect(a[1].value.offset).toBe(sql.indexOf('20'));
      expect(a[2].columnName).toBe('col_c');
      expect(a[2].value.offset).toBe(sql.indexOf('30'));
    });

    it('ラベル↔値の因果: INSERT VALUES 各値 offset が columnNames 順に対応', () => {
      const sql =
        'MERGE INTO t USING s ON t.id = s.id WHEN NOT MATCHED THEN INSERT (ca, cb, cc) VALUES (111, 222, 333);';
      const { insertTargets } = extractMergeTargets(sql);
      const row = insertTargets[0].valueRows[0];
      expect(insertTargets[0].columnNames).toEqual(['ca', 'cb', 'cc']);
      expect(row[0].offset).toBe(sql.indexOf('111'));
      expect(row[1].offset).toBe(sql.indexOf('222'));
      expect(row[2].offset).toBe(sql.indexOf('333'));
    });
  });
});
