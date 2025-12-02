import { useState } from 'react'
import { TreeNode } from './TreeNode'
import type { DatabaseObject } from '../../types'
import styles from './ObjectTree.module.css'

interface ObjectTreeProps {
  filter: string;
}

// Mock data for development
const mockData: DatabaseObject[] = [
  {
    id: 'db-1',
    name: 'SampleDatabase',
    type: 'database',
    children: [
      {
        id: 'tables',
        name: 'Tables',
        type: 'table',
        children: [
          {
            id: 'table-users',
            name: 'Users',
            type: 'table',
            children: [
              { id: 'col-id', name: 'id (int, PK)', type: 'column' },
              { id: 'col-name', name: 'name (nvarchar)', type: 'column' },
              { id: 'col-email', name: 'email (nvarchar)', type: 'column' },
            ],
          },
          {
            id: 'table-orders',
            name: 'Orders',
            type: 'table',
            children: [
              { id: 'col-order-id', name: 'id (int, PK)', type: 'column' },
              { id: 'col-user-id', name: 'user_id (int, FK)', type: 'column' },
              { id: 'col-total', name: 'total (decimal)', type: 'column' },
            ],
          },
        ],
      },
      {
        id: 'views',
        name: 'Views',
        type: 'view',
        children: [
          { id: 'view-active-users', name: 'ActiveUsers', type: 'view' },
        ],
      },
      {
        id: 'procedures',
        name: 'Stored Procedures',
        type: 'procedure',
        children: [
          { id: 'sp-get-user', name: 'GetUserById', type: 'procedure' },
        ],
      },
    ],
  },
]

export function ObjectTree({ filter }: ObjectTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['db-1', 'tables']))

  const toggleNode = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const filterTree = (nodes: DatabaseObject[]): DatabaseObject[] => {
    if (!filter.trim()) return nodes

    const lowerFilter = filter.toLowerCase()

    const result: DatabaseObject[] = []
    for (const node of nodes) {
      const matchesFilter = node.name.toLowerCase().includes(lowerFilter)
      const filteredChildren = node.children ? filterTree(node.children) : []

      if (matchesFilter || filteredChildren.length > 0) {
        result.push({
          ...node,
          children: filteredChildren.length > 0 ? filteredChildren : node.children,
        })
      }
    }
    return result
  }

  const filteredData = filterTree(mockData)

  return (
    <div className={styles.container}>
      {filteredData.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          level={0}
          expandedNodes={expandedNodes}
          onToggle={toggleNode}
        />
      ))}
    </div>
  )
}
