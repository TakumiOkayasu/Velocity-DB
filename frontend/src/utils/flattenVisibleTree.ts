import type { DatabaseObject } from '../types';

/** スキーマツリーの可視 1 行分 (ノード + インデントレベル) */
export interface FlattenedTreeRow {
  node: DatabaseObject;
  level: number;
}

/**
 * 展開中のノードだけを深さ優先で辿り、可視ノードをフラットな行リストに変換する (#502)。
 *
 * TreeNode の再帰レンダリングと同じ規則に従う:
 * 子行が現れるのは「children が 1 件以上あり、かつ展開中」のノードのみ。
 * 未ロード (children が空) のテーブルは展開中でも子行を持たない。
 * 折りたたまれたノードの配下は、子孫が expandedIds に含まれていても現れない。
 */
export function flattenVisibleTree(
  nodes: DatabaseObject[],
  expandedIds: ReadonlySet<string>
): FlattenedTreeRow[] {
  const rows: FlattenedTreeRow[] = [];

  const visit = (list: DatabaseObject[], level: number): void => {
    for (const node of list) {
      rows.push({ node, level });
      if (node.children && node.children.length > 0 && expandedIds.has(node.id)) {
        visit(node.children, level + 1);
      }
    }
  };

  visit(nodes, 0);
  return rows;
}
