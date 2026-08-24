import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  type OnNodeDrag,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';
import { useERDiagramContext } from '../../hooks/useERDiagramContext';
import { useERDiagramStore } from '../../store/erDiagramStore';
import type { ERRelationEdge, ERShapeNode, ERTableNode } from '../../types';
import { ALL_PAGES, DEFAULT_PAGE, GRID_LAYOUT } from '../../utils/erDiagramConstants';
import { useERDiagramRenderMark } from '../../utils/perfMarks';
import styles from './ERDiagram.module.css';
import { ERDiagramSearch } from './ERDiagramSearch';
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

function toNodes(tables: ERTableNode[], shapes: ERShapeNode[]): Node[] {
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
}

function ERDiagramFlow({
  tables,
  relations,
  shapes,
  selectedPage,
  onTableClick,
}: {
  tables: ERTableNode[];
  relations: ERRelationEdge[];
  shapes: ERShapeNode[];
  selectedPage: string;
  onTableClick?: (tableId: string) => void;
}) {
  const { setViewport, getViewport, fitView } = useReactFlow();
  const saveViewport = useERDiagramStore((s) => s.saveViewport);
  const viewportsRef = useRef(useERDiagramStore.getState().viewports);
  useEffect(() => {
    return useERDiagramStore.subscribe((s) => {
      viewportsRef.current = s.viewports;
    });
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const prevPageRef = useRef(selectedPage);
  const isInitialMount = useRef(true);

  // ページ切替時: ノード更新 + viewport復元
  useEffect(() => {
    const prevPage = prevPageRef.current;
    prevPageRef.current = selectedPage;

    setNodes(toNodes(tables, shapes));
    setEdgePosMap(new Map(tables.map((t) => [t.id, t.position])));

    if (isInitialMount.current) {
      isInitialMount.current = false;
      requestAnimationFrame(() => fitView({ duration: 200 }));
      return;
    }

    // 切替前のviewportを保存
    if (prevPage !== selectedPage) {
      const currentVp = getViewport();
      saveViewport(prevPage, currentVp);
    }

    // 切替先のviewportを復元（なければfitView）
    const saved = viewportsRef.current[selectedPage];
    requestAnimationFrame(() => {
      if (saved && prevPage !== selectedPage) {
        setViewport(saved, { duration: 200 });
      } else if (prevPage !== selectedPage) {
        fitView({ duration: 200 });
      }
    });
  }, [tables, shapes, selectedPage, setNodes, fitView, getViewport, saveViewport, setViewport]);

  const [edgePosMap, setEdgePosMap] = useState<PosMap>(
    () => new Map(tables.map((t) => [t.id, t.position]))
  );

  const edges: Edge[] = useMemo(() => buildEdges(relations, edgePosMap), [relations, edgePosMap]);

  const nodeDragStop: OnNodeDrag<Node> = useCallback((_event, _node, draggedNodes) => {
    setEdgePosMap((prev) => {
      const next = new Map(prev);
      for (const n of draggedNodes) {
        next.set(n.id, n.position);
      }
      return next;
    });
  }, []);

  const nodeClick = useCallback(
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
      onNodeDragStop={nodeDragStop}
      onNodeClick={nodeClick}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      minZoom={0.1}
      maxZoom={2}
      defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#333" />
      <Controls />
    </ReactFlow>
  );
}

const NODE_CENTER_X = GRID_LAYOUT.nodeWidth / 2;
const NODE_CENTER_Y = GRID_LAYOUT.nodeHeight / 2;
const FOCUS_DURATION_MS = 3000;

/** 検索結果選択時にsetCenter + ページ切替を行うブリッジコンポーネント */
function ERDiagramSearchBridge({
  allTables,
  selectedPage,
  setSelectedPage,
}: {
  allTables: ERTableNode[];
  selectedPage: string;
  setSelectedPage: (page: string) => void;
}) {
  const { setCenter } = useReactFlow();
  const setFocusedNodeId = useERDiagramStore((s) => s.setFocusedNodeId);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const selectTable = useCallback(
    (table: ERTableNode) => {
      const needPageSwitch =
        selectedPage !== (table.data.page || DEFAULT_PAGE) && selectedPage !== ALL_PAGES;
      if (needPageSwitch) {
        setSelectedPage(table.data.page || DEFAULT_PAGE);
      }
      const centerOnNode = () => {
        setCenter(table.position.x + NODE_CENTER_X, table.position.y + NODE_CENTER_Y, {
          zoom: 1,
          duration: 300,
        });
      };
      if (needPageSwitch) {
        requestAnimationFrame(centerOnNode);
      } else {
        centerOnNode();
      }
      clearTimeout(focusTimerRef.current);
      setFocusedNodeId(table.id);
      focusTimerRef.current = setTimeout(() => setFocusedNodeId(null), FOCUS_DURATION_MS);
    },
    [selectedPage, setSelectedPage, setCenter, setFocusedNodeId]
  );

  return <ERDiagramSearch tables={allTables} onSelect={selectTable} />;
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

  const allTables = useERDiagramStore((s) => s.tables);
  const hasData = totalTableCount > 0;

  useERDiagramRenderMark(totalTableCount);

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
      <ReactFlowProvider>
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
          <ERDiagramSearchBridge
            allTables={allTables}
            selectedPage={selectedPage}
            setSelectedPage={setSelectedPage}
          />
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
        <div className={styles.flowContainer}>
          <ERDiagramFlow
            tables={layoutTables}
            relations={filteredRelations}
            shapes={layoutShapes}
            selectedPage={selectedPage}
            onTableClick={onTableClick}
          />
        </div>
      </ReactFlowProvider>
    </div>
  );
}
