import { useEffect, useLayoutEffect, useRef } from 'react';

interface UseDialogKeyboardOptions {
  /** ダイアログが開いているかどうか */
  isOpen: boolean;
  /** Escapeキー押下時のコールバック */
  onEscape?: () => void;
  /** Ctrl+Enter押下時のコールバック */
  onSubmit?: () => void;
}

/**
 * ダイアログ共通のキーボードショートカットを処理するhook
 * - Escape: ダイアログを閉じる
 * - Ctrl+Enter: 送信/保存
 *
 * listener は mount 時に 1 回だけ登録し、最新 callback は ref 経由で反映する。
 * props 変化で add/removeEventListener が走らないため、イベント登録コストを削減。
 */
export function useDialogKeyboard({ isOpen, onEscape, onSubmit }: UseDialogKeyboardOptions): void {
  const optsRef = useRef<UseDialogKeyboardOptions>({ isOpen, onEscape, onSubmit });
  // Intentionally no deps: sync ref on every render. useKeyboardHandler と同じ API 形
  useEffect(() => {
    optsRef.current = { isOpen, onEscape, onSubmit };
  });

  useLayoutEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const { isOpen: open, onEscape: esc, onSubmit: submit } = optsRef.current;
      if (!open) return;
      if (e.key === 'Escape' && esc) {
        e.preventDefault();
        esc();
      } else if (e.ctrlKey && e.key === 'Enter' && submit) {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
