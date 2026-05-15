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
