import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import type {
  Column,
  ConstraintInfo,
  ForeignKeyInfo,
  IndexInfo,
  ReferencingForeignKeyInfo,
  ResultSet,
  TableMetadata,
  TriggerInfo,
} from '../../types';
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

type TabType =
  | 'data'
  | 'columns'
  | 'indexes'
  | 'constraints'
  | 'foreignKeys'
  | 'referencingForeignKeys'
  | 'triggers'
  | 'rdbmsInfo'
  | 'source';

interface TableViewerProps {
  tableName: string;
  schemaName?: string;
}

export function TableViewer({ tableName, schemaName = 'dbo' }: TableViewerProps) {
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const [activeTab, setActiveTab] = useState<TabType>('data');
  const [showLogicalNames, setShowLogicalNames] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [resultSet, setResultSet] = useState<ResultSet | null>(null);
  const [whereClause, setWhereClause] = useState('');

  // Schema state
  const [columns, setColumns] = useState<Column[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyInfo[]>([]);
  const [referencingForeignKeys, setReferencingForeignKeys] = useState<ReferencingForeignKeyInfo[]>(
    []
  );
  const [triggers, setTriggers] = useState<TriggerInfo[]>([]);
  const [metadata, setMetadata] = useState<TableMetadata | null>(null);
  const [ddl, setDdl] = useState<string>('');

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

      const result = await bridge.executeQuery(activeConnectionId, sql, false);
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
  }, [activeConnectionId, fullTableName, whereClause]);

  const loadColumns = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await bridge.getColumns(activeConnectionId, fullTableName);
      setColumns(result);
    } catch (err) {
      console.error('Failed to load columns:', err);
    }
  }, [activeConnectionId, fullTableName]);

  const loadIndexes = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await bridge.getIndexes(activeConnectionId, fullTableName);
      setIndexes(result);
    } catch (err) {
      console.error('Failed to load indexes:', err);
    }
  }, [activeConnectionId, fullTableName]);

  const loadConstraints = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await bridge.getConstraints(activeConnectionId, fullTableName);
      setConstraints(result as ConstraintInfo[]);
    } catch (err) {
      console.error('Failed to load constraints:', err);
    }
  }, [activeConnectionId, fullTableName]);

  const loadForeignKeys = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await bridge.getForeignKeys(activeConnectionId, fullTableName);
      setForeignKeys(result);
    } catch (err) {
      console.error('Failed to load foreign keys:', err);
    }
  }, [activeConnectionId, fullTableName]);

  const loadReferencingForeignKeys = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await bridge.getReferencingForeignKeys(activeConnectionId, fullTableName);
      setReferencingForeignKeys(result);
    } catch (err) {
      console.error('Failed to load referencing foreign keys:', err);
    }
  }, [activeConnectionId, fullTableName]);

  const loadTriggers = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await bridge.getTriggers(activeConnectionId, fullTableName);
      setTriggers(result);
    } catch (err) {
      console.error('Failed to load triggers:', err);
    }
  }, [activeConnectionId, fullTableName]);

  const loadMetadata = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await bridge.getTableMetadata(activeConnectionId, fullTableName);
      setMetadata(result as TableMetadata);
    } catch (err) {
      console.error('Failed to load metadata:', err);
    }
  }, [activeConnectionId, fullTableName]);

  const loadDdl = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const result = await bridge.getTableDDL(activeConnectionId, fullTableName);
      setDdl(result.ddl);
    } catch (err) {
      console.error('Failed to load DDL:', err);
    }
  }, [activeConnectionId, fullTableName]);

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
    { id: 'data', label: 'Data' },
    { id: 'columns', label: 'Columns' },
    { id: 'indexes', label: 'Indexes' },
    { id: 'constraints', label: 'Constraints' },
    { id: 'foreignKeys', label: 'Foreign Keys' },
    { id: 'referencingForeignKeys', label: 'Foreign Keys (Referenced)' },
    { id: 'triggers', label: 'Triggers' },
    { id: 'rdbmsInfo', label: 'RDBMS Info' },
    { id: 'source', label: 'Source' },
  ];

  return (
    <div className={styles.container}>
      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <button className={styles.toolbarButton} title="Add Row" disabled={activeTab !== 'data'}>
            <span className={styles.icon}>+</span>
          </button>
          <button
            className={styles.toolbarButton}
            title="Delete Row"
            disabled={activeTab !== 'data'}
          >
            <span className={styles.icon}>−</span>
          </button>
          <button
            className={styles.toolbarButton}
            title="Clone Row"
            disabled={activeTab !== 'data'}
          >
            <span className={styles.icon}>⎘</span>
          </button>
          <div className={styles.toolbarDivider} />
          <button
            className={`${styles.toolbarButton} ${showLogicalNames ? styles.active : ''}`}
            title="Show Logical Names"
            onClick={() => setShowLogicalNames(!showLogicalNames)}
          >
            <span className={styles.icon}>A/あ</span>
          </button>
          <div className={styles.toolbarDivider} />
          <button className={styles.toolbarButton} title="Filter">
            <span className={styles.icon}>🔍</span>
          </button>
          <button className={styles.toolbarButton} title="Condition">
            <span className={styles.icon}>⚡</span>
          </button>
          <div className={styles.toolbarDivider} />
          <button className={styles.toolbarButton} title="Marker">
            <span className={styles.icon}>🔖</span>
          </button>
        </div>
        <div className={styles.toolbarRight}>
          <span className={styles.tableName}>{fullTableName}</span>
          {resultSet && (
            <span className={styles.rowCount}>{resultSet.rows.length.toLocaleString()} rows</span>
          )}
          <button className={styles.toolbarButton} title="Refresh" onClick={loadData}>
            <span className={styles.icon}>↻</span>
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className={styles.tabBar}>
        {tabs.map((tab) => (
          <button
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
            <span>Loading...</span>
          </div>
        )}
        {error && (
          <div className={styles.error}>
            <span>Error: {error}</span>
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
