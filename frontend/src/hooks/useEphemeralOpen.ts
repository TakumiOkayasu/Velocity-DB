import { useCallback, useState } from 'react';

interface UseEphemeralOpenResult {
  /** ダイアログが開くべきか: trigger 到来後、未 dismiss なら true */
  isOpen: boolean;
  /** ユーザー操作でダイアログを閉じる (同じ trigger では再度開かない) */
  dismiss: () => void;
  /** 現在の trigger に対して再度開く (ボタンから再表示等) */
  reopen: () => void;
}

/**
 * Trigger 値が変化する度に自動で open し、ユーザー dismiss できるダイアログ制御。
 *
 * - trigger が null/undefined/false → isOpen=false
 * - trigger が truthy に変化 → isOpen=true (dismiss 状態リセット)
 * - 同じ trigger 内で dismiss() → isOpen=false
 * - 同じ trigger 内で reopen() → isOpen=true
 *
 * React 公式推奨の expressed-state パターン (useEffect 不使用) で実装。
 * @see https://react.dev/learn/you-might-not-need-an-effect
 */
export function useEphemeralOpen<T>(trigger: T): UseEphemeralOpenResult {
  const [prevTrigger, setPrevTrigger] = useState<T>(trigger);
  const [isDismissed, setIsDismissed] = useState(false);

  if (trigger !== prevTrigger) {
    setPrevTrigger(trigger);
    setIsDismissed(false);
  }

  const dismiss = useCallback(() => setIsDismissed(true), []);
  const reopen = useCallback(() => setIsDismissed(false), []);

  return {
    isOpen: !!trigger && !isDismissed,
    dismiss,
    reopen,
  };
}
