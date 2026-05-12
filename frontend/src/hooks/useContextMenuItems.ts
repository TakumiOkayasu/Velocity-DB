import { type Dispatch, type SetStateAction, useCallback } from 'react';
import { schemaProvider } from '../api/providers';
import type { ToastType } from '../store/toastStore';
import type { DatabaseObject, DatabaseType, MenuItem } from '../types';
import { log } from '../utils/logger';
import { buildInsertTemplateSql, buildSelectSql } from '../utils/sqlIdentifier';
import { type ExpandableType, extractBareTableName, isExpandableType } from '../utils/treeNode';

interface UseContextMenuItemsParams {
  connectionId: string;
  dbType?: DatabaseType;
  onTableOpen?: (tableName: string, tableType: ExpandableType, connectionId?: string) => void;
  loadTables: () => Promise<DatabaseObject[]>;
  setTreeData: Dispatch<SetStateAction<DatabaseObject[]>>;
  setLoadingNodes: Dispatch<SetStateAction<Set<string>>>;
  getColumnMenuItems: (node: DatabaseObject) => MenuItem[];
  getTableMenuItems: (node: DatabaseObject) => MenuItem[];
  copyToClipboard: (text: string, successMessage: string) => Promise<void>;
  addToast: (message: string, type: ToastType) => void;
  closeConnection: (connectionId: string) => Promise<void>;
}

const DIVIDER: MenuItem = { label: '', action: () => {}, divider: true };

export function useContextMenuItems({
  connectionId,
  dbType,
  onTableOpen,
  loadTables,
  setTreeData,
  setLoadingNodes,
  getColumnMenuItems,
  getTableMenuItems,
  copyToClipboard,
  addToast,
  closeConnection,
}: UseContextMenuItemsParams) {
  const buildTableOrViewItems = useCallback(
    (node: DatabaseObject): MenuItem[] => {
      const items: MenuItem[] = [];

      items.push({
        label: 'SELECT文をコピー',
        action: async () => {
          await navigator.clipboard.writeText(buildSelectSql(node.name, dbType));
        },
      });

      if (node.type === 'table') {
        items.push({
          label: 'INSERT文をコピー',
          action: async () => {
            try {
              const columns = await schemaProvider.getColumns(
                connectionId,
                extractBareTableName(node.name)
              );
              const sql = buildInsertTemplateSql(
                node.name,
                columns.map((c) => c.name),
                dbType
              );
              await copyToClipboard(sql, 'INSERT文をコピーしました');
            } catch (error) {
              log.error(`Failed to build INSERT template: ${error}`);
              addToast('INSERT文の生成に失敗しました', 'error');
            }
          },
        });
      }

      items.push({
        label: 'データを開く',
        action: () => {
          if (onTableOpen && isExpandableType(node.type)) {
            onTableOpen(node.name, node.type, connectionId);
          }
        },
      });

      items.push(DIVIDER);

      items.push({
        label: 'カラム一覧をコピー',
        action: async () => {
          try {
            const columns = await schemaProvider.getColumns(
              connectionId,
              extractBareTableName(node.name)
            );
            const columnList = columns.map((c) => c.name).join(', ');
            await navigator.clipboard.writeText(columnList);
          } catch (error) {
            log.error(`Failed to get columns: ${error}`);
          }
        },
      });

      const tableItems = getTableMenuItems(node);
      if (tableItems.length > 0) {
        items.push(DIVIDER);
        items.push(...tableItems);
      }

      return items;
    },
    [connectionId, dbType, onTableOpen, copyToClipboard, getTableMenuItems, addToast]
  );

  const buildDatabaseItems = useCallback((): MenuItem[] => {
    return [
      {
        label: 'リフレッシュ',
        action: async () => {
          setLoadingNodes((prev) => new Set(prev).add(connectionId));
          const children = await loadTables();
          setTreeData((prev) => prev.map((n) => (n.id === connectionId ? { ...n, children } : n)));
          setLoadingNodes((prev) => {
            const next = new Set(prev);
            next.delete(connectionId);
            return next;
          });
        },
      },
      DIVIDER,
      {
        label: '接続を閉じる',
        action: async () => {
          await closeConnection(connectionId);
        },
      },
    ];
  }, [connectionId, loadTables, setTreeData, setLoadingNodes, closeConnection]);

  const getMenuItems = useCallback(
    (node: DatabaseObject): MenuItem[] => {
      if (node.type === 'table' || node.type === 'view') {
        return buildTableOrViewItems(node);
      }
      if (node.type === 'database') {
        return buildDatabaseItems();
      }
      if (node.type === 'column') {
        return getColumnMenuItems(node);
      }
      return [];
    },
    [buildTableOrViewItems, buildDatabaseItems, getColumnMenuItems]
  );

  return { getMenuItems };
}
