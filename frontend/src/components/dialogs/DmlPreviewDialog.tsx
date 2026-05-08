import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { DialogOverlay } from '../common/DialogOverlay';
import styles from './DmlPreviewDialog.module.css';

interface DmlPreviewDialogProps {
  isOpen: boolean;
  statements: string[];
  isExecuting: boolean;
  onExecute: () => void;
  onCancel: () => void;
}

export function DmlPreviewDialog({
  isOpen,
  statements,
  isExecuting,
  onExecute,
  onCancel,
}: DmlPreviewDialogProps) {
  useDialogKeyboard({ isOpen, onEscape: isExecuting ? undefined : onCancel });

  if (!isOpen) return null;

  return (
    <DialogOverlay
      onClose={onCancel}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
      disableOverlayClose={isExecuting}
    >
      <div className={styles.header}>
        <span className={styles.icon}>!</span>
        <h3>変更プレビュー</h3>
      </div>
      <div className={styles.content}>
        <p className={styles.summary}>{statements.length}件のSQL文を実行します</p>
        <pre className={styles.sqlBlock}>{statements.join('\n\n')}</pre>
      </div>
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onCancel}
          disabled={isExecuting}
        >
          キャンセル
        </button>
        <button
          type="button"
          className={styles.executeButton}
          onClick={onExecute}
          disabled={isExecuting}
        >
          {isExecuting ? '実行中...' : '実行'}
        </button>
      </div>
    </DialogOverlay>
  );
}
