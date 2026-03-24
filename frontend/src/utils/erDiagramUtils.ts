import type { ERTableNode } from '../types';
import { DEFAULT_PAGE } from './erDiagramConstants';

/** テーブル一覧からユニークなページ名を抽出 */
export function extractPages(tables: { data: { page?: string } }[]): string[] {
  const pageSet = new Set<string>();
  for (const t of tables) {
    pageSet.add(t.data.page || DEFAULT_PAGE);
  }
  return Array.from(pageSet);
}

/** 物理名・論理名で部分一致フィルタ */
export function filterTablesByQuery(tables: ERTableNode[], query: string): ERTableNode[] {
  const lower = query.toLowerCase();
  return tables.filter(
    (t) =>
      t.data.tableName.toLowerCase().includes(lower) ||
      t.data.logicalName?.toLowerCase().includes(lower)
  );
}
