import { memo } from 'react';
import type { DatabaseObject } from '../../types';
import styles from './TreeNode.module.css';

interface TreeNodeProps {
  node: DatabaseObject;
  level: number;
  expandedNodes: Set<string>;
  loadingNodes?: Set<string>;
  selectedNodeId?: string | null;
  onToggle: (id: string, node: DatabaseObject) => void;
  onTableOpen?: (nodeId: string, tableName: string, tableType: 'table' | 'view') => void;
}

// SVG Icons for tree nodes
const Icons = {
  database: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M2 3.5A1.5 1.5 0 013.5 2h2.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.622 4H12.5A1.5 1.5 0 0114 5.5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9z" />
    </svg>
  ),
  folderOpen: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 13.25V3.5A1.5 1.5 0 013 2h3.379a1.5 1.5 0 011.06.44l.94.94a.5.5 0 00.354.147H13.5A1.5 1.5 0 0115 5v.5H2V3.5a.5.5 0 01.5-.5h3.379a.5.5 0 01.354.146l.94.94A1.5 1.5 0 008.233 4.5H13.5a.5.5 0 01.5.5v.5H2v7.75a.75.75 0 00.75.75h10.5a.75.75 0 00.75-.75V6h1v7.25a1.75 1.75 0 01-1.75 1.75H2.75a1.75 1.75 0 01-1.25-2z" />
    </svg>
  ),
  table: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M2 5h12M2 8h12M2 11h12M6 5v9M10 5v9" />
    </svg>
  ),
  view: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2.5" />
    </svg>
  ),
  column: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M4 4v8M8 8h4" />
    </svg>
  ),
  key: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M5.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zm0-1a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
      <path d="M7.5 6.5h6v1h-6z" />
      <path d="M11.5 6.5v3h-1v-3zM13.5 6.5v2h-1v-2z" />
    </svg>
  ),
  loading: (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={styles.loadingSpinner}
    >
      <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
    </svg>
  ),
  chevronRight: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M6 4l4 4-4 4" />
    </svg>
  ),
  chevronDown: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 6l4 4 4-4" />
    </svg>
  ),
};

const getIcon = (type: DatabaseObject['type'] | 'folder', isExpanded?: boolean): JSX.Element => {
  switch (type) {
    case 'database':
      return Icons.database;
    case 'folder':
      return isExpanded ? Icons.folderOpen : Icons.folder;
    case 'table':
      return Icons.table;
    case 'view':
      return Icons.view;
    case 'column':
      return Icons.column;
    case 'index':
      return Icons.key;
    default:
      return Icons.column;
  }
};

const getIconClass = (type: DatabaseObject['type'] | 'folder'): string => {
  switch (type) {
    case 'database':
      return styles.iconDatabase;
    case 'folder':
      return styles.iconFolder;
    case 'table':
      return styles.iconTable;
    case 'view':
      return styles.iconView;
    default:
      return styles.iconColumn;
  }
};

export const TreeNode = memo(function TreeNode({
  node,
  level,
  expandedNodes,
  loadingNodes,
  selectedNodeId,
  onToggle,
  onTableOpen,
}: TreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  const canExpand = hasChildren || node.type === 'table'; // Tables can lazy-load columns
  const isExpanded = expandedNodes.has(node.id);
  const isLoading = loadingNodes?.has(node.id);
  const isSelected = selectedNodeId === node.id;

  const handleClick = () => {
    // For tables/views, single click opens data; arrow click expands columns
    if ((node.type === 'table' || node.type === 'view') && onTableOpen) {
      onTableOpen(node.id, node.name, node.type);
    } else if (canExpand) {
      onToggle(node.id, node);
    }
  };

  const handleExpanderClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canExpand) {
      onToggle(node.id, node);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // TODO: Show context menu
    console.log('Context menu:', node);
  };

  const nodeClasses = [
    styles.node,
    isLoading ? styles.loading : '',
    isSelected ? styles.selected : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.container}>
      <div
        className={nodeClasses}
        style={{ paddingLeft: `${level * 12 + 4}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span
          className={styles.expander}
          onClick={handleExpanderClick}
          role="button"
          tabIndex={-1}
          style={{ visibility: canExpand ? 'visible' : 'hidden' }}
        >
          {isLoading ? Icons.loading : isExpanded ? Icons.chevronDown : Icons.chevronRight}
        </span>
        <span className={`${styles.icon} ${getIconClass(node.type)}`}>
          {getIcon(node.type, isExpanded)}
        </span>
        <span className={styles.name}>{node.name}</span>
      </div>

      {hasChildren && isExpanded && (
        <div className={styles.children}>
          {node.children?.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              loadingNodes={loadingNodes}
              selectedNodeId={selectedNodeId}
              onToggle={onToggle}
              onTableOpen={onTableOpen}
            />
          ))}
        </div>
      )}
    </div>
  );
});
