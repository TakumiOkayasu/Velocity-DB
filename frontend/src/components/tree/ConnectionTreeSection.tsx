import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import type { Connection, DatabaseObject } from '../../types';
import { log } from '../../utils/logger';
import styles from './ObjectTree.module.css';
import { TreeNode } from './TreeNode';

interface ConnectionTreeSectionProps {
  connection: Connection;
  filter: string;
  onTableOpen?: (tableName: string, tableType: 'table' | 'view', connectionId?: string) => void;
}

export function ConnectionTreeSection({
  connection,
  filter,
  onTableOpen,
}: ConnectionTreeSectionProps) {
  const [treeData, setTreeData] = useState<DatabaseObject[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
    async (tableName: string): Promise<DatabaseObject[]> => {
      try {
        log.debug(`[ConnectionTreeSection] Loading columns for table: ${tableName}`);
        const columns = await bridge.getColumns(connection.id, tableName);
        log.debug(`[ConnectionTreeSection] Loaded ${columns.length} columns for ${tableName}`);
        return columns.map((col) => {
          // Always use physical column name in tree view
          return {
            id: `${connection.id}-${tableName}-${col.name}`,
            name: `${col.name} (${col.type}${col.isPrimaryKey ? ', PK' : ''}${col.nullable ? '' : ', NOT NULL'})`,
            type: 'column' as const,
          };
        });
      } catch (error) {
        log.error(`[ConnectionTreeSection] Failed to load columns: ${error}`);
        return [];
      }
    },
    [connection.id]
  );

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

      // Lazy load columns when expanding a table
      if (isExpanding && node.type === 'table' && (!node.children || node.children.length === 0)) {
        setLoadingNodes((prev) => new Set(prev).add(id));

        // Extract table name from node name
        const tableName = node.name.includes('.') ? node.name.split('.')[1] : node.name;
        const columns = await loadColumns(tableName);

        // Update tree data with columns
        setTreeData((prev) => {
          const updateNode = (nodes: DatabaseObject[]): DatabaseObject[] => {
            return nodes.map((n) => {
              if (n.id === id) {
                return { ...n, children: columns };
              }
              if (n.children) {
                return { ...n, children: updateNode(n.children) };
              }
              return n;
            });
          };
          return updateNode(prev);
        });

        setLoadingNodes((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [expandedNodes, loadColumns]
  );

  const filterTree = useCallback(
    (nodes: DatabaseObject[]): DatabaseObject[] => {
      if (!filter.trim()) return nodes;

      const lowerFilter = filter.toLowerCase();

      const result: DatabaseObject[] = [];
      for (const node of nodes) {
        const matchesFilter = node.name.toLowerCase().includes(lowerFilter);
        const filteredChildren = node.children ? filterTree(node.children) : [];

        if (matchesFilter || filteredChildren.length > 0) {
          result.push({
            ...node,
            children: filteredChildren.length > 0 ? filteredChildren : node.children,
          });
        }
      }
      return result;
    },
    [filter]
  );

  const filteredData = filterTree(treeData);

  const handleTableOpen = useCallback(
    (nodeId: string, tableName: string, tableType: 'table' | 'view') => {
      setSelectedNodeId(nodeId);
      if (onTableOpen) {
        // Pass the connection ID along with table info
        onTableOpen(tableName, tableType, connection.id);
      }
    },
    [onTableOpen, connection.id]
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
          onToggle={toggleNode}
          onTableOpen={handleTableOpen}
        />
      ))}
    </div>
  );
}
