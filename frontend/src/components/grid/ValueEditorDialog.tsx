import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './ValueEditorDialog.module.css';

// JSON解析結果の型
type JsonParseResult = { success: true; data: unknown } | { success: false };

// JSON文字列を安全にパース
function tryParseJson(text: string): JsonParseResult {
  try {
    return { success: true, data: JSON.parse(text) };
  } catch {
    return { success: false };
  }
}

interface ValueEditorDialogProps {
  isOpen: boolean;
  columnName: string;
  initialValue: string | null;
  onSave: (value: string | null) => void;
  onCancel: () => void;
}

export function ValueEditorDialog({
  isOpen,
  columnName,
  initialValue,
  onSave,
  onCancel,
}: ValueEditorDialogProps) {
  const [value, setValue] = useState(initialValue ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue ?? '');
      setTimeout(() => {
        textareaRef.current?.focus();
        textareaRef.current?.select();
      }, 0);
    }
  }, [isOpen, initialValue]);

  const handleSave = useCallback(() => {
    onSave(value === '' ? null : value);
  }, [value, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
    },
    [onCancel, handleSave]
  );

  const handleSetNull = useCallback(() => {
    onSave(null);
  }, [onSave]);

  // JSONパース結果をメモ化（valueが変わらない限り再計算しない）
  const jsonParseResult = useMemo(() => tryParseJson(value), [value]);
  const isValidJson = jsonParseResult.success;

  const formatAsJson = useCallback(() => {
    if (jsonParseResult.success) {
      setValue(JSON.stringify(jsonParseResult.data, null, 2));
    }
  }, [jsonParseResult]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>{columnName}</h2>
          <button type="button" className={styles.closeButton} onClick={onCancel}>
            &times;
          </button>
        </div>
        <div className={styles.content}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="値を入力..."
            spellCheck={false}
          />
          <div className={styles.info}>
            <span>{value.length} 文字</span>
            {isValidJson && <span className={styles.jsonBadge}>JSON</span>}
          </div>
        </div>
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <button type="button" className={styles.button} onClick={handleSetNull}>
              NULL
            </button>
            {isValidJson && (
              <button type="button" className={styles.button} onClick={formatAsJson}>
                JSON整形
              </button>
            )}
          </div>
          <div className={styles.footerRight}>
            <button type="button" className={styles.button} onClick={onCancel}>
              キャンセル
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary}`}
              onClick={handleSave}
            >
              保存 (Ctrl+Enter)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
