import type { ICellEditorParams } from 'ag-grid-community';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './CellEditor.module.css';

interface CellEditorProps extends ICellEditorParams {
  onValueChange?: (value: string | null) => void;
}

export function CellEditor(props: CellEditorProps) {
  const { value, onValueChange } = props;
  const [currentValue, setCurrentValue] = useState<string>(value ?? '');
  const [isNull, setIsNull] = useState<boolean>(value === null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCurrentValue(e.target.value);
      setIsNull(false);
      onValueChange?.(e.target.value);
    },
    [onValueChange]
  );

  const handleSetNull = useCallback(() => {
    setIsNull(true);
    setCurrentValue('');
    onValueChange?.(null);
  }, [onValueChange]);

  const handleClearNull = useCallback(() => {
    setIsNull(false);
    inputRef.current?.focus();
  }, []);

  const getValue = useCallback(() => {
    return isNull ? null : currentValue;
  }, [isNull, currentValue]);

  const isCancelBeforeStart = useCallback(() => {
    return false;
  }, []);

  const isCancelAfterEnd = useCallback(() => {
    return false;
  }, []);

  // Expose methods for AG Grid
  useEffect(() => {
    const api = {
      getValue,
      isCancelBeforeStart,
      isCancelAfterEnd,
    };
    Object.assign(props, api);
  }, [props, getValue, isCancelBeforeStart, isCancelAfterEnd]);

  return (
    <div className={styles.container}>
      <div className={styles.inputWrapper}>
        <textarea
          ref={inputRef}
          value={isNull ? '' : currentValue}
          onChange={handleChange}
          className={`${styles.input} ${isNull ? styles.nullInput : ''}`}
          disabled={isNull}
          placeholder={isNull ? 'NULL' : ''}
          rows={1}
        />
      </div>
      <div className={styles.actions}>
        {isNull ? (
          <button
            type="button"
            className={styles.actionButton}
            onClick={handleClearNull}
            title="Clear NULL"
          >
            Clear NULL
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.actionButton} ${styles.nullButton}`}
            onClick={handleSetNull}
            title="Set to NULL"
          >
            Set NULL
          </button>
        )}
      </div>
    </div>
  );
}
