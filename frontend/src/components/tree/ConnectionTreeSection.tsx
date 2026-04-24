import { useCallback, useEffect, useMemo, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useColumnActions } from '../../hooks/useColumnActions';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useTableActions } from '../../hooks/useTableActions';
import { useConnectionStore } from '../../store/connectionStore';
import { useToastStore } from '../../store/toastStore';
import type { Connection, DatabaseObject, MenuItem } from '../../types';
import { connectionColor } from '../../utils/colorContrast';
import { log } from '../../utils/logger';
import { buildInsertTemplateSql, buildSelectSql } from '../../utils/sqlIdentifier';
import {
  type ExpandableType,
  extractBareTableName,
  isExpandableType,
  parseTableNodeId,
  shouldLoadColumns,
  updateNodeChildren,
} from '../../utils/treeNode';
import { ContextMenu } from './ContextMenu';
import styles from './ObjectTree.module.css';
import { TreeDialogs } from './TreeDialogs';
import { TreeNode } from './TreeNode';

interface ConnectionTreeSectionProps {
  connection: Connection;
  filter: string;
  onTableOpen?: (tableName: string, tableType: ExpandableType, connectionId?: string) => void;
}

export function ConnectionTreeSection({
  connection,
  filter,
  onTableOpen,
}: ConnectionTreeSectionProps) {
  const [treeData, setTreeData] = useState<DatabaseObject[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(() => new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: DatabaseObject;
  } | null>(null);

  // Load tables for this connection
  const loadTables = useCallback(async (): Promise<DatabaseObject[]> => {
    try {
      log.info(`[ConnectionTreeSection] Loading tables for connection: ${connection.id}`);

      const { tables, loadTimeMs } = await bridge.getTables(connection.id, '');

      // Store the load time in connection store
      useConnectionStore.getState().setTableListLoadTime(connection.id, loadTimeMs);

      log.info(
        `[ConnectionTreeSection] Loaded ${tables.length} tables/views in ${loadTimeMs.toFixed(2)}ms`
      );

      const tableNodes: DatabaseObject[] = [];
      const viewNodes: DatabaseObject[] = [];

      for (const table of tables) {
        // Always use physical table name (not logical name)
        const displayName = table.schema !== 'dbo' ? `${table.schema}.${table.name}` : table.name;

        const node: DatabaseObject = {
          id: `${connection.id}-${table.schema}-${table.name}`,
          name: displayName,
          type: table.type === 'VIEW' ? 'view' : 'table',
          children: [], // Will be loaded on expand
          metadata: {
            comment: table.comment || '',
          },
        };

        if (table.type === 'VIEW') {
          viewNodes.push(node);
        } else {
          tableNodes.push(node);
        }
      }

      return [
        {
          id: `${connection.id}-tables`,
          name: `Tables (${tableNodes.length})`,
          type: 'folder' as const,
          children: tableNodes,
        },
        {
          id: `${connection.id}-views`,
          name: `Views (${viewNodes.length})`,
          type: 'folder' as const,
          children: viewNodes,
        },
      ];
    } catch (error) {
      log.error(`[ConnectionTreeSection] Failed to load tables: ${error}`);
      return [];
    }
  }, [connection.id]);

  // Load columns for a table
  const loadColumns = useCallback(
    async (
      schemaName: string,
      tableName: string,
      objectType: 'table' | 'view' = 'table'
    ): Promise<DatabaseObject[]> => {
      try {
        log.debug(`[ConnectionTreeSection] Loading columns for table: ${tableName}`);
        const columns = await bridge.getColumns(connection.id, tableName);
        log.debug(`[ConnectionTreeSection] Loaded ${columns.length} columns for ${tableName}`);
        return columns.map((col) => {
          return {
            id: `${connection.id}-${schemaName}-${tableName}-${col.name}`,
            name: `${col.name} (${col.type}${col.isPrimaryKey ? ', PK' : ''}${col.nullable ? '' : ', NOT NULL'})`,
            type: 'column' as const,
            metadata: {
              schema: schemaName,
              tableName,
              isPrimaryKey: col.isPrimaryKey,
              nullable: col.nullable,
              columnType: col.type,
              objectType,
            },
          };
        });
      } catch (error) {
        log.error(`[ConnectionTreeSection] Failed to load columns: ${error}`);
        return [];
      }
    },
    [connection.id]
  );

  // Hook: column DDL actions + menu items + dialog state (提供層)
  const {
    columnAction,
    getColumnMenuItems,
    handleRenameInput,
    handleRenameConfirm,
    handleDropConfirm,
    dismiss,
  } = useColumnActions({
    connectionId: connection.id,
    dbType: connection.dbType,
    isReadOnly: connection.isReadOnly,
    loadColumns,
    setTreeData,
  });

  // Hook: table DDL actions (DROP / TRUNCATE)
  const {
    tableAction,
    getTableMenuItems,
    confirmDrop: confirmTableDrop,
    confirmTruncate,
    dismiss: dismissTableAction,
  } = useTableActions({
    connectionId: connection.id,
    dbType: connection.dbType,
    loadTables,
    setTreeData,
  });

  const copyToClipboard = useCopyToClipboard();

  // Build tree when connection changes
  useEffect(() => {
    let isCancelled = false;

    const buildTree = async () => {
      const dbNode: DatabaseObject = {
        id: connection.id,
        name: `${connection.server}/${connection.database}`,
        type: 'database',
        children: [],
      };

      setExpandedNodes(new Set([connection.id]));

      // Load tables
      setLoadingNodes((prev) => new Set(prev).add(connection.id));
      const children = await loadTables();

      // Check if effect was cancelled during async operation
      if (isCancelled) return;

      dbNode.children = children;
      setTreeData([dbNode]);
      setLoadingNodes((prev) => {
        const next = new Set(prev);
        next.delete(connection.id);
        return next;
      });
    };

    buildTree();

    // Cleanup function to prevent stale updates
    return () => {
      isCancelled = true;
    };
  }, [connection.id, connection.server, connection.database, loadTables]);

  // Handle node toggle with lazy loading for table columns
  const toggleNode = useCallback(
    async (id: string, node: DatabaseObject) => {
      const isExpanding = !expandedNodes.has(id);

      setExpandedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });

      // Lazy load columns when expanding a table or view
      if (isExpanding && shouldLoadColumns(node)) {
        setLoadingNodes((prev) => new Set(prev).add(id));

        // Extract schema and table name from structured node ID (W4)
        const parsed = parseTableNodeId(id, connection.id);
        const schemaName = parsed?.schema ?? 'dbo';
        const tableName = parsed?.tableName ?? node.name;
        const columns = await loadColumns(schemaName, tableName, node.type);

        // Update tree data with shared helper (W2)
        setTreeData((prev) => updateNodeChildren(prev, id, columns));

        setLoadingNodes((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [expandedNodes, loadColumns, connection.id]
  );

  const filterTree = useCallback(
    (nodes: DatabaseObject[]): DatabaseObject[] => {
      if (!filter.trim()) return nodes;

      const lowerFilter = filter.toLowerCase();

      return nodes
        .map((node) => {
          // DB nodes and folder nodes are always shown
          if (node.type === 'database' || node.type === 'folder') {
            const filteredChildren = node.children ? filterTree(node.children) : [];
            // Update folder count in name (e.g. "Tables (5)" → "Tables (2)")
            let displayName = node.name;
            if (node.type === 'folder') {
              const matchCount = filteredChildren.filter(
                (c) => c.type === 'table' || c.type === 'view'
              ).length;
              displayName = /\(\d+\)/.test(node.name)
                ? node.name.replace(/\(\d+\)/, `(${matchCount})`)
                : `${node.name} (${matchCount})`;
            }
            return { ...node, name: displayName, children: filteredChildren };
          }

          // Table/view: filter by name match
          const matchesFilter = node.name.toLowerCase().includes(lowerFilter);
          if (matchesFilter) return node;

          // Check comment/metadata match
          if (node.metadata?.comment) {
            const commentMatch = String(node.metadata.comment).toLowerCase().includes(lowerFilter);
            if (commentMatch) return node;
          }

          return null;
        })
        .filter((n): n is DatabaseObject => n !== null);
    },
    [filter]
  );

  const filteredData = filterTree(treeData);

  const handleTableOpen = useCallback(
    (nodeId: string, tableName: string, tableType: ExpandableType) => {
      setSelectedNodeId(nodeId);
      if (onTableOpen) {
        // Pass the connection ID along with table info
        onTableOpen(tableName, tableType, connection.id);
      }
    },
    [onTableOpen, connection.id]
  );

  // Context menu handlers
  const handleContextMenu = useCallback((e: React.MouseEvent, node: DatabaseObject) => {
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const getMenuItems = useCallback(
    (node: DatabaseObject): MenuItem[] => {
      const items: MenuItem[] = [];

      if (node.type === 'table' || node.type === 'view') {
        // SELECT文をコピー
        items.push({
          label: 'SELECT文をコピー',
          action: async () => {
            await navigator.clipboard.writeText(buildSelectSql(node.name, connection.dbType));
          },
        });

        // INSERT文をコピー (table のみ、view 除外)
        if (node.type === 'table') {
          items.push({
            label: 'INSERT文をコピー',
            action: async () => {
              try {
                const columns = await bridge.getColumns(
                  connection.id,
                  extractBareTableName(node.name)
                );
                const sql = buildInsertTemplateSql(
                  node.name,
                  columns.map((c) => c.name),
                  connection.dbType
                );
                await copyToClipboard(sql, 'INSERT文をコピーしました');
              } catch (error) {
                log.error(`Failed to build INSERT template: ${error}`);
                useToastStore.getState().addToast('INSERT文の生成に失敗しました', 'error');
              }
            },
          });
        }

        // テーブルを開く
        items.push({
          label: 'データを開く',
          action: () => {
            if (onTableOpen && isExpandableType(node.type)) {
              onTableOpen(node.name, node.type, connection.id);
            }
          },
        });

        items.push({ label: '', action: () => {}, divider: true });

        // カラム一覧をコピー
        items.push({
          label: 'カラム一覧をコピー',
          action: async () => {
            try {
              const columns = await bridge.getColumns(
                connection.id,
                extractBareTableName(node.name)
              );
              const columnList = columns.map((c) => c.name).join(', ');
              await navigator.clipboard.writeText(columnList);
            } catch (error) {
              log.error(`Failed to get columns: ${error}`);
            }
          },
        });

        // テーブル操作 (table のみ、view 除外)
        const tableItems = getTableMenuItems(node);
        if (tableItems.length > 0) {
          items.push({ label: '', action: () => {}, divider: true });
          items.push(...tableItems);
        }
      }

      if (node.type === 'database') {
        items.push({
          label: 'リフレッシュ',
          action: async () => {
            // Re-load tables
            setLoadingNodes((prev) => new Set(prev).add(connection.id));
            const children = await loadTables();
            setTreeData((prev) => {
              return prev.map((n) => {
                if (n.id === connection.id) {
                  return { ...n, children };
                }
                return n;
              });
            });
            setLoadingNodes((prev) => {
              const next = new Set(prev);
              next.delete(connection.id);
              return next;
            });
          },
        });

        items.push({ label: '', action: () => {}, divider: true });

        items.push({
          label: '接続を閉じる',
          action: async () => {
            await useConnectionStore.getState().removeConnection(connection.id);
          },
        });
      }

      if (node.type === 'column') {
        items.push(...getColumnMenuItems(node));
      }

      return items;
    },
    [
      connection.id,
      connection.dbType,
      onTableOpen,
      loadTables,
      getColumnMenuItems,
      getTableMenuItems,
      copyToClipboard,
    ]
  );

  const connColor = useMemo(
    () => connectionColor(connection.server, connection.database),
    [connection.server, connection.database]
  );

  if (treeData.length === 0) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div>
      {filteredData.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          level={0}
          expandedNodes={expandedNodes}
          loadingNodes={loadingNodes}
          selectedNodeId={selectedNodeId}
          connectionColor={connColor}
          environment={connection.environment}
          onToggle={toggleNode}
          onTableOpen={handleTableOpen}
          onContextMenu={handleContextMenu}
        />
      ))}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getMenuItems(contextMenu.node)}
          onClose={handleCloseContextMenu}
        />
      )}

      <TreeDialogs
        columnAction={columnAction}
        tableAction={tableAction}
        onRenameInput={handleRenameInput}
        onRenameConfirm={handleRenameConfirm}
        onDropColumnConfirm={handleDropConfirm}
        onDismissColumn={dismiss}
        onDropTableConfirm={confirmTableDrop}
        onTruncateConfirm={confirmTruncate}
        onDismissTable={dismissTableAction}
      />
    </div>
  );
}
