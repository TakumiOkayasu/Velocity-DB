import { useCallback, useState } from 'react';
import { bridge } from '../api/bridge';
import type { DatabaseObject, DatabaseType, MenuItem } from '../types';
import { log } from '../utils/logger';
import {
  buildDropTableSql,
  buildTruncateTableSql,
  SQL_BEGIN_TRANSACTION,
} from '../utils/sqlIdentifier';

interface DropConfirm {
  type: 'drop-confirm';
  schema: string;
  tableName: string;
  sqls: string[];
  hasFK: boolean;
}

interface TruncateConfirm {
  type: 'truncate-confirm';
  schema: string;
  tableName: string;
  sqls: string[];
  hasFK: boolean;
}

export type TableActionState = DropConfirm | TruncateConfirm | null;

interface UseTableActionsParams {
  connectionId: string;
  dbType?: DatabaseType;
  loadTables: () => Promise<DatabaseObject[]>;
  setTreeData: React.Dispatch<React.SetStateAction<DatabaseObject[]>>;
  onDdlError?: (error: unknown) => void;
}

function parseTableName(node: DatabaseObject): { schema: string; table: string } {
  const schema = (node.metadata?.schema as string) ?? 'dbo';
  const parts = node.name.split('.');
  const table = parts.length >= 2 ? parts[1] : parts[0];
  return { schema, table };
}

export function useTableActions({
  connectionId,
  dbType,
  loadTables,
  setTreeData,
  onDdlError,
}: UseTableActionsParams) {
  const [tableAction, setTableAction] = useState<TableActionState>(null);

  const requestDrop = useCallback(
    async (node: DatabaseObject) => {
      const { schema, table } = parseTableName(node);
      try {
        const fks = await bridge.getReferencingForeignKeys(connectionId, node.name);
        const sqls = buildDropTableSql(schema, table, dbType, fks);
        setTableAction({
          type: 'drop-confirm',
          schema,
          tableName: table,
          sqls,
          hasFK: fks.length > 0,
        });
      } catch (error) {
        log.error(`[useTableActions] Failed to get FK info: ${error}`);
        onDdlError?.(error);
      }
    },
    [connectionId, dbType, onDdlError]
  );

  const requestTruncate = useCallback(
    async (node: DatabaseObject) => {
      const { schema, table } = parseTableName(node);
      try {
        const fks = await bridge.getReferencingForeignKeys(connectionId, node.name);
        const sqls = buildTruncateTableSql(schema, table, dbType, fks);
        setTableAction({
          type: 'truncate-confirm',
          schema,
          tableName: table,
          sqls,
          hasFK: fks.length > 0,
        });
      } catch (error) {
        log.error(`[useTableActions] Failed to get FK info: ${error}`);
        onDdlError?.(error);
      }
    },
    [connectionId, dbType, onDdlError]
  );

  const getTableMenuItems = useCallback(
    (node: DatabaseObject): MenuItem[] => {
      if (node.type !== 'table') return [];
      return [
        {
          label: 'テーブルを削除',
          action: () => requestDrop(node),
        },
        {
          label: 'テーブルを空にする',
          action: () => requestTruncate(node),
        },
      ];
    },
    [requestDrop, requestTruncate]
  );

  const executeSqls = useCallback(
    async (sqls: string[]) => {
      const hasTransaction = sqls[0] === SQL_BEGIN_TRANSACTION;
      try {
        for (const sql of sqls) {
          await bridge.executeQuery(connectionId, sql, false);
        }
      } catch (error) {
        if (hasTransaction) {
          await bridge.executeQuery(connectionId, 'ROLLBACK', false).catch(() => {});
        }
        throw error;
      }
    },
    [connectionId]
  );

  const confirmDrop = useCallback(async () => {
    if (tableAction?.type !== 'drop-confirm') return;
    try {
      await executeSqls(tableAction.sqls);
      const children = await loadTables();
      setTreeData((prev) => prev.map((n) => (n.type === 'database' ? { ...n, children } : n)));
      setTableAction(null);
    } catch (error) {
      log.error(`[useTableActions] DROP failed: ${error}`);
      onDdlError?.(error);
    }
  }, [tableAction, executeSqls, loadTables, setTreeData, onDdlError]);

  const confirmTruncate = useCallback(async () => {
    if (tableAction?.type !== 'truncate-confirm') return;
    try {
      await executeSqls(tableAction.sqls);
      setTableAction(null);
    } catch (error) {
      log.error(`[useTableActions] TRUNCATE failed: ${error}`);
      onDdlError?.(error);
    }
  }, [tableAction, executeSqls, onDdlError]);

  const dismiss = useCallback(() => setTableAction(null), []);

  return {
    tableAction,
    getTableMenuItems,
    requestDrop,
    requestTruncate,
    confirmDrop,
    confirmTruncate,
    dismiss,
  };
}
