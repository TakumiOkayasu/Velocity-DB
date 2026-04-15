import { useEffect, useState } from 'react';

/// 結果タブ件数が変動した際に、範囲外になった activeIndex を 0 に戻すフック。
export function useClampedActiveIndex(length: number): [number, (index: number) => void] {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex((prev) => (prev >= length ? 0 : prev));
  }, [length]);

  return [activeIndex, setActiveIndex];
}
