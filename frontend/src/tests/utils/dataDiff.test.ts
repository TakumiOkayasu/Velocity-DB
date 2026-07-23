import { describe, expect, it } from 'vitest';
import {
  type DiffResultSet,
  diffResultSets,
  diffResultSetsAsync,
  formatDiffSummary,
} from '../../utils/dataDiff';

function resultSet(columnNames: string[], rows: (string | null)[][]): DiffResultSet {
  return {
    columns: columnNames.map((name) => ({ name, type: 'varchar' })),
    rows,
  };
}

describe('dataDiff', () => {
  describe('基本分類', () => {
    it('identical: 完全一致の行を identical として分類する', () => {
      const a = resultSet(['id', 'name'], [['1', 'Alice']]);
      const b = resultSet(['id', 'name'], [['1', 'Alice']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 0, removed: 0, modified: 0, identical: 1 });
      expect(result.rows[0].status).toBe('identical');
      expect(result.rows[0].changedCells).toBeNull();
    });

    it('added: B にのみ存在する行を added として分類する', () => {
      const a = resultSet(['id', 'name'], [['1', 'Alice']]);
      const b = resultSet(
        ['id', 'name'],
        [
          ['1', 'Alice'],
          ['2', 'Bob'],
        ]
      );

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 1, removed: 0, modified: 0, identical: 1 });
      const added = result.rows.find((r) => r.status === 'added');
      expect(added?.keyDisplay).toBe('2');
      expect(added?.a).toBeNull();
      expect(added?.b).toEqual(['2', 'Bob']);
    });

    it('removed: A にのみ存在する行を removed として分類する', () => {
      const a = resultSet(
        ['id', 'name'],
        [
          ['1', 'Alice'],
          ['2', 'Bob'],
        ]
      );
      const b = resultSet(['id', 'name'], [['1', 'Alice']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 0, removed: 1, modified: 0, identical: 1 });
      const removed = result.rows.find((r) => r.status === 'removed');
      expect(removed?.keyDisplay).toBe('2');
      expect(removed?.a).toEqual(['2', 'Bob']);
      expect(removed?.b).toBeNull();
    });

    it('modified: キー一致でセルが異なる行を modified とし changedCells を立てる', () => {
      const a = resultSet(['id', 'name', 'age'], [['1', 'Alice', '20']]);
      const b = resultSet(['id', 'name', 'age'], [['1', 'Alicia', '20']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 0, removed: 0, modified: 1, identical: 0 });
      const modified = result.rows[0];
      expect(modified.status).toBe('modified');
      expect(modified.changedCells).toEqual([false, true, false]);
      expect(modified.a).toEqual(['1', 'Alice', '20']);
      expect(modified.b).toEqual(['1', 'Alicia', '20']);
    });

    it('混在: added/removed/modified/identical を同時に正しく数える', () => {
      const a = resultSet(
        ['id', 'v'],
        [
          ['1', 'same'],
          ['2', 'old'],
          ['3', 'gone'],
        ]
      );
      const b = resultSet(
        ['id', 'v'],
        [
          ['1', 'same'],
          ['2', 'new'],
          ['4', 'fresh'],
        ]
      );

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 1, removed: 1, modified: 1, identical: 1 });
    });
  });

  describe('キーカラム', () => {
    it('keyColumns 省略時は共通カラムの先頭をキーに使う', () => {
      const a = resultSet(['id', 'name'], [['1', 'Alice']]);
      const b = resultSet(['id', 'name'], [['1', 'Bob']]);

      const result = diffResultSets(a, b);

      expect(result.keyColumns).toEqual(['id']);
      expect(result.summary.modified).toBe(1);
    });

    it('複合キー: 全キーカラムが一致した行のみ突き合わせる', () => {
      const a = resultSet(
        ['tenant', 'id', 'v'],
        [
          ['t1', '1', 'x'],
          ['t2', '1', 'y'],
        ]
      );
      const b = resultSet(
        ['tenant', 'id', 'v'],
        [
          ['t1', '1', 'x'],
          ['t3', '1', 'y'],
        ]
      );

      const result = diffResultSets(a, b, { keyColumns: ['tenant', 'id'] });

      expect(result.summary).toEqual({ added: 1, removed: 1, modified: 0, identical: 1 });
      expect(result.rows.find((r) => r.status === 'removed')?.keyDisplay).toBe('t2 | 1');
      expect(result.rows.find((r) => r.status === 'added')?.keyDisplay).toBe('t3 | 1');
    });

    it('存在しないキーカラム指定でエラーを投げる', () => {
      const a = resultSet(['id'], [['1']]);
      const b = resultSet(['id'], [['1']]);

      expect(() => diffResultSets(a, b, { keyColumns: ['nope'] })).toThrow(
        /キーカラム "nope" は両方の結果セットに存在する必要があります/
      );
    });

    it('キー値の区切り文字衝突: JSON エンコードによりキーが混同されない', () => {
      // ["a|b", "c"] と ["a", "b|c"] が同一キーにならないこと
      const a = resultSet(['k1', 'k2'], [['a|b', 'c']]);
      const b = resultSet(['k1', 'k2'], [['a', 'b|c']]);

      const result = diffResultSets(a, b, { keyColumns: ['k1', 'k2'] });

      expect(result.summary).toEqual({ added: 1, removed: 1, modified: 0, identical: 0 });
    });
  });

  describe('重複キー', () => {
    it('重複キーは警告を出し、出現順に位置対応で比較する', () => {
      const a = resultSet(
        ['id', 'v'],
        [
          ['1', 'a1'],
          ['1', 'a2'],
          ['1', 'a3'],
        ]
      );
      const b = resultSet(
        ['id', 'v'],
        [
          ['1', 'a1'],
          ['1', 'b2'],
        ]
      );

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      // a1 vs a1 = identical, a2 vs b2 = modified, a3 = removed
      expect(result.summary).toEqual({ added: 0, removed: 1, modified: 1, identical: 1 });
      expect(result.warnings.some((w) => w.includes('A 側でキーが重複'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('B 側でキーが重複'))).toBe(true);
    });

    it('B 側の重複キーが余った場合は added になる', () => {
      const a = resultSet(['id'], [['1']]);
      const b = resultSet(['id'], [['1'], ['1']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 1, removed: 0, modified: 0, identical: 1 });
    });
  });

  describe('NULL の扱い', () => {
    it('NULL と空文字列を区別する', () => {
      const a = resultSet(['id', 'v'], [['1', null]]);
      const b = resultSet(['id', 'v'], [['1', '']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary.modified).toBe(1);
      expect(result.rows[0].changedCells).toEqual([false, true]);
    });

    it('両側 NULL のセルは一致扱いになる', () => {
      const a = resultSet(['id', 'v'], [['1', null]]);
      const b = resultSet(['id', 'v'], [['1', null]]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary.identical).toBe(1);
    });

    it('キーカラムの NULL と空文字列も別キーとして扱う', () => {
      const a = resultSet(['id', 'v'], [[null, 'x']]);
      const b = resultSet(['id', 'v'], [['', 'x']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 1, removed: 1, modified: 0, identical: 0 });
      expect(result.rows.find((r) => r.status === 'removed')?.keyDisplay).toBe('NULL');
    });
  });

  describe('カラム集合の差異', () => {
    it('共通カラムのみ比較し、片側のみのカラムを報告する', () => {
      const a = resultSet(['id', 'name', 'aOnly'], [['1', 'Alice', 'x']]);
      const b = resultSet(['id', 'name', 'bOnly'], [['1', 'Alice', 'y']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.columns).toEqual(['id', 'name']);
      expect(result.aOnlyColumns).toEqual(['aOnly']);
      expect(result.bOnlyColumns).toEqual(['bOnly']);
      expect(result.summary.identical).toBe(1);
      expect(result.warnings.some((w) => w.includes('A 側のみに存在するカラム'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('B 側のみに存在するカラム'))).toBe(true);
    });

    it('カラム順が違っても名前で対応付けて比較する', () => {
      const a = resultSet(['id', 'name'], [['1', 'Alice']]);
      const b = resultSet(['name', 'id'], [['Alice', '1']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary.identical).toBe(1);
    });

    it('共通カラムがない場合はエラーを投げる', () => {
      const a = resultSet(['x'], [['1']]);
      const b = resultSet(['y'], [['1']]);

      expect(() => diffResultSets(a, b)).toThrow(/共通カラムが存在しない/);
    });
  });

  describe('空入力', () => {
    it('両方空なら全カウント 0', () => {
      const a = resultSet(['id'], []);
      const b = resultSet(['id'], []);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 0, removed: 0, modified: 0, identical: 0 });
      expect(result.rows).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('A が空なら B の全行が added', () => {
      const a = resultSet(['id'], []);
      const b = resultSet(['id'], [['1'], ['2']]);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 2, removed: 0, modified: 0, identical: 0 });
    });

    it('B が空なら A の全行が removed', () => {
      const a = resultSet(['id'], [['1'], ['2']]);
      const b = resultSet(['id'], []);

      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      expect(result.summary).toEqual({ added: 0, removed: 2, modified: 0, identical: 0 });
    });
  });

  describe('順序非依存', () => {
    it('入力行の順序を入れ替えても分類結果は同じ', () => {
      const rowsA: (string | null)[][] = [
        ['1', 'same'],
        ['2', 'old'],
        ['3', 'gone'],
      ];
      const rowsB: (string | null)[][] = [
        ['4', 'fresh'],
        ['1', 'same'],
        ['2', 'new'],
      ];

      const forward = diffResultSets(resultSet(['id', 'v'], rowsA), resultSet(['id', 'v'], rowsB), {
        keyColumns: ['id'],
      });
      const shuffled = diffResultSets(
        resultSet(['id', 'v'], [...rowsA].reverse()),
        resultSet(['id', 'v'], [...rowsB].reverse()),
        { keyColumns: ['id'] }
      );

      expect(shuffled.summary).toEqual(forward.summary);
      const statusByKey = (rows: { keyDisplay: string; status: string }[]) =>
        new Map(rows.map((r) => [r.keyDisplay, r.status]));
      expect(statusByKey(shuffled.rows)).toEqual(statusByKey(forward.rows));
    });
  });

  describe('行数上限', () => {
    it('maxRows 超過分は打ち切り、truncated と警告を返す', () => {
      const manyRows = Array.from({ length: 10 }, (_, i): (string | null)[] => [String(i)]);
      const a = resultSet(['id'], manyRows);
      const b = resultSet(['id'], manyRows.slice(0, 3));

      const result = diffResultSets(a, b, { keyColumns: ['id'], maxRows: 5 });

      expect(result.truncated).toBe(true);
      // A は先頭 5 行のみ比較: 0-2 identical, 3-4 removed
      expect(result.summary).toEqual({ added: 0, removed: 2, modified: 0, identical: 3 });
      expect(result.warnings.some((w) => w.includes('先頭 5 行のみ比較'))).toBe(true);
    });
  });

  describe('diffResultSetsAsync', () => {
    it('チャンク処理でも同期版と同じ結果を返す', async () => {
      const size = 12_345;
      const rowsA = Array.from({ length: size }, (_, i): (string | null)[] => [String(i), `v${i}`]);
      const rowsB = rowsA.map((row): (string | null)[] => {
        const id = Number(row[0]);
        if (id % 100 === 0) return [row[0], 'changed'];
        return [...row];
      });
      // 末尾 10 行を削除し、新規 10 行を追加
      const b = resultSet(
        ['id', 'v'],
        [
          ...rowsB.slice(0, size - 10),
          ...Array.from({ length: 10 }, (_, i): (string | null)[] => [String(size + i), 'new']),
        ]
      );
      const a = resultSet(['id', 'v'], rowsA);

      const [syncResult, asyncResult] = [
        diffResultSets(a, b, { keyColumns: ['id'] }),
        await diffResultSetsAsync(a, b, { keyColumns: ['id'] }),
      ];

      expect(asyncResult.summary).toEqual(syncResult.summary);
      expect(asyncResult.summary.added).toBe(10);
      expect(asyncResult.summary.removed).toBe(10);
      expect(asyncResult.rows.length).toBe(syncResult.rows.length);
    });
  });

  describe('formatDiffSummary', () => {
    it('サマリと警告をテキスト整形する', () => {
      const a = resultSet(['id', 'x'], [['1', 'v']]);
      const b = resultSet(['id'], [['2']]);
      const result = diffResultSets(a, b, { keyColumns: ['id'] });

      const text = formatDiffSummary(result, { a: 'conn1 / dbo.T1', b: 'conn2 / dbo.T2' });

      expect(text).toContain('A: conn1 / dbo.T1');
      expect(text).toContain('B: conn2 / dbo.T2');
      expect(text).toContain('キーカラム: id');
      expect(text).toContain('追加: 1 行 / 削除: 1 行 / 変更: 0 行 / 一致: 0 行');
      expect(text).toContain('警告:');
    });
  });
});
