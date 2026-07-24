/** 仮想化リストの描画対象インデックス範囲 (end は exclusive) */
export interface WindowRange {
  start: number;
  end: number;
}

/**
 * スクロール位置から描画すべき行インデックス範囲を計算する純関数 (#502)。
 *
 * @param scrollTop リスト先頭からのスクロールオフセット (px)。負値 (オーバースクロール) は 0 扱い
 * @param viewportHeight 可視領域の高さ (px)。0 以下でも最低 1 行は描画する
 * @param rowHeight 1 行の高さ (px)。0 以下は不正入力として空範囲を返す
 * @param totalCount 全行数
 * @param overscan 可視範囲の前後に余分に描画する行数
 */
export function computeWindowRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalCount: number,
  overscan: number
): WindowRange {
  if (totalCount <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0 };
  }

  const safeScrollTop = Math.max(0, scrollTop);
  const safeOverscan = Math.max(0, overscan);
  const firstVisible = Math.min(Math.floor(safeScrollTop / rowHeight), totalCount - 1);
  // +1: 行境界をまたいで部分表示される行の分
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1);

  const start = Math.max(0, firstVisible - safeOverscan);
  const end = Math.min(totalCount, firstVisible + visibleCount + safeOverscan);
  return { start, end };
}
