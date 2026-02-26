import { useCallback, useState } from 'react';
import { bridge } from '../api/bridge';
import type { DatabaseObject, DatabaseType, MenuItem } from '../types';
import { log } from '../utils/logger';
import { buildDropColumnSql, buildRenameColumnSql, quoteIdentifier } from '../utils/sqlIdentifier';
import { updateNodeChildren } from '../utils/treeNode';

// --- Discriminated union for dialog state ---

interface RenameInput {
  type: 'rename-input';
  colName: string;
  schema: string;
  tableName: string;
}

interface RenameConfirm {
  type: 'rename-confirm';
  sql: string;
  schema: string;
  tableName: string;
}

interface DropConfirm {
  type: 'drop-confirm';
  colName: string;
  schema: string;
  tableName: string;
  sql: string;
}

export type ColumnActionState = RenameInput | RenameConfirm | DropConfirm | null;

/** SQL識別子として不正な入力をバリデーション (null=OK, string=エラーメッセージ) */
export function validateIdentifier(value: string): string | null {
  if (!value.trim()) return '名前を入力してください';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char detection
  if (/[\x00-\x1f]/.test(value)) return '制御文字は使用できません';
  return null;
}

interface UseColumnActionsParams {
  connectionId: string;
  dbType?: DatabaseType;
  isReadOnly: boolean;
  loadColumns: (schema: string, tableName: string) => Promise<DatabaseObject[]>;
  setTreeData: React.Dispatch<React.SetStateAction<DatabaseObject[]>>;
  onDdlError?: (error: unknown) => void;
}

export function useColumnActions({
  connectionId,
  dbType,
  isReadOnly,
  loadColumns,
  setTreeData,
  onDdlError,
}: UseColumnActionsParams) {
  const [columnAction, setColumnAction] = useState<ColumnActionState>(null);

  // Refresh columns for a specific table in the tree
  const refreshTableColumns = useCallback(
    async (schema: string, tableName: string) => {
      const columns = await loadColumns(schema, tableName);
      const tableNodeId = `${connectionId}-${schema}-${tableName}`;
      setTreeData((prev) => updateNodeChildren(prev, tableNodeId, columns));
    },
    [connectionId, loadColumns, setTreeData]
  );

  // Execute DDL with error handling (C1) and refresh
  const executeDdl = useCallback(
    async (sql: string, schema: string, tableName: string) => {
      try {
        await bridge.executeQuery(connectionId, sql);
        await refreshTableColumns(schema, tableName);
      } catch (error) {
        log.error(`[useColumnActions] DDL execution failed: ${error}`);
        onDdlError?.(error);
      }
    },
    [connectionId, refreshTableColumns, onDdlError]
  );

  // Build column context menu items (W3: extracted from getMenuItems)
  const getColumnMenuItems = useCallback(
    (node: DatabaseObject): MenuItem[] => {
      const colName = node.name.split(' ')[0];
      const schema = (node.metadata?.schema as string) ?? 'dbo';
      const tblName = (node.metadata?.tableName as string) ?? '';
      const isPK = Boolean(node.metadata?.isPrimaryKey);
      const missingMeta = !tblName;

      return [
        {
          label: 'カラム名をコピー',
          action: async () => {
            await navigator.clipboard.writeText(colName);
          },
        },
        {
          label: 'WHERE句をコピー',
          action: async () => {
            const quoted = quoteIdentifier(colName, dbType);
            await navigator.clipboard.writeText(`WHERE ${quoted} = `);
          },
        },
        { label: '', action: () => {}, divider: true },
        {
          label: 'カラム名を変更',
          disabled: isReadOnly || missingMeta,
          action: () => {
            setColumnAction({ type: 'rename-input', colName, schema, tableName: tblName });
          },
        },
        {
          label: 'カラムを削除',
          disabled: isReadOnly || isPK || missingMeta,
          action: () => {
            const sql = buildDropColumnSql(schema, tblName, colName, dbType);
            setColumnAction({ type: 'drop-confirm', colName, schema, tableName: tblName, sql });
          },
        },
      ];
    },
    [dbType, isReadOnly]
  );

  // Dialog event handlers
  const handleRenameInput = useCallback(
    (newName: string) => {
      if (columnAction?.type !== 'rename-input') return;
      const sql = buildRenameColumnSql(
        columnAction.schema,
        columnAction.tableName,
        columnAction.colName,
        newName,
        dbType
      );
      setColumnAction({
        type: 'rename-confirm',
        sql,
        schema: columnAction.schema,
        tableName: columnAction.tableName,
      });
    },
    [columnAction, dbType]
  );

  const handleRenameConfirm = useCallback(async () => {
    if (columnAction?.type !== 'rename-confirm') return;
    const { sql, schema, tableName } = columnAction;
    setColumnAction(null);
    await executeDdl(sql, schema, tableName);
  }, [columnAction, executeDdl]);

  const handleDropConfirm = useCallback(async () => {
    if (columnAction?.type !== 'drop-confirm') return;
    const { sql, schema, tableName } = columnAction;
    setColumnAction(null);
    await executeDdl(sql, schema, tableName);
  }, [columnAction, executeDdl]);

  const dismiss = useCallback(() => setColumnAction(null), []);

  return {
    columnAction,
    getColumnMenuItems,
    handleRenameInput,
    handleRenameConfirm,
    handleDropConfirm,
    dismiss,
  };
}
