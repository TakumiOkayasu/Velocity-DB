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
