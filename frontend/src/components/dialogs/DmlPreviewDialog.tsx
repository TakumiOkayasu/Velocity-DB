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
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={isExecuting ? undefined : onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.icon}>!</span>
          <h3>変更プレビュー</h3>
        </div>
        <div className={styles.content}>
          <p className={styles.summary}>{statements.length}件のSQL文を実行します</p>
          <pre className={styles.sqlBlock}>{statements.join('\n\n')}</pre>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onCancel} disabled={isExecuting}>
            キャンセル
          </button>
          <button className={styles.executeButton} onClick={onExecute} disabled={isExecuting}>
            {isExecuting ? '実行中...' : '実行'}
          </button>
        </div>
      </div>
    </div>
  );
}
