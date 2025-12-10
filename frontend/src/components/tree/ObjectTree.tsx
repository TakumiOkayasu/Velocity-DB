import { useCallback, useEffect, useState } from 'react';
import { bridge } from '../../api/bridge';
import { useConnectionStore } from '../../store/connectionStore';
import type { DatabaseObject } from '../../types';
import { log } from '../../utils/logger';
import styles from './ObjectTree.module.css';
import { TreeNode } from './TreeNode';

interface ObjectTreeProps {
  filter: string;
  onTableOpen?: (tableName: string, tableType: 'table' | 'view') => void;
}

export function ObjectTree({ filter, onTableOpen }: ObjectTreeProps) {
  const { connections, activeConnectionId } = useConnectionStore();
  const [treeData, setTreeData] = useState<DatabaseObject[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const activeConnection = connections.find((c) => c.id === activeConnectionId);

  // Load tables for a connection
  const loadTables = useCallback(
    async (connectionId: string): Promise<DatabaseObject[]> => {
      try {
        log.info(`[ObjectTree] Loading tables for connection: ${connectionId}`);

        // Call updated API that returns timing info
        const { tables, loadTimeMs } = await bridge.getTables(connectionId, '');

        // Store the load time in connection store (using getState to avoid dependency)
        useConnectionStore.getState().setTableListLoadTime(connectionId, loadTimeMs);

        log.info(`[ObjectTree] Loaded ${tables.length} tables/views in ${loadTimeMs.toFixed(2)}ms`);

        const tableNodes: DatabaseObject[] = [];
        const viewNodes: DatabaseObject[] = [];

        for (const table of tables) {
          const node: DatabaseObject = {
            id: `${connectionId}-${table.schema}-${table.name}`,
            name: table.schema !== 'dbo' ? `${table.schema}.${table.name}` : table.name,
            type: table.type === 'VIEW' ? 'view' : 'table',
            children: [], // Will be loaded on expand
          };

          if (table.type === 'VIEW') {
            viewNodes.push(node);
          } else {
            tableNodes.push(node);
          }
        }

        log.info(
          `[ObjectTree] Categorized: ${tableNodes.length} tables, ${viewNodes.length} views`
        );

        return [
          {
            id: `${connectionId}-tables`,
            name: 'Tables',
            type: 'folder' as const,
            children: tableNodes,
          },
          {
            id: `${connectionId}-views`,
            name: 'Views',
            type: 'folder' as const,
            children: viewNodes,
          },
        ];
      } catch (error) {
        log.error(`[ObjectTree] Failed to load tables: ${error}`);
        return [];
      }
    },
    [] // No dependencies - stable function
  );

  // Load columns for a table
  const loadColumns = useCallback(
    async (connectionId: string, tableName: string): Promise<DatabaseObject[]> => {
      try {
        log.debug(`[ObjectTree] Loading columns for table: ${tableName}`);
        const columns = await bridge.getColumns(connectionId, tableName);
        log.debug(`[ObjectTree] Loaded ${columns.length} columns for ${tableName}`);
        return columns.map((col) => ({
          id: `${connectionId}-${tableName}-${col.name}`,
          name: `${col.name} (${col.type}${col.isPrimaryKey ? ', PK' : ''}${col.nullable ? '' : ', NOT NULL'})`,
          type: 'column' as const,
        }));
      } catch (error) {
        log.error(`[ObjectTree] Failed to load columns: ${error}`);
        return [];
      }
    },
    []
  );

  // Build tree when connection changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeConnection creates new object reference each render, causing infinite loop. Only activeConnectionId needed.
  useEffect(() => {
    if (!activeConnectionId || !activeConnection) {
      setTreeData([]);
      return;
    }

    // Use AbortController to prevent race conditions when connection changes rapidly
    let isCancelled = false;

    const buildTree = async () => {
      const dbNode: DatabaseObject = {
        id: activeConnectionId,
        name: `${activeConnection.server}/${activeConnection.database}`,
        type: 'database',
        children: [],
      };

      setExpandedNodes(new Set([activeConnectionId]));

      // Load tables
      setLoadingNodes((prev) => new Set(prev).add(activeConnectionId));
      const children = await loadTables(activeConnectionId);

      // Check if effect was cancelled during async operation
      if (isCancelled) return;

      dbNode.children = children;
      setTreeData([dbNode]);
      setLoadingNodes((prev) => {
        const next = new Set(prev);
        next.delete(activeConnectionId);
        return next;
      });
    };

    buildTree();

    // Cleanup function to prevent stale updates
    return () => {
      isCancelled = true;
    };
  }, [activeConnectionId, loadTables]);

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
      if (
        isExpanding &&
        activeConnectionId &&
        node.type === 'table' &&
        (!node.children || node.children.length === 0)
      ) {
        setLoadingNodes((prev) => new Set(prev).add(id));

        // Extract table name from node name
        const tableName = node.name.includes('.') ? node.name.split('.')[1] : node.name;
        const columns = await loadColumns(activeConnectionId, tableName);

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
    [expandedNodes, activeConnectionId, loadColumns]
  );

  const filterTree = (nodes: DatabaseObject[]): DatabaseObject[] => {
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
  };

  const filteredData = filterTree(treeData);

  const handleTableOpen = useCallback(
    (nodeId: string, tableName: string, tableType: 'table' | 'view') => {
      setSelectedNodeId(nodeId);
      if (onTableOpen) {
        onTableOpen(tableName, tableType);
      }
    },
    [onTableOpen]
  );

  if (!activeConnectionId) {
    return <div className={styles.noConnection}>No active connection</div>;
  }

  if (treeData.length === 0) {
    return <div className={styles.loading}>Loading...</div>;
  }

  return (
    <div className={styles.container}>
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
