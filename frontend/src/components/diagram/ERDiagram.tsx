import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  ReactFlow,
  useNodesState,
} from '@xyflow/react';
import { useCallback, useMemo, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { useERDiagramContext } from '../../hooks/useERDiagramContext';
import type { ERRelationEdge, ERShapeNode, ERTableNode } from '../../types';
import { ALL_PAGES, GRID_LAYOUT } from '../../utils/erDiagramConstants';
import styles from './ERDiagram.module.css';
import { ShapeNode } from './ShapeNode';
import { TableNode } from './TableNode';

interface ERDiagramProps {
  onTableClick?: (tableId: string) => void;
  onOpenImportDialog?: () => void;
}

type XY = { x: number; y: number };
type PosMap = Map<string, XY>;

const nodeTypes = {
  table: TableNode,
  shape: ShapeNode,
};

const DEFAULT_HANDLES = { sourceHandle: 'source-right', targetHandle: 'target-left' };

/** ノード位置から最適なHandle方向を選択 */
function getBestHandles(
  sourcePos: XY,
  targetPos: XY
): { sourceHandle: string; targetHandle: string } {
  const dx = targetPos.x - sourcePos.x;
  const dy = targetPos.y - sourcePos.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: 'source-right', targetHandle: 'target-left' }
      : { sourceHandle: 'source-left', targetHandle: 'target-right' };
  }
  return dy >= 0
    ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
    : { sourceHandle: 'source-top', targetHandle: 'target-bottom' };
}

/** リレーションからEdge配列を生成（posMapベース） */
function buildEdges(relations: ERRelationEdge[], posMap: PosMap): Edge[] {
  return relations.map((rel) => {
    const srcPos = posMap.get(rel.source);
    const tgtPos = posMap.get(rel.target);
    const handles = srcPos && tgtPos ? getBestHandles(srcPos, tgtPos) : DEFAULT_HANDLES;

    return {
      id: rel.id,
      source: rel.source,
      target: rel.target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: 'smoothstep',
      animated: false,
      label: rel.data.cardinality,
      labelStyle: { fontSize: 11, fill: '#bbb' },
      labelBgStyle: { fill: '#2b2d30', fillOpacity: 0.9 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 15,
        height: 15,
        color: '#666',
      },
      style: { stroke: '#666', strokeWidth: 1 },
    };
  });
}

/** 「すべて」タブ時のグリッド再配置 */
function applyGridLayout(tables: ERTableNode[]): ERTableNode[] {
  const { columns, nodeWidth, nodeHeight, gap } = GRID_LAYOUT;
  return tables.map((t, i) => ({
    ...t,
    position: {
      x: (i % columns) * (nodeWidth + gap),
      y: Math.floor(i / columns) * (nodeHeight + gap),
    },
  }));
}

function ERDiagramFlow({
  tables,
  relations,
  shapes,
  onTableClick,
}: {
  tables: ERTableNode[];
  relations: ERRelationEdge[];
  shapes: ERShapeNode[];
  onTableClick?: (tableId: string) => void;
}) {
  const initialNodes: Node[] = useMemo(() => {
    const shapeNodes: Node[] = shapes.map((shape) => ({
      id: shape.id,
      type: 'shape',
      position: shape.position,
      data: shape.data,
      zIndex: -1,
      selectable: false,
      draggable: false,
    }));

    const tableNodes: Node[] = tables.map((table) => ({
      id: table.id,
      type: 'table',
      position: table.position,
      data: table.data,
    }));

    return [...shapeNodes, ...tableNodes];
  }, [tables, shapes]);

  const [nodes, , onNodesChange] = useNodesState(initialNodes);

  // エッジ用ポジション: ドラッグ終了時のみ更新（毎フレーム再計算を回避）
  const [edgePosMap, setEdgePosMap] = useState<PosMap>(
    () => new Map(tables.map((t) => [t.id, t.position]))
  );

  const edges: Edge[] = useMemo(() => buildEdges(relations, edgePosMap), [relations, edgePosMap]);

  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, _node: Node, draggedNodes: Node[]) => {
      setEdgePosMap((prev) => {
        const next = new Map(prev);
        for (const n of draggedNodes) {
          next.set(n.id, n.position);
        }
        return next;
      });
    },
    []
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onTableClick?.(node.id);
    },
    [onTableClick]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onNodeDragStop={handleNodeDragStop}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      fitView
      minZoom={0.1}
      maxZoom={2}
      defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
      <Controls />
    </ReactFlow>
  );
}

export function ERDiagram({ onTableClick, onOpenImportDialog }: ERDiagramProps) {
  const {
    pages,
    selectedPage,
    setSelectedPage,
    pageCounts,
    totalTableCount,
    tables: filteredTables,
    relations: filteredRelations,
    shapes: filteredShapes,
  } = useERDiagramContext();

  const hasData = totalTableCount > 0;

  // 「すべて」タブ時はグリッド再配置（ページ間で座標が重複するため）
  const layoutTables = useMemo(
    () => (selectedPage === ALL_PAGES ? applyGridLayout(filteredTables) : filteredTables),
    [filteredTables, selectedPage]
  );

  // 「すべて」タブ時はShape非表示（テーブルがグリッド再配置され元座標とずれるため）
  const layoutShapes = useMemo(
    () => (selectedPage === ALL_PAGES ? [] : filteredShapes),
    [filteredShapes, selectedPage]
  );

  const showTabs = pages.length > 1;

  // key を変えることで ReactFlow を再マウントし、fitView をリトリガー
  const flowKey = useMemo(() => {
    const first = layoutTables[0]?.id ?? '';
    const last = layoutTables[layoutTables.length - 1]?.id ?? '';
    return `${selectedPage}-${layoutTables.length}-${layoutShapes.length}-${first}-${last}`;
  }, [selectedPage, layoutTables, layoutShapes]);

  if (!hasData) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>ER図データがありません</p>
          {onOpenImportDialog && (
            <button type="button" className={styles.importButton} onClick={onOpenImportDialog}>
              ER図ファイルを読み込む
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {(showTabs || onOpenImportDialog) && (
        <div className={styles.tabBar}>
          {showTabs && (
            <>
              <button
                type="button"
                className={`${styles.tab} ${selectedPage === ALL_PAGES ? styles.tabActive : ''}`}
                onClick={() => setSelectedPage(ALL_PAGES)}
              >
                すべて ({pageCounts.get(ALL_PAGES) ?? 0})
              </button>
              {pages.map((page) => (
                <button
                  type="button"
                  key={page}
                  className={`${styles.tab} ${selectedPage === page ? styles.tabActive : ''}`}
                  onClick={() => setSelectedPage(page)}
                >
                  {page} ({pageCounts.get(page) ?? 0})
                </button>
              ))}
            </>
          )}
          {onOpenImportDialog && (
            <button
              type="button"
              className={styles.tabImportButton}
              onClick={onOpenImportDialog}
              title="ER図ファイルをインポート"
            >
              {'\uD83D\uDCE5'}
            </button>
          )}
        </div>
      )}
      <div className={styles.flowContainer}>
        <ERDiagramFlow
          key={flowKey}
          tables={layoutTables}
          relations={filteredRelations}
          shapes={layoutShapes}
          onTableClick={onTableClick}
        />
      </div>
    </div>
  );
}
