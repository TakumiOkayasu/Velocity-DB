import { useCallback, useMemo, useState } from 'react';
import { queryProvider } from '../../api/providers';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { useConnections } from '../../store/connectionStore';
import type { Connection } from '../../types';
import {
  type DataDiffResult,
  type DiffResultSet,
  type DiffRow,
  diffResultSetsAsync,
  formatDiffSummary,
} from '../../utils/dataDiff';
import { buildSelectSql } from '../../utils/sqlIdentifier';
import { DialogOverlay } from '../common/DialogOverlay';
import styles from './DataCompareDialog.module.css';

interface DataCompareDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type SourceMode = 'table' | 'sql';

interface SourceState {
  connectionId: string;
  mode: SourceMode;
  table: string;
  sql: string;
}

const EMPTY_SOURCE: SourceState = { connectionId: '', mode: 'table', table: '', sql: '' };

/** 差分グリッドに表示する最大行数 (DOM 肥大化防止) */
const DISPLAY_ROW_LIMIT = 500;

function findConnection(connections: Connection[], id: string): Connection | undefined {
  return connections.find((c) => c.id === id);
}

async function fetchSource(source: SourceState, connection: Connection): Promise<DiffResultSet> {
  const sql =
    source.mode === 'table'
      ? buildSelectSql(source.table.trim(), connection.dbType)
      : source.sql.trim();
  const result = await queryProvider.executeQuery(source.connectionId, sql, false);
  if ('multipleResults' in result) {
    const first = result.results[0];
    if (first === undefined) {
      throw new Error('クエリが結果セットを返しませんでした');
    }
    return { columns: first.data.columns, rows: first.data.rows };
  }
  return { columns: result.columns, rows: result.rows };
}

function validateSource(source: SourceState, label: string): string | null {
  if (!source.connectionId) return `${label}: 接続を選択してください`;
  if (source.mode === 'table' && source.table.trim() === '') {
    return `${label}: テーブル名を入力してください`;
  }
  if (source.mode === 'sql' && source.sql.trim() === '') {
    return `${label}: SQLを入力してください`;
  }
  return null;
}

function sourceLabel(source: SourceState, connection: Connection | undefined): string {
  const target = source.mode === 'table' ? source.table.trim() : 'カスタムSQL';
  return `${connection?.name ?? '不明な接続'} / ${target}`;
}

function renderCellValue(value: string | null) {
  if (value === null) return <span className={styles.nullValue}>NULL</span>;
  return value;
}

const STATUS_LABELS: Record<DiffRow['status'], string> = {
  added: '追加',
  removed: '削除',
  modified: '変更',
  identical: '一致',
};

const STATUS_CLASSES: Record<DiffRow['status'], string> = {
  added: styles.statusAdded,
  removed: styles.statusRemoved,
  modified: styles.statusModified,
  identical: styles.statusIdentical,
};

const ROW_CLASSES: Partial<Record<DiffRow['status'], string>> = {
  added: styles.rowAdded,
  removed: styles.rowRemoved,
  modified: styles.rowModified,
};

interface SourceEditorProps {
  label: 'A' | 'B';
  source: SourceState;
  connections: Connection[];
  disabled: boolean;
  onChange: (patch: Partial<SourceState>) => void;
}

function SourceEditor({ label, source, connections, disabled, onChange }: SourceEditorProps) {
  const connectionSelectId = `compare-conn-${label}`;
  const tableInputId = `compare-table-${label}`;
  const sqlInputId = `compare-sql-${label}`;
  return (
    <div className={styles.sourcePanel}>
      <span className={styles.sourceTitle}>ソース {label}</span>
      <label className={styles.label} htmlFor={connectionSelectId}>
        接続 ({label})
      </label>
      <select
        id={connectionSelectId}
        className={styles.select}
        value={source.connectionId}
        disabled={disabled}
        onChange={(e) => onChange({ connectionId: e.target.value })}
      >
        <option value="">接続を選択...</option>
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.server}/{c.database})
          </option>
        ))}
      </select>
      <div className={styles.modeTabs}>
        <button
          type="button"
          className={`${styles.modeTab} ${source.mode === 'table' ? styles.modeTabActive : ''}`}
          disabled={disabled}
          onClick={() => onChange({ mode: 'table' })}
        >
          テーブル
        </button>
        <button
          type="button"
          className={`${styles.modeTab} ${source.mode === 'sql' ? styles.modeTabActive : ''}`}
          disabled={disabled}
          onClick={() => onChange({ mode: 'sql' })}
        >
          SQL
        </button>
      </div>
      {source.mode === 'table' ? (
        <>
          <label className={styles.label} htmlFor={tableInputId}>
            テーブル名 ({label})
          </label>
          <input
            id={tableInputId}
            className={styles.input}
            type="text"
            placeholder="schema.table (例: dbo.Users)"
            value={source.table}
            disabled={disabled}
            onChange={(e) => onChange({ table: e.target.value })}
          />
        </>
      ) : (
        <>
          <label className={styles.label} htmlFor={sqlInputId}>
            SQL ({label})
          </label>
          <textarea
            id={sqlInputId}
            className={styles.textarea}
            placeholder="SELECT ..."
            value={source.sql}
            disabled={disabled}
            onChange={(e) => onChange({ sql: e.target.value })}
          />
        </>
      )}
    </div>
  );
}

