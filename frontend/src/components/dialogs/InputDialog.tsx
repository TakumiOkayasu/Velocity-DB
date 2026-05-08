import { useCallback, useEffect, useRef, useState } from 'react';
import { DialogOverlay } from '../common/DialogOverlay';
import styles from './InputDialog.module.css';

interface InputDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  validate?: (value: string) => string | null;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function InputDialog({
  isOpen,
  title,
  message,
  defaultValue = '',
  placeholder,
  confirmLabel = 'OK',
  cancelLabel = 'キャンセル',
  validate,
  onConfirm,
  onCancel,
}: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(defaultValue);
      setError(null);
      // Focus and select on open
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [isOpen, defaultValue]);

  const tryConfirm = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (validate) {
      const msg = validate(trimmed);
      if (msg) {
        setError(msg);
        return;
      }
    }
    onConfirm(trimmed);
  }, [value, validate, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        tryConfirm();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [tryConfirm, onCancel]
  );

  if (!isOpen) return null;

  return (
    <DialogOverlay
      onClose={onCancel}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
    >
      <div className={styles.header}>
        <span className={styles.icon}>?</span>
        <h3>{title}</h3>
      </div>
      <div className={styles.content}>
        <p className={styles.message}>{message}</p>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
        />
        {error && <p className={styles.error}>{error}</p>}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          onClick={tryConfirm}
          disabled={!value.trim()}
        >
          {confirmLabel}
        </button>
      </div>
    </DialogOverlay>
  );
}
