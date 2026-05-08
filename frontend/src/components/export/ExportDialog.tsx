import { useCallback, useEffect, useState } from 'react';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { useConnectionStore } from '../../store/connectionStore';
import type { ResultSet } from '../../types';
import { DialogOverlay } from '../common/DialogOverlay';
import styles from './ExportDialog.module.css';
import { type ExportFormat, type ExportOptions, getExporter, isExportFormat } from './exporters';

function isInputFocused(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  resultSet: ResultSet | null;
}

export function ExportDialog({ isOpen, onClose, resultSet }: ExportDialogProps) {
  useDialogKeyboard({ isOpen, onEscape: onClose });
  // W8: .find() returns existing array reference — stable with Zustand's Object.is equality
  const activeConnection = useConnectionStore((s) => {
    const id = s.activeConnectionId;
    return id ? s.connections.find((c) => c.id === id) : undefined;
  });
  const [options, setOptions] = useState<ExportOptions>({
    format: 'csv',
    includeHeaders: true,
    delimiter: ',',
    nullValue: 'NULL',
    tableName: 'table_name',
  });
  const [copied, setCopied] = useState(false);

  const generateExport = useCallback((): string => {
    if (!resultSet) return '';
    return getExporter(options.format).generate(resultSet, {
      ...options,
      dbType: activeConnection?.dbType,
    });
  }, [resultSet, options, activeConnection?.dbType]);

  const handleCopy = useCallback(async () => {
    const text = generateExport();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generateExport]);

  const handleDownload = useCallback(() => {
    const text = generateExport();
    const extensions: Record<ExportFormat, string> = {
      csv: 'csv',
      json: 'json',
      sql: 'sql',
      html: 'html',
      markdown: 'md',
    };
    const mimeTypes: Record<ExportFormat, string> = {
      csv: 'text/csv',
      json: 'application/json',
      sql: 'text/plain',
      html: 'text/html',
      markdown: 'text/markdown',
    };
    const blob = new Blob([text], { type: mimeTypes[options.format] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export.${extensions[options.format]}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generateExport, options.format]);

  // Keyboard: Ctrl+C=copy
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !isInputFocused()) {
        e.preventDefault();
        handleCopy();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleCopy]);

  if (!isOpen) return null;

  return (
    <DialogOverlay
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
    >
      <div className={styles.header}>
        <h2>データエクスポート</h2>
        <button type="button" className={styles.closeButton} onClick={onClose}>
          {'✕'}
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.field}>
          <label htmlFor="export-format">形式</label>
          <select
            id="export-format"
            value={options.format}
            onChange={(e) => {
              if (!isExportFormat(e.target.value)) return;
              setOptions({ ...options, format: e.target.value });
            }}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
            <option value="sql">SQL INSERT</option>
            <option value="html">HTMLテーブル</option>
            <option value="markdown">Markdown</option>
          </select>
        </div>

        {options.format === 'csv' && (
          <div className={styles.field}>
            <label htmlFor="export-delimiter">区切り文字</label>
            <select
              id="export-delimiter"
              value={options.delimiter}
              onChange={(e) => setOptions({ ...options, delimiter: e.target.value })}
            >
              <option value=",">カンマ (,)</option>
              <option value="	">タブ</option>
              <option value=";">セミコロン (;)</option>
              <option value="|">パイプ (|)</option>
            </select>
          </div>
        )}

        {(options.format === 'csv' ||
          options.format === 'html' ||
          options.format === 'markdown') && (
          <div className={styles.field}>
            <label>
              <input
                type="checkbox"
                checked={options.includeHeaders}
                onChange={(e) => setOptions({ ...options, includeHeaders: e.target.checked })}
              />
              ヘッダーを含める
            </label>
          </div>
        )}

        {options.format === 'sql' && (
          <div className={styles.field}>
            <label htmlFor="export-table-name">テーブル名</label>
            <input
              id="export-table-name"
              type="text"
              value={options.tableName}
              onChange={(e) => setOptions({ ...options, tableName: e.target.value })}
            />
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor="export-null-value">NULL値の表示</label>
          <input
            id="export-null-value"
            type="text"
            value={options.nullValue}
            onChange={(e) => setOptions({ ...options, nullValue: e.target.value })}
          />
        </div>

        <div className={styles.preview}>
          <span className={styles.previewLabel}>プレビュー</span>
          <pre>
            {(() => {
              const text = generateExport();
              return text.length > 1000 ? `${text.slice(0, 1000)}...` : text;
            })()}
          </pre>
        </div>
      </div>

      <div className={styles.footer}>
        <span className={styles.rowCount}>
          {resultSet ? `${resultSet.rows.length} 件` : 'データなし'}
        </span>
        <div className={styles.actions}>
          <button type="button" onClick={handleCopy} className={styles.copyButton} title="Ctrl+C">
            {copied ? 'コピーしました' : 'クリップボードにコピー'}
          </button>
          <button type="button" onClick={handleDownload} className={styles.downloadButton}>
            ダウンロード
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