export function DataCompareDialog({ isOpen, onClose }: DataCompareDialogProps) {
  useDialogKeyboard({ isOpen, onEscape: onClose });
  const connections = useConnections();
  const copyToClipboard = useCopyToClipboard();

  const [sourceA, setSourceA] = useState<SourceState>(EMPTY_SOURCE);
  const [sourceB, setSourceB] = useState<SourceState>(EMPTY_SOURCE);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ a: DiffResultSet; b: DiffResultSet } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [diff, setDiff] = useState<DataDiffResult | null>(null);
  const [filter, setFilter] = useState<'diff' | 'all'>('diff');

  const commonColumns = useMemo(() => {
    if (loaded === null) return [];
    const bNames = new Set(loaded.b.columns.map((c) => c.name));
    return loaded.a.columns.map((c) => c.name).filter((n) => bNames.has(n));
  }, [loaded]);

  const updateSourceA = useCallback(
    (patch: Partial<SourceState>) => setSourceA((prev) => ({ ...prev, ...patch })),
    []
  );
  const updateSourceB = useCallback(
    (patch: Partial<SourceState>) => setSourceB((prev) => ({ ...prev, ...patch })),
    []
  );

  const loadSources = useCallback(async () => {
    const validationError = validateSource(sourceA, 'A') ?? validateSource(sourceB, 'B');
    if (validationError !== null) {
      setLoadError(validationError);
      return;
    }
    const connA = findConnection(connections, sourceA.connectionId);
    const connB = findConnection(connections, sourceB.connectionId);
    if (connA === undefined || connB === undefined) {
      setLoadError('接続が見つかりません');
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    setDiff(null);
    setLoaded(null);
    try {
      const [a, b] = await Promise.all([fetchSource(sourceA, connA), fetchSource(sourceB, connB)]);
      const bNames = new Set(b.columns.map((c) => c.name));
      const common = a.columns.map((c) => c.name).filter((n) => bNames.has(n));
      if (common.length === 0) {
        setLoadError('共通カラムが存在しないため比較できません');
        return;
      }
      setLoaded({ a, b });
      setSelectedKeys([common[0]]);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'データの読み込みに失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [connections, sourceA, sourceB]);

  const toggleKey = useCallback((name: string) => {
    setDiff(null);
    setSelectedKeys((prev) =>
      prev.includes(name) ? prev.filter((k) => k !== name) : [...prev, name]
    );
  }, []);

  const runCompare = useCallback(async () => {
    if (loaded === null || selectedKeys.length === 0) return;
    setIsComparing(true);
    setLoadError(null);
    try {
      const result = await diffResultSetsAsync(loaded.a, loaded.b, { keyColumns: selectedKeys });
      setDiff(result);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '比較に失敗しました');
    } finally {
      setIsComparing(false);
    }
  }, [loaded, selectedKeys]);

  const copySummary = useCallback(() => {
    if (diff === null) return;
    const text = formatDiffSummary(diff, {
      a: sourceLabel(sourceA, findConnection(connections, sourceA.connectionId)),
      b: sourceLabel(sourceB, findConnection(connections, sourceB.connectionId)),
    });
    copyToClipboard(text, 'サマリをコピーしました');
  }, [diff, sourceA, sourceB, connections, copyToClipboard]);

  const visibleRows = useMemo(() => {
    if (diff === null) return [];
    const rows = filter === 'diff' ? diff.rows.filter((r) => r.status !== 'identical') : diff.rows;
    return rows.slice(0, DISPLAY_ROW_LIMIT);
  }, [diff, filter]);

  const totalVisibleCount = useMemo(() => {
    if (diff === null) return 0;
    if (filter === 'all') return diff.rows.length;
    const { added, removed, modified } = diff.summary;
    return added + removed + modified;
  }, [diff, filter]);

  if (!isOpen) return null;

  return (
    <DialogOverlay
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
      ariaLabelledBy="data-compare-title"
    >
      <div className={styles.header}>
        <h2 id="data-compare-title">データ比較</h2>
        <button type="button" className={styles.closeButton} onClick={onClose} title="閉じる">
          {'✕'}
        </button>
      </div>

      <div className={styles.content}>
        {connections.length === 0 ? (
          <div className={styles.emptyState}>比較するにはデータベースに接続してください</div>
        ) : (
          <>
            <div className={styles.sources}>
              <SourceEditor
                label="A"
                source={sourceA}
                connections={connections}
                disabled={isLoading}
                onChange={updateSourceA}
              />
              <SourceEditor
                label="B"
                source={sourceB}
                connections={connections}
                disabled={isLoading}
                onChange={updateSourceB}
              />
            </div>

            <div className={styles.actionsRow}>
              <button
                type="button"
                className={`${styles.button} ${styles.buttonPrimary}`}
                onClick={loadSources}
                disabled={isLoading}
              >
                {isLoading ? '読み込み中...' : 'データ読み込み'}
              </button>
              {loaded !== null && (
                <span className={styles.noteText}>
                  A: {loaded.a.rows.length}行 × {loaded.a.columns.length}列 / B:{' '}
                  {loaded.b.rows.length}行 × {loaded.b.columns.length}列
                </span>
              )}
            </div>

            {loadError !== null && <div className={styles.error}>{loadError}</div>}

            {loaded !== null && (
              <div className={styles.keySection}>
                <span className={styles.keySectionLabel}>キーカラム:</span>
                {commonColumns.map((name) => (
                  <label key={name} className={styles.keyCheckbox}>
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(name)}
                      onChange={() => toggleKey(name)}
                    />
                    {name}
                  </label>
                ))}
                <button
                  type="button"
                  className={`${styles.button} ${styles.buttonPrimary}`}
                  onClick={runCompare}
                  disabled={isComparing || selectedKeys.length === 0}
                >
                  {isComparing ? '比較中...' : '比較実行'}
                </button>
              </div>
            )}

            {diff !== null && (
              <>
                <div className={styles.summaryRow}>
                  <span className={`${styles.summaryBadge} ${styles.badgeAdded}`}>
                    追加 {diff.summary.added}
                  </span>
                  <span className={`${styles.summaryBadge} ${styles.badgeRemoved}`}>
                    削除 {diff.summary.removed}
                  </span>
                  <span className={`${styles.summaryBadge} ${styles.badgeModified}`}>
                    変更 {diff.summary.modified}
                  </span>
                  <span className={styles.summaryBadge}>一致 {diff.summary.identical}</span>
                  <button type="button" className={styles.button} onClick={copySummary}>
                    サマリをコピー
                  </button>
                  <div className={styles.filterToggle}>
                    <button
                      type="button"
                      className={`${styles.modeTab} ${filter === 'diff' ? styles.modeTabActive : ''}`}
                      onClick={() => setFilter('diff')}
                    >
                      差分のみ
                    </button>
                    <button
                      type="button"
                      className={`${styles.modeTab} ${filter === 'all' ? styles.modeTabActive : ''}`}
                      onClick={() => setFilter('all')}
                    >
                      すべて
                    </button>
                  </div>
                </div>

                {diff.warnings.length > 0 && (
                  <ul className={styles.warnings}>
                    {diff.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                )}

                {visibleRows.length === 0 ? (
                  <div className={styles.emptyState}>
                    {filter === 'diff' ? '差分はありません' : '表示する行がありません'}
                  </div>
                ) : (
                  <div className={styles.gridWrapper}>
                    <table className={styles.grid}>
                      <thead>
                        <tr>
                          <th>状態</th>
                          <th>キー</th>
                          {diff.columns.map((name) => (
                            <th key={name}>{name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((row, rowIndex) => (
                          <tr
                            // oxlint-disable-next-line react/no-array-index-key -- 重複キー行があり得るため index で一意化
                            key={`${row.status}-${row.keyDisplay}-${rowIndex}`}
                            className={ROW_CLASSES[row.status] ?? ''}
                          >
                            <td className={`${styles.statusCell} ${STATUS_CLASSES[row.status]}`}>
                              {STATUS_LABELS[row.status]}
                            </td>
                            <td>{row.keyDisplay}</td>
                            {diff.columns.map((name, colIndex) => {
                              const changed = row.changedCells?.[colIndex] === true;
                              const aValue = row.a?.[colIndex] ?? null;
                              const bValue = row.b?.[colIndex] ?? null;
                              return (
                                <td key={name} className={changed ? styles.changedCell : ''}>
                                  {changed ? (
                                    <>
                                      <span className={styles.oldValue}>
                                        {renderCellValue(aValue)}
                                      </span>
                                      <span className={styles.arrow}>{'→'}</span>
                                      <span className={styles.newValue}>
                                        {renderCellValue(bValue)}
                                      </span>
                                    </>
                                  ) : (
                                    renderCellValue(row.status === 'removed' ? aValue : bValue)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {totalVisibleCount > DISPLAY_ROW_LIMIT && (
                  <span className={styles.noteText}>
                    {totalVisibleCount}行中、先頭{DISPLAY_ROW_LIMIT}
                    行のみ表示しています
                  </span>
                )}
              </>
            )}
          </>
        )}
      </div>
    </DialogOverlay>
  );
}
