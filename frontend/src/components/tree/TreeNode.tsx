import { memo, useMemo } from 'react';
import type { DatabaseObject, EnvironmentType } from '../../types';
import { type ExpandableType, isExpandableType } from '../../utils/treeNode';
import { TreeIcons } from '../icons/SvgIcons';
import styles from './TreeNode.module.css';

interface TreeNodeProps {
  node: DatabaseObject;
  level: number;
  expandedNodes: Set<string>;
  loadingNodes?: Set<string>;
  selectedNodeId?: string | null;
  connectionColor?: string;
  environment?: EnvironmentType;
  onToggle: (id: string, node: DatabaseObject) => void;
  onTableOpen?: (nodeId: string, tableName: string, tableType: ExpandableType) => void;
  onContextMenu?: (e: React.MouseEvent, node: DatabaseObject) => void;
}

const ENV_NAME_CLASS: Record<EnvironmentType, string> = {
  development: styles.nameEnvDevelopment,
  staging: styles.nameEnvStaging,
  production: styles.nameEnvProduction,
};

const getIcon = (
  type: DatabaseObject['type'] | 'folder',
  isExpanded?: boolean
): React.ReactElement => {
  switch (type) {
    case 'database':
      return <TreeIcons.Database />;
    case 'folder':
      return isExpanded ? <TreeIcons.FolderOpen /> : <TreeIcons.Folder />;
    case 'table':
      return <TreeIcons.Table />;
    case 'view':
      return <TreeIcons.View />;
    case 'column':
      return <TreeIcons.Column />;
    case 'index':
      return <TreeIcons.Key />;
    default:
      return <TreeIcons.Column />;
  }
};

const EXPANDER_VISIBLE = { visibility: 'visible' as const };
const EXPANDER_HIDDEN = { visibility: 'hidden' as const };

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
  connectionColor: connColor,
  environment,
  onToggle,
  onTableOpen,
  onContextMenu,
}: TreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0;
  const canExpand = hasChildren || isExpandableType(node.type);
  const isExpanded = expandedNodes.has(node.id);
  const isLoading = loadingNodes?.has(node.id);
  const isSelected = selectedNodeId === node.id;

  const handleClick = () => {
    // For tables/views, single click opens data; arrow click expands columns
    if (isExpandableType(node.type) && onTableOpen) {
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
    e.stopPropagation();
    onContextMenu?.(e, node);
  };

  const nodeClasses = `${styles.node}${isLoading ? ` ${styles.loading}` : ''}${isSelected ? ` ${styles.selected}` : ''}`;

  const envClass = node.type === 'database' && environment ? ENV_NAME_CLASS[environment] : '';
  const nameClasses = `${styles.name}${envClass ? ` ${envClass}` : ''}`;

  const nodeStyle = useMemo(
    () => ({
      paddingLeft: `${level * 12 + 4}px`,
      ...(node.type === 'database' && connColor ? { '--connection-color': connColor } : {}),
    }),
    [level, node.type, connColor]
  );

  return (
    <div className={styles.container}>
      <div
        className={nodeClasses}
        style={nodeStyle}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <span
          className={styles.expander}
          onClick={handleExpanderClick}
          role="button"
          tabIndex={-1}
          style={canExpand ? EXPANDER_VISIBLE : EXPANDER_HIDDEN}
        >
          {isLoading ? (
            <TreeIcons.Loading className={styles.loadingSpinner} />
          ) : isExpanded ? (
            <TreeIcons.ChevronDown />
          ) : (
            <TreeIcons.ChevronRight />
          )}
        </span>
        <span className={`${styles.icon} ${getIconClass(node.type)}`}>
          {getIcon(node.type, isExpanded)}
        </span>
        <span className={nameClasses}>{node.name}</span>
        {node.metadata?.comment && <span className={styles.comment}>{node.metadata.comment}</span>}
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
              connectionColor={connColor}
              onToggle={onToggle}
              onTableOpen={onTableOpen}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
});
