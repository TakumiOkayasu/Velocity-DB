import { memo } from 'react'
import type { DatabaseObject } from '../../types'
import styles from './TreeNode.module.css'

interface TreeNodeProps {
  node: DatabaseObject;
  level: number;
  expandedNodes: Set<string>;
  loadingNodes?: Set<string>;
  onToggle: (id: string) => void;
}

const getIcon = (type: DatabaseObject['type'] | 'folder'): string => {
  switch (type) {
    case 'database':
      return '🗄️'
    case 'folder':
      return '📁'
    case 'table':
      return '📋'
    case 'view':
      return '👁️'
    case 'procedure':
      return '⚙️'
    case 'function':
      return 'ƒ'
    case 'column':
      return '│'
    case 'index':
      return '📑'
    default:
      return '📄'
  }
}

export const TreeNode = memo(function TreeNode({ node, level, expandedNodes, loadingNodes, onToggle }: TreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0
  const canExpand = hasChildren || node.type === 'table' // Tables can lazy-load columns
  const isExpanded = expandedNodes.has(node.id)
  const isLoading = loadingNodes?.has(node.id)

  const handleClick = () => {
    if (canExpand) {
      onToggle(node.id)
    }
  }

  const handleDoubleClick = () => {
    // TODO: Open table data or definition
    console.log('Double click:', node)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    // TODO: Show context menu
    console.log('Context menu:', node)
  }

  const getExpander = () => {
    if (isLoading) return '⏳'
    if (canExpand) return isExpanded ? '▼' : '▶'
    return ' '
  }

  return (
    <div className={styles.container}>
      <div
        className={`${styles.node} ${isLoading ? styles.loading : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <span className={styles.expander}>
          {getExpander()}
        </span>
        <span className={styles.icon}>{getIcon(node.type)}</span>
        <span className={styles.name}>{node.name}</span>
      </div>

      {hasChildren && isExpanded && (
        <div className={styles.children}>
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              loadingNodes={loadingNodes}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
})
