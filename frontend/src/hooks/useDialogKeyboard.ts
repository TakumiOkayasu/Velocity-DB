import { useCallback, useEffect } from 'react';

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
 */
export function useDialogKeyboard({ isOpen, onEscape, onSubmit }: UseDialogKeyboardOptions): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape' && onEscape) {
        e.preventDefault();
        onEscape();
      } else if (e.ctrlKey && e.key === 'Enter' && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    },
    [isOpen, onEscape, onSubmit]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
