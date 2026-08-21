import { describe, expect, it } from 'vite-plus/test';
import type { DatabaseObject } from '../../types';
import { flattenVisibleTree } from '../../utils/flattenVisibleTree';

const node = (
  id: string,
  type: DatabaseObject['type'],
  children?: DatabaseObject[]
): DatabaseObject => ({ id, name: id, type, children });

const TREE: DatabaseObject[] = [
  node('db1', 'database', [
    node('db1-tables', 'folder', [
      node('t1', 'table', [node('t1-c1', 'column'), node('t1-c2', 'column')]),
      node('t2', 'table', []),
    ]),
    node('db1-views', 'folder', [node('v1', 'view', [])]),
  ]),
];

describe('flattenVisibleTree', () => {
  it('何も展開されていなければルートノードのみを level 0 で返す', () => {
    const rows = flattenVisibleTree(TREE, new Set());
    expect(rows.map((r) => r.node.id)).toEqual(['db1']);
    expect(rows[0].level).toBe(0);
  });

  it('展開されたノードの子を DFS 順で挿入し level を +1 する', () => {
    const rows = flattenVisibleTree(TREE, new Set(['db1', 'db1-tables']));
    expect(rows.map((r) => r.node.id)).toEqual(['db1', 'db1-tables', 't1', 't2', 'db1-views']);
    expect(rows.map((r) => r.level)).toEqual([0, 1, 2, 2, 1]);
  });

  it('折りたたまれた祖先の配下は子孫が展開集合に含まれていても現れない', () => {
    // db1 は折りたたみ状態 → db1-tables/t1 が展開扱いでも行は増えない
    const rows = flattenVisibleTree(TREE, new Set(['db1-tables', 't1']));
    expect(rows.map((r) => r.node.id)).toEqual(['db1']);
  });

  it('children が空のノードは展開中でも子行を持たない (未ロードテーブル)', () => {
    const rows = flattenVisibleTree(TREE, new Set(['db1', 'db1-tables', 't2']));
    expect(rows.map((r) => r.node.id)).toEqual(['db1', 'db1-tables', 't1', 't2', 'db1-views']);
  });

  it('全展開時は全ノードを DFS 順で返し level が深さと一致する', () => {
    const rows = flattenVisibleTree(TREE, new Set(['db1', 'db1-tables', 'db1-views', 't1', 'v1']));
    expect(rows.map((r) => r.node.id)).toEqual([
      'db1',
      'db1-tables',
      't1',
      't1-c1',
      't1-c2',
      't2',
      'db1-views',
      'v1',
    ]);
    expect(rows.map((r) => r.level)).toEqual([0, 1, 2, 3, 3, 2, 1, 2]);
  });

  it('空ツリーは空配列を返す', () => {
    expect(flattenVisibleTree([], new Set(['x']))).toEqual([]);
  });

  it('複数ルート (複数 DB ノード) を順序どおり並べる', () => {
    const forest = [node('a', 'database', [node('a-1', 'folder')]), node('b', 'database')];
    const rows = flattenVisibleTree(forest, new Set(['a']));
    expect(rows.map((r) => r.node.id)).toEqual(['a', 'a-1', 'b']);
  });
});
