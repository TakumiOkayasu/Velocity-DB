import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { parseErrorMessage } from '../../utils/errorParser';
import { DialogOverlay } from '../common/DialogOverlay';
import styles from './ErrorDetailDialog.module.css';

interface ErrorDetailDialogProps {
  isOpen: boolean;
  errorMessage: string;
  onClose: () => void;
  title?: string;
}

export function ErrorDetailDialog({ isOpen, errorMessage, onClose, title = 'クエリエラー' }: ErrorDetailDialogProps) {
  const titleId = useId();
  const detailRef = useRef<HTMLPreElement>(null);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (isOpen) detailRef.current?.focus();
  }, [isOpen]);
  useDialogKeyboard({ isOpen, onEscape: onClose });

  const copyToClipboard = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(errorMessage);
      setCopyStatus('コピーしました');
    } catch {
      setCopyStatus('コピーできませんでした。詳細を選択してCtrl+Cでコピーしてください。');
    }
  }, [errorMessage]);

  if (!isOpen) return null;

  const parsed = parseErrorMessage(errorMessage);

  return (
    <DialogOverlay
      onClose={onClose}
      ariaLabelledBy={titleId}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
    >
      <div onCopy={(event) => {
        if (window.getSelection()?.toString()) return;
        event.clipboardData.setData('text/plain', errorMessage);
        event.preventDefault();
      }}>
      <div className={styles.header}>
        <span className={styles.icon}>!</span>
        <h3 id={titleId}>{title}</h3>
      </div>
      <div className={styles.content}>
        <p className={styles.summary}>{parsed.summary}</p>
        <pre ref={detailRef} tabIndex={0} aria-label="エラー詳細 (Ctrl+Cで全文コピー)" className={styles.detail}>{parsed.detail}</pre>
      </div>
      <p role="status">{copyStatus}</p>
      <div className={styles.footer}>
        <button type="button" className={styles.copyButton} onClick={copyToClipboard}>
          コピー
        </button>
        <button type="button" className={styles.closeButton} onClick={onClose}>
          閉じる
        </button>
      </div>
      </div>
    </DialogOverlay>
  );
}
