import { useEffect, useRef } from 'react';

/**
 * 初回マウント時のレンダリング時間を Performance API に記録する。
 * DevTools Performance タブで `target` の measure entry として観察できる。
 */
export function useFirstRenderMark(target: string): void {
  const startMarked = useRef(false);
  const measured = useRef(false);

  if (!startMarked.current) {
    performance.mark(`${target}:start`);
    startMarked.current = true;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: initial mount only
  useEffect(() => {
    if (measured.current) return;
    measured.current = true;

    const hasStart = performance.getEntriesByName(`${target}:start`, 'mark').length > 0;
    if (!hasStart) return;

    performance.mark(`${target}:end`);
    performance.measure(target, `${target}:start`, `${target}:end`);
  }, []);
}

/**
 * アプリ起動時刻 (App ルート初回マウント) を `startup` measure として記録する。
 * README #1 (起動 < 0.3s) ベースライン計測用。
 */
export function useStartupMark(): void {
  useFirstRenderMark('startup');
}

const TREE_EXPAND_MEASURE = 'tree-expand';

let treeExpandPending = false;

/**
 * スキーマツリーの展開操作の開始時刻を記録する (#502)。
 * ConnectionTreeSection.toggleNode の展開分岐から呼ぶ。
 */
export function markTreeExpandStart(): void {
  treeExpandPending = true;
  performance.mark(`${TREE_EXPAND_MEASURE}:start`);
}

/**
 * 展開操作で可視行数が変化した commit の直後に `tree-expand` measure を記録する (#502)。
 * visibleRowCount には flattenVisibleTree の結果行数を渡す。行数が変化しない再レンダリング
 * (選択変更など) では effect が発火しないため、直前の markTreeExpandStart とだけ対になる。
 * 展開のたびに measure entry が追加されるので、計測側は entry の index で識別する。
 */
export function useTreeExpandMeasure(visibleRowCount: number): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: visibleRowCount の変化自体を commit 検知トリガーとして使う (effect 本体では参照しない)
  useEffect(() => {
    if (!treeExpandPending) return;
    treeExpandPending = false;

    const hasStart =
      performance.getEntriesByName(`${TREE_EXPAND_MEASURE}:start`, 'mark').length > 0;
    if (!hasStart) return;

    performance.mark(`${TREE_EXPAND_MEASURE}:end`);
    performance.measure(
      TREE_EXPAND_MEASURE,
      `${TREE_EXPAND_MEASURE}:start`,
      `${TREE_EXPAND_MEASURE}:end`
    );
    performance.clearMarks(`${TREE_EXPAND_MEASURE}:start`);
    performance.clearMarks(`${TREE_EXPAND_MEASURE}:end`);
  }, [visibleRowCount]);
}

/**
 * ER 図のテーブル数が閾値を満たした最初のレンダリングを measure として記録する。
 * 閾値未達のレンダリングでは mark を打たず、達成した時点で start、その直後の effect で end と measure を記録する。
 * README #9 (ER 図 50 テーブル < 500ms) ベースライン計測用。
 */
export function useERDiagramRenderMark(tableCount: number, threshold = 50): void {
  const target = `er-diagram-${threshold}`;
  const startMarked = useRef(false);
  const measured = useRef(false);

  if (!startMarked.current && tableCount >= threshold) {
    performance.mark(`${target}:start`);
    startMarked.current = true;
  }

  // Fire after every commit; the `measured` ref gates the body so end+measure run at most
  // once. The threshold logic lives in the render-phase block above (which reads
  // tableCount), so this effect intentionally has no deps — biome would flag [tableCount]
  // as unused here.
  useEffect(() => {
    if (measured.current || !startMarked.current) return;

    const hasStart = performance.getEntriesByName(`${target}:start`, 'mark').length > 0;
    if (!hasStart) return;

    measured.current = true;
    performance.mark(`${target}:end`);
    performance.measure(target, `${target}:start`, `${target}:end`);
  });
}
