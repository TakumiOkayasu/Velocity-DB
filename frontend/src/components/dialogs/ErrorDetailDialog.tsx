import { useCallback } from 'react';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { parseErrorMessage } from '../../utils/errorParser';
import styles from './ErrorDetailDialog.module.css';

interface ErrorDetailDialogProps {
  isOpen: boolean;
  errorMessage: string;
  onClose: () => void;
}

export function ErrorDetailDialog({ isOpen, errorMessage, onClose }: ErrorDetailDialogProps) {
  useDialogKeyboard({ isOpen, onEscape: onClose });

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(errorMessage);
    } catch {
      // non-secure context fallback: silently ignore
    }
  }, [errorMessage]);

  if (!isOpen) return null;

  const parsed = parseErrorMessage(errorMessage);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.icon}>!</span>
          <h3>クエリエラー</h3>
        </div>
        <div className={styles.content}>
          <p className={styles.summary}>{parsed.summary}</p>
          <pre className={styles.detail}>{parsed.detail}</pre>
        </div>
        <div className={styles.footer}>
          <button className={styles.copyButton} onClick={copyToClipboard}>
            コピー
          </button>
          <button className={styles.closeButton} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
