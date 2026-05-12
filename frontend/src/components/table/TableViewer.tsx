import { useCallback, useEffect } from 'react';
import { queryProvider, schemaProvider } from '../../api/providers';
import { useConnectionStore } from '../../store/connectionStore';
import { stripBrackets } from '../../utils/stringUtils';
import { useTableDataState } from './hooks/useTableDataState';
import { useTableSchemaState } from './hooks/useTableSchemaState';
import { type TabType, useTableUIState } from './hooks/useTableUIState';
import styles from './TableViewer.module.css';
import { ColumnsTab } from './tabs/ColumnsTab';
import { ConstraintsTab } from './tabs/ConstraintsTab';
import { DataTab } from './tabs/DataTab';
import { ForeignKeysTab } from './tabs/ForeignKeysTab';
import { IndexesTab } from './tabs/IndexesTab';
import { RdbmsInfoTab } from './tabs/RdbmsInfoTab';
import { ReferencingForeignKeysTab } from './tabs/ReferencingForeignKeysTab';
import { SourceTab } from './tabs/SourceTab';
import { TriggersTab } from './tabs/TriggersTab';

interface TableViewerProps {
  tableName: string;
  schemaName?: string;
}

export function TableViewer({ tableName, schemaName = 'dbo' }: TableViewerProps) {
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);

  // UI state (関心事別に hook 化)
  const {
    activeTab,
    setActiveTab,
    showLogicalNames,
    setShowLogicalNames,
    isLoading,
    setIsLoading,
    error,
    setError,
  } = useTableUIState();

  // Data state (関心事別に hook 化)
  const { resultSet, setResultSet, whereClause, setWhereClause } = useTableDataState();

  // Schema state (関心事別に hook 化)
  const {
    columns,
    setColumns,
    indexes,
    setIndexes,
    constraints,
    setConstraints,
    foreignKeys,
    setForeignKeys,
    referencingForeignKeys,
    setReferencingForeignKeys,
    triggers,
    setTriggers,
    metadata,
    setMetadata,
    ddl,
    setDdl,
  } = useTableSchemaState();

  const fullTableName = schemaName ? `[${schemaName}].[${tableName}]` : `[${tableName}]`;

  const loadData = useCallback(async () => {
    if (!activeConnectionId) return;
    setIsLoading(true);
    setError(null);

    try {
      let sql = `SELECT * FROM ${fullTableName}`;
      if (whereClause.trim()) {
        sql += ` WHERE ${whereClause}`;
      }

      const result = await queryProvider.executeQuery(activeConnectionId, sql, false);
      if ('multipleResults' in result) {
        setError('複数ステートメントの結果はテーブルビューアでは表示できません');
        return;
      }
      setResultSet({
        columns: result.columns.map((c) => ({
          ...c,
          size: 0,
          nullable: true,
          isPrimaryKey: false,
        })),
        rows: result.rows,
        affectedRows: result.affectedRows,
        executionTimeMs: result.executionTimeMs,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  }, [activeConnectionId, fullTableName, whereClause, setResultSet, setIsLoading, setError]);

  const loadColumns = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await schemaProvider.getColumns(activeConnectionId, fullTableName);
      setColumns(result);
    } catch (err) {
      console.error('Failed to load columns:', err);
    }
  }, [activeConnectionId, fullTableName, setColumns]);

  const loadIndexes = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await schemaProvider.getIndexes(activeConnectionId, fullTableName);
      setIndexes(result);
    } catch (err) {
      console.error('Failed to load indexes:', err);
    }
  }, [activeConnectionId, fullTableName, setIndexes]);

  const loadConstraints = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await schemaProvider.getConstraints(activeConnectionId, fullTableName);
      setConstraints(result);
    } catch (err) {
      console.error('Failed to load constraints:', err);
    }
  }, [activeConnectionId, fullTableName, setConstraints]);

  const loadForeignKeys = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await schemaProvider.getForeignKeys(activeConnectionId, fullTableName);
      setForeignKeys(result);
    } catch (err) {
      console.error('Failed to load foreign keys:', err);
    }
  }, [activeConnectionId, fullTableName, setForeignKeys]);

  const loadReferencingForeignKeys = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await schemaProvider.getReferencingForeignKeys(
        activeConnectionId,
        fullTableName
      );
      setReferencingForeignKeys(result);
    } catch (err) {
      console.error('Failed to load referencing foreign keys:', err);
    }
  }, [activeConnectionId, fullTableName, setReferencingForeignKeys]);

  const loadTriggers = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await schemaProvider.getTriggers(activeConnectionId, fullTableName);
      setTriggers(result);
    } catch (err) {
      console.error('Failed to load triggers:', err);
    }
  }, [activeConnectionId, fullTableName, setTriggers]);

  const loadMetadata = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await schemaProvider.getTableMetadata(activeConnectionId, fullTableName);
      setMetadata(result);
    } catch (err) {
      console.error('Failed to load metadata:', err);
    }
  }, [activeConnectionId, fullTableName, setMetadata]);

  const loadDdl = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await schemaProvider.getTableDDL(activeConnectionId, fullTableName);
      setDdl(result.ddl);
    } catch (err) {
      console.error('Failed to load DDL:', err);
    }
  }, [activeConnectionId, fullTableName, setDdl]);

  // Load data when tab changes
  useEffect(() => {
    switch (activeTab) {
      case 'data':
        loadData();
        break;
      case 'columns':
        loadColumns();
        break;
      case 'indexes':
        loadIndexes();
        break;
      case 'constraints':
        loadConstraints();
        break;
      case 'foreignKeys':
        loadForeignKeys();
        break;
      case 'referencingForeignKeys':
        loadReferencingForeignKeys();
        break;
      case 'triggers':
        loadTriggers();
        break;
      case 'rdbmsInfo':
        loadMetadata();
        break;
      case 'source':
        loadDdl();
        break;
    }
  }, [
    activeTab,
    loadData,
    loadColumns,
    loadIndexes,
    loadConstraints,
    loadForeignKeys,
    loadReferencingForeignKeys,
    loadTriggers,
    loadMetadata,
    loadDdl,
  ]);

  const tabs: { id: TabType; label: string }[] = [
    { id: 'data', label: 'データ' },
    { id: 'columns', label: 'カラム' },
    { id: 'indexes', label: 'インデックス' },
    { id: 'constraints', label: '制約' },
    { id: 'foreignKeys', label: '外部キー' },
    { id: 'referencingForeignKeys', label: '外部キー（参照元）' },
    { id: 'triggers', label: 'トリガー' },
    { id: 'rdbmsInfo', label: 'RDBMS情報' },
    { id: 'source', label: 'ソース' },
  ];

  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button
            type="button"
            className={styles.toolbarButton}
            title="行を追加"
            disabled={activeTab !== 'data'}
          >
            <span className={styles.icon}>+</span>
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            title="行を削除"
            disabled={activeTab !== 'data'}
          >
            <span className={styles.icon}>−</span>
          </button>
          <button
            type="button"
            className={styles.toolbarButton}
            title="行を複製"
            disabled={activeTab !== 'data'}
          >
            <span className={styles.icon}>⎘</span>
          </button>
          <div className={styles.toolbarDivider} />
          <button
            type="button"
            className={`${styles.toolbarButton} ${showLogicalNames ? styles.active : ''}`}
            title="論理名を表示"
            onClick={() => setShowLogicalNames(!showLogicalNames)}
          >
            <span className={styles.icon}>A/あ</span>
          </button>
          <div className={styles.toolbarDivider} />
          <button type="button" className={styles.toolbarButton} title="フィルタ">
            <span className={styles.icon}>🔍</span>
          </button>
          <button type="button" className={styles.toolbarButton} title="条件">
            <span className={styles.icon}>⚡</span>
          </button>
          <div className={styles.toolbarDivider} />
          <button type="button" className={styles.toolbarButton} title="マーカー">
            <span className={styles.icon}>🔖</span>
          </button>
        </div>
        <div className={styles.toolbarRight}>
          <span className={styles.tableName}>{stripBrackets(fullTableName)}</span>
          {resultSet && (
            <span className={styles.rowCount}>{resultSet.rows.length.toLocaleString()} 件</span>
          )}
          <button type="button" className={styles.toolbarButton} title="更新" onClick={loadData}>
            <span className={styles.icon}>↻</span>
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className={styles.tabBar}>
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={`${styles.tab} ${activeTab === tab.id ? styles.activeTab : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className={styles.content}>
        {isLoading && (
          <div className={styles.loading}>
            <span className={styles.spinner}>⏳</span>
            <span>読み込み中...</span>
          </div>
        )}
        {error && (
          <div className={styles.error}>
            <span>エラー: {error}</span>
          </div>
        )}
        {!isLoading && !error && (
          <>
            {activeTab === 'data' && (
              <DataTab
                resultSet={resultSet}
                whereClause={whereClause}
                onWhereClauseChange={setWhereClause}
                onApplyFilter={loadData}
                showLogicalNames={showLogicalNames}
              />
            )}
            {activeTab === 'columns' && (
              <ColumnsTab columns={columns} showLogicalNames={showLogicalNames} />
            )}
            {activeTab === 'indexes' && (
              <IndexesTab indexes={indexes} showLogicalNames={showLogicalNames} />
            )}
            {activeTab === 'constraints' && <ConstraintsTab constraints={constraints} />}
            {activeTab === 'foreignKeys' && <ForeignKeysTab foreignKeys={foreignKeys} />}
            {activeTab === 'referencingForeignKeys' && (
              <ReferencingForeignKeysTab referencingForeignKeys={referencingForeignKeys} />
            )}
            {activeTab === 'triggers' && <TriggersTab triggers={triggers} />}
            {activeTab === 'rdbmsInfo' && <RdbmsInfoTab metadata={metadata} />}
            {activeTab === 'source' && <SourceTab ddl={ddl} />}
          </>
        )}
      </div>
    </div>
  );
}
