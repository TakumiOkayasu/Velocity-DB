import { useCallback, useMemo } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { TableNode } from './TableNode'
import type { ERTableNode, ERRelationEdge } from '../../types'
import styles from './ERDiagram.module.css'

interface ERDiagramProps {
  tables: ERTableNode[]
  relations: ERRelationEdge[]
  onTableClick?: (tableId: string) => void
}

const nodeTypes = {
  table: TableNode,
}

export function ERDiagram({ tables, relations, onTableClick }: ERDiagramProps) {
  const initialNodes: Node[] = useMemo(() => {
    return tables.map((table) => ({
      id: table.id,
      type: 'table',
      position: table.position,
      data: table.data,
    }))
  }, [tables])

  const initialEdges: Edge[] = useMemo(() => {
    return relations.map((rel) => ({
      id: rel.id,
      source: rel.source,
      target: rel.target,
      type: 'smoothstep',
      animated: false,
      label: rel.data.cardinality,
      labelStyle: { fontSize: 10, fill: '#888' },
      labelBgStyle: { fill: '#1e1e1e', fillOpacity: 0.8 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 15,
        color: '#888',
      },
      style: { stroke: '#888', strokeWidth: 1 },
    }))
  }, [relations])

  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onTableClick?.(node.id)
    },
    [onTableClick]
  )

  return (
    <div className={styles.container}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
        <Controls />
      </ReactFlow>
    </div>
  )
}
