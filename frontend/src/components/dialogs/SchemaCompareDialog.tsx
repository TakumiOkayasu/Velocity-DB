import { useCallback, useMemo, useState } from 'react';
import { ioProvider, schemaProvider } from '../../api/providers';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { useConnections } from '../../store/connectionStore';
import type { Connection } from '../../types';
import { normalizeTablesForDdlComparison, parseDdl } from '../../utils/ddlParser';
import {
  generateMigrationDdl,
  type MigrationDialect,
  renderColumnType,
} from '../../utils/migrationDdl';
import {
  type ColumnChange,
  diffSchemas,
  isEmptyDiff,
  type SchemaDiff,
  type SchemaTable,
  tableKey,
} from '../../utils/schemaDiff';
import { DialogOverlay } from '../common/DialogOverlay';
import styles from './SchemaCompareDialog.module.css';

interface SchemaCompareDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CompareResult {
  diff: SchemaDiff;
  sourceLabel: string;
  targetLabel: string;
  generatedAt: string;
}

/** 比較ソースの種別: 接続中の DB か、DDL ファイル (.sql) か */
type SourceKind = 'connection' | 'ddl';

/** DDL ファイルソースの読み込み状態 */
interface DdlSource {
  fileName: string;
  tables: SchemaTable[];
  error: string | null;
}

const EMPTY_DDL_SOURCE: DdlSource = { fileName: '', tables: [], error: null };

/** getColumns 同時実行数の上限 (バックエンド ODBC 接続への負荷を抑制) */
const COLUMN_FETCH_CONCURRENCY = 4;

/** ツリー表示と同じ規約でカラム取得用テーブル識別子を組み立てる (dbo / 空スキーマは修飾なし) */
function toColumnFetchId(table: { schema: string; name: string }): string {
  return table.schema !== '' && table.schema !== 'dbo'
    ? `${table.schema}.${table.name}`
    : table.name;
}

/** 指定接続の全テーブル + カラム定義を取得する (同時実行数を制限した並列取得) */
async function fetchSchemaTables(
  connectionId: string,
  database: string,
  onProgress: (done: number, total: number) => void
): Promise<SchemaTable[]> {
  const { tables } = await schemaProvider.getTables(connectionId, database);
  const targets = tables.filter((t) => t.type !== 'VIEW');
  const results: SchemaTable[] = new Array(targets.length);
  let done = 0;
  let nextIndex = 0;

  const workers = Array.from(
    { length: Math.min(COLUMN_FETCH_CONCURRENCY, targets.length) },
    async () => {
      while (nextIndex < targets.length) {
        const i = nextIndex;
        nextIndex += 1;
        const table = targets[i];
        const columns = await schemaProvider.getColumns(connectionId, toColumnFetchId(table));
        results[i] = { schema: table.schema, name: table.name, columns };
        done += 1;
        onProgress(done, targets.length);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

/** FileReader でテキストファイルを読み込む (backend IPC 不要) */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('ファイルの読み込みに失敗しました'));
    reader.readAsText(file);
  });
}

function isSourceReady(
  kind: SourceKind,
  connectionId: string,
  database: string,
  ddl: DdlSource
): boolean {
  if (kind === 'connection') return connectionId !== '' && database !== '';
  return ddl.error === null && ddl.tables.length > 0;
}

function describeColumnChange(change: ColumnChange): string {
  const parts: string[] = [];
  if (change.changes.includes('type') || change.changes.includes('size')) {
    parts.push(`${renderColumnType(change.from)} -> ${renderColumnType(change.to)}`);
  }
  if (change.changes.includes('nullable')) {
    parts.push(change.to.nullable ? 'NOT NULL -> NULL' : 'NULL -> NOT NULL');
  }
  if (change.changes.includes('isPrimaryKey')) {
    parts.push(change.to.isPrimaryKey ? 'PK追加' : 'PK解除');
  }
  return parts.join(', ');
}

interface SourcePickerProps {
  title: string;
  idPrefix: string;
  connections: Connection[];
  sourceKind: SourceKind;
  onSourceKindChange: (kind: SourceKind) => void;
  connectionId: string;
  database: string;
  databases: string[];
  onConnectionChange: (connectionId: string) => void;
  onDatabaseChange: (database: string) => void;
  ddl: DdlSource;
  onDdlFileSelect: (file: File) => void;
  disabled: boolean;
}

