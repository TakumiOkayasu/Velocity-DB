import type { DatabaseObject } from '../../types'
import styles from './TreeNode.module.css'

interface TreeNodeProps {
  node: DatabaseObject;
  level: number;
  expandedNodes: Set<string>;
  onToggle: (id: string) => void;
}

const getIcon = (type: DatabaseObject['type']): string => {
  switch (type) {
    case 'database':
      return '🗄️'
    case 'table':
      return '📋'
    case 'view':
      return '👁️'
    case 'procedure':
      return '⚙️'
    case 'function':
      return '𝑓'
    case 'column':
      return '│'
    case 'index':
      return '📑'
    default:
      return '📄'
  }
}

export function TreeNode({ node, level, expandedNodes, onToggle }: TreeNodeProps) {
  const hasChildren = node.children && node.children.length > 0
  const isExpanded = expandedNodes.has(node.id)

  const handleClick = () => {
    if (hasChildren) {
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

  return (
    <div className={styles.container}>
      <div
        className={styles.node}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        <span className={styles.expander}>
          {hasChildren ? (isExpanded ? '▼' : '▶') : ' '}
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
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}
