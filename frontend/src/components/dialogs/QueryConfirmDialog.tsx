import styles from './QueryConfirmDialog.module.css';

interface QueryConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function QueryConfirmDialog({
  isOpen,
  title,
  message,
  details,
  confirmLabel = 'Execute',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}: QueryConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={`${styles.icon} ${isDestructive ? styles.warning : ''}`}>
            {isDestructive ? '!' : '?'}
          </span>
          <h3>{title}</h3>
        </div>
        <div className={styles.content}>
          <p className={styles.message}>{message}</p>
          {details && <pre className={styles.details}>{details}</pre>}
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`${styles.confirmButton} ${isDestructive ? styles.destructive : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
