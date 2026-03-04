import { useCallback, useRef, useState } from 'react';
import { bridge, toERDiagramModel } from '../../api/bridge';
import type { ERDiagramModel } from '../../utils/erDiagramParser';
import styles from './ERImportDialog.module.css';

interface ERImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (model: ERDiagramModel) => void;
}

export function ERImportDialog({ isOpen, onClose, onImport }: ERImportDialogProps) {
  const [fileName, setFileName] = useState<string>('');
  const [parsedModel, setParsedModel] = useState<ERDiagramModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedDDL, setGeneratedDDL] = useState<string>('');
  const [showDDL, setShowDDL] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);

    try {
      const content = await file.text();
      const result = await bridge.parseERDiagram({
        content,
        filename: file.name,
      });
      setParsedModel(toERDiagramModel(result, file.name));
      setGeneratedDDL(result.ddl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    }
  }, []);

  const handleImport = useCallback(() => {
    if (parsedModel) {
      onImport(parsedModel);
    }
    onClose();
  }, [parsedModel, onImport, onClose]);

  const handleCopyDDL = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(generatedDDL);
    } catch {
      // Clipboard API may fail in non-secure contexts; silently ignore
    }
  }, [generatedDDL]);

  if (!isOpen) return null;

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="er-import-dialog-title"
      >
        <div className={styles.header}>
          <h2 id="er-import-dialog-title">ER図ファイルをインポート</h2>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            {'\u2715'}
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.fileSection}>
            <span className={styles.fileLabel}>ER図ファイルを選択</span>
            <div className={styles.fileRow}>
              <button
                type="button"
                className={styles.fileBrowseButton}
                onClick={() => fileInputRef.current?.click()}
              >
                ファイルを選択
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".a5er,.xml"
                onChange={handleFileSelect}
                className={styles.fileHidden}
              />
              {fileName && <span className={styles.fileName}>{fileName}</span>}
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {parsedModel && parsedModel.tables.length > 0 && (
            <div className={styles.summary}>
              <h3>解析結果</h3>
              <p>
                {parsedModel.tables.length} テーブル, {parsedModel.relations.length} リレーション
              </p>

              <div className={styles.tableList}>
                {parsedModel.tables.map((table) => (
                  <div key={table.name} className={styles.tableItem}>
                    <span className={styles.tableName}>
                      {table.logicalName ? `${table.name} (${table.logicalName})` : table.name}
                    </span>
                    <span className={styles.columnCount}>{table.columns.length} カラム</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsedModel && (
            <div className={styles.ddlSection}>
              <div className={styles.ddlHeader}>
                <h3>生成されたDDL</h3>
                <button type="button" onClick={() => setShowDDL(!showDDL)}>
                  {showDDL ? '非表示' : '表示'}
                </button>
                {generatedDDL && (
                  <button type="button" onClick={handleCopyDDL}>
                    コピー
                  </button>
                )}
              </div>
              {showDDL && generatedDDL && <pre className={styles.ddlContent}>{generatedDDL}</pre>}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.cancelButton} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!parsedModel || parsedModel.tables.length === 0}
            className={styles.importButton}
          >
            ER図にインポート
          </button>
        </div>
      </div>
    </div>
  );
}