function SourcePicker({
  title,
  idPrefix,
  connections,
  sourceKind,
  onSourceKindChange,
  connectionId,
  database,
  databases,
  onConnectionChange,
  onDatabaseChange,
  ddl,
  onDdlFileSelect,
  disabled,
}: SourcePickerProps) {
  return (
    <div className={styles.sourcePicker}>
      <h3>{title}</h3>
      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor={`${idPrefix}-source-kind`}>
          ソース種別
        </label>
        <select
          id={`${idPrefix}-source-kind`}
          className={styles.select}
          value={sourceKind}
          onChange={(e) => onSourceKindChange(e.target.value as SourceKind)}
          disabled={disabled}
        >
          <option value="connection">接続/データベース</option>
          <option value="ddl">DDL ファイル (.sql)</option>
        </select>
      </div>
      {sourceKind === 'connection' ? (
        <>
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor={`${idPrefix}-connection`}>
              接続
            </label>
            <select
              id={`${idPrefix}-connection`}
              className={styles.select}
              value={connectionId}
              onChange={(e) => onConnectionChange(e.target.value)}
              disabled={disabled}
            >
              <option value="">選択してください</option>
              {connections.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.name} ({conn.server})
                </option>
              ))}
            </select>
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor={`${idPrefix}-database`}>
              データベース
            </label>
            <select
              id={`${idPrefix}-database`}
              className={styles.select}
              value={database}
              onChange={(e) => onDatabaseChange(e.target.value)}
              disabled={disabled || connectionId === ''}
            >
              {databases.map((db) => (
                <option key={db} value={db}>
                  {db}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor={`${idPrefix}-ddl-file`}>
            DDL ファイル
          </label>
          <input
            id={`${idPrefix}-ddl-file`}
            type="file"
            accept=".sql,.ddl,.txt"
            className={styles.fileInput}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onDdlFileSelect(file);
              e.target.value = '';
            }}
            disabled={disabled}
          />
          {ddl.fileName !== '' && (
            <div className={styles.fileInfo}>
              {ddl.error === null
                ? `${ddl.fileName} (${ddl.tables.length} テーブル)`
                : ddl.fileName}
            </div>
          )}
          {ddl.error !== null && <div className={styles.fileError}>{ddl.error}</div>}
        </div>
      )}
    </div>
  );
}

