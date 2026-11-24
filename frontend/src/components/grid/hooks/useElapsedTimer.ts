import { useEffect, useState } from 'react';

/**
 * アクティブ期間の経過秒数を返すタイマーフック。
 * @param active true の間 1秒ごとにカウントアップし、false でリセット。
 */
export function useElapsedTimer(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    setSeconds(0);
  }

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  return active ? seconds : 0;
}