export function SchemaCompareDialog({ isOpen, onClose }: SchemaCompareDialogProps) {
  useDialogKeyboard({ isOpen, onEscape: onClose });
  const connections = useConnections();

  const [sourceKindA, setSourceKindA] = useState<SourceKind>('connection');
  const [sourceKindB, setSourceKindB] = useState<SourceKind>('connection');
  const [connectionIdA, setConnectionIdA] = useState('');
  const [databaseA, setDatabaseA] = useState('');
  const [databasesA, setDatabasesA] = useState<string[]>([]);
  const [connectionIdB, setConnectionIdB] = useState('');
  const [databaseB, setDatabaseB] = useState('');
  const [databasesB, setDatabasesB] = useState<string[]>([]);
  const [ddlA, setDdlA] = useState<DdlSource>(EMPTY_DDL_SOURCE);
  const [ddlB, setDdlB] = useState<DdlSource>(EMPTY_DDL_SOURCE);

  const [dialect, setDialect] = useState<MigrationDialect>('sqlserver');
  const [isComparing, setIsComparing] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const ddl = useMemo(() => {
    if (!result) return '';
    return generateMigrationDdl(result.diff, {
      dialect,
      sourceLabel: result.sourceLabel,
      targetLabel: result.targetLabel,
      generatedAt: result.generatedAt,
    });
  }, [result, dialect]);

  const selectConnection = useCallback(
    async (
      connectionId: string,
      setConnectionId: (v: string) => void,
      setDatabase: (v: string) => void,
      setDatabases: (v: string[]) => void
    ) => {
      setConnectionId(connectionId);
      const conn = connections.find((c) => c.id === connectionId);
      const fallback = conn ? [conn.database] : [];
      setDatabase(conn?.database ?? '');
      setDatabases(fallback);
      if (!conn) return;
      try {
        const databases = await schemaProvider.getDatabases(connectionId);
        if (databases.length > 0) {
          setDatabases(
            databases.includes(conn.database) ? databases : [conn.database, ...databases]
          );
        }
      } catch {
        // getDatabases 未対応/失敗時は接続時の database のみ選択可能とする
      }
    },
    [connections]
  );

  const selectConnectionA = useCallback(
    (id: string) => selectConnection(id, setConnectionIdA, setDatabaseA, setDatabasesA),
    [selectConnection]
  );

  const selectConnectionB = useCallback(
    (id: string) => {
      void selectConnection(id, setConnectionIdB, setDatabaseB, setDatabasesB);
      const conn = connections.find((c) => c.id === id);
      if (conn?.dbType) setDialect(conn.dbType);
    },
    [selectConnection, connections]
  );

  const loadDdlFile = useCallback(async (file: File, setDdl: (v: DdlSource) => void) => {
    try {
      const text = await readFileAsText(file);
      const tables = parseDdl(text);
      if (tables.length === 0) {
        setDdl({
          fileName: file.name,
          tables: [],
          error: 'CREATE TABLE 文を検出できませんでした',
        });
        return;
      }
      setDdl({ fileName: file.name, tables, error: null });
    } catch (err) {
      setDdl({
        fileName: file.name,
        tables: [],
        error:
          err instanceof Error
            ? `DDL ファイルの読み込みに失敗しました: ${err.message}`
            : 'DDL ファイルの読み込みに失敗しました',
      });
    }
  }, []);

  const compare = useCallback(async () => {
    const connA = connections.find((c) => c.id === connectionIdA);
    const connB = connections.find((c) => c.id === connectionIdB);
    if (sourceKindA === 'connection' && !connA) return;
    if (sourceKindB === 'connection' && !connB) return;

    setIsComparing(true);
    setError(null);
    setResult(null);
    setSaveMessage(null);
    try {
      const fromTables =
        sourceKindA === 'connection' && connA
          ? await fetchSchemaTables(connA.id, databaseA, (done, total) => {
              setProgressText(`移行元スキーマ取得中... (${done}/${total})`);
            })
          : ddlA.tables;
      const toTables =
        sourceKindB === 'connection' && connB
          ? await fetchSchemaTables(connB.id, databaseB, (done, total) => {
              setProgressText(`移行先スキーマ取得中... (${done}/${total})`);
            })
          : ddlB.tables;
      // DDL ソースを含む比較では、取得元 (ODBC / DDL) 間で意味の揃わない属性を正規化する
      const useDdlNormalization = sourceKindA === 'ddl' || sourceKindB === 'ddl';
      setResult({
        diff: diffSchemas(
          useDdlNormalization ? normalizeTablesForDdlComparison(fromTables) : fromTables,
          useDdlNormalization ? normalizeTablesForDdlComparison(toTables) : toTables
        ),
        sourceLabel:
          sourceKindA === 'connection' && connA
            ? `${connA.name}/${databaseA}`
            : `DDL: ${ddlA.fileName}`,
        targetLabel:
          sourceKindB === 'connection' && connB
            ? `${connB.name}/${databaseB}`
            : `DDL: ${ddlB.fileName}`,
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'スキーマ比較に失敗しました');
    } finally {
      setIsComparing(false);
      setProgressText('');
    }
  }, [
    connections,
    connectionIdA,
    connectionIdB,
    databaseA,
    databaseB,
    sourceKindA,
    sourceKindB,
    ddlA,
    ddlB,
  ]);

  const copyDdl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ddl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API 非対応環境では無視
    }
  }, [ddl]);

  const downloadDdl = useCallback(async () => {
    try {
      const { filePath } = await ioProvider.saveQueryToFile(ddl, 'schema_migration.sql');
      setSaveMessage(`保存しました: ${filePath}`);
    } catch (err) {
      setSaveMessage(
        err instanceof Error ? `保存に失敗しました: ${err.message}` : '保存に失敗しました'
      );
    }
  }, [ddl]);

  if (!isOpen) return null;

  const canCompare =
    !isComparing &&
    isSourceReady(sourceKindA, connectionIdA, databaseA, ddlA) &&
    isSourceReady(sourceKindB, connectionIdB, databaseB, ddlB);

  return (
    <DialogOverlay
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
      ariaLabelledBy="schema-compare-dialog-title"
    >
      <div className={styles.header}>
        <h2 id="schema-compare-dialog-title">スキーマ比較</h2>
        <button type="button" className={styles.closeButton} onClick={onClose}>
          {'✕'}
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.sourceRow}>
          <SourcePicker
            title="移行元 (A)"
            idPrefix="schema-compare-a"
            connections={connections}
            sourceKind={sourceKindA}
            onSourceKindChange={setSourceKindA}
            connectionId={connectionIdA}
            database={databaseA}
            databases={databasesA}
            onConnectionChange={(id) => void selectConnectionA(id)}
            onDatabaseChange={setDatabaseA}
            ddl={ddlA}
            onDdlFileSelect={(file) => void loadDdlFile(file, setDdlA)}
            disabled={isComparing}
          />
          <div className={styles.sourceArrow}>{'→'}</div>
          <SourcePicker
            title="移行先 (B)"
            idPrefix="schema-compare-b"
            connections={connections}
            sourceKind={sourceKindB}
            onSourceKindChange={setSourceKindB}
            connectionId={connectionIdB}
            database={databaseB}
            databases={databasesB}
            onConnectionChange={selectConnectionB}
            onDatabaseChange={setDatabaseB}
            ddl={ddlB}
            onDdlFileSelect={(file) => void loadDdlFile(file, setDdlB)}
            disabled={isComparing}
          />
        </div>

        {connections.length === 0 &&
          (sourceKindA === 'connection' || sourceKindB === 'connection') && (
            <div className={styles.hint}>比較するには先にデータベースへ接続してください。</div>
          )}

        <div className={styles.compareRow}>
          <button
            type="button"
            className={styles.compareButton}
            onClick={() => void compare()}
            disabled={!canCompare}
          >
            {isComparing ? '比較中...' : '比較'}
          </button>
          {isComparing && progressText && <span className={styles.progress}>{progressText}</span>}
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {result && (
          <div className={styles.resultSection}>
            <h3>比較結果</h3>
            {isEmptyDiff(result.diff) ? (
              <p className={styles.noDiff}>差分はありません (移行 DDL は不要です)。</p>
            ) : (
              <div className={styles.diffList}>
                {result.diff.addedTables.map((table) => (
                  <div key={`added-${tableKey(table)}`} className={styles.diffTable}>
                    <span className={`${styles.marker} ${styles.markerAdded}`}>+</span>
                    <span className={styles.diffTableName}>{tableKey(table)}</span>
                    <span className={styles.diffMeta}>追加 ({table.columns.length} カラム)</span>
                  </div>
                ))}
                {result.diff.changedTables.map((table) => (
                  <div key={`changed-${tableKey(table)}`}>
                    <div className={styles.diffTable}>
                      <span className={`${styles.marker} ${styles.markerChanged}`}>~</span>
                      <span className={styles.diffTableName}>{tableKey(table)}</span>
                      <span className={styles.diffMeta}>変更</span>
                    </div>
                    <ul className={styles.columnDiffList}>
                      {table.addedColumns.map((col) => (
                        <li key={`add-${col.name}`} className={styles.colAdded}>
                          + {col.name} : {renderColumnType(col)}
                        </li>
                      ))}
                      {table.changedColumns.map((change) => (
                        <li key={`chg-${change.name}`} className={styles.colChanged}>
                          ~ {change.name} : {describeColumnChange(change)}
                        </li>
                      ))}
                      {table.removedColumns.map((col) => (
                        <li key={`rem-${col.name}`} className={styles.colRemoved}>
                          - {col.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {result.diff.removedTables.map((table) => (
                  <div key={`removed-${tableKey(table)}`} className={styles.diffTable}>
                    <span className={`${styles.marker} ${styles.markerRemoved}`}>-</span>
                    <span className={styles.diffTableName}>{tableKey(table)}</span>
                    <span className={styles.diffMeta}>削除</span>
                  </div>
                ))}
              </div>
            )}

            <div className={styles.ddlSection}>
              <div className={styles.ddlHeader}>
                <h3>移行DDL</h3>
                <label className={styles.dialectLabel} htmlFor="schema-compare-dialect">
                  DDL方言
                </label>
                <select
                  id="schema-compare-dialect"
                  className={styles.dialectSelect}
                  value={dialect}
                  onChange={(e) => setDialect(e.target.value as MigrationDialect)}
                >
                  <option value="sqlserver">SQL Server</option>
                  <option value="postgresql">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                </select>
                <button type="button" onClick={() => void copyDdl()}>
                  {copied ? 'コピーしました' : 'コピー'}
                </button>
                <button type="button" onClick={() => void downloadDdl()}>
                  ダウンロード (.sql)
                </button>
              </div>
              <textarea
                className={styles.ddlContent}
                aria-label="生成された移行DDL"
                readOnly
                value={ddl}
              />
              {saveMessage && <div className={styles.saveMessage}>{saveMessage}</div>}
            </div>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.closeFooterButton} onClick={onClose}>
          閉じる
        </button>
      </div>
    </DialogOverlay>
  );
}
