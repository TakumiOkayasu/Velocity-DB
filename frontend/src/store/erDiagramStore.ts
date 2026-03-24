import { create } from 'zustand';
import { bridge, toERDiagramModel } from '../api/bridge';
import type { ERRelationEdge, ERShapeNode, ERTableNode } from '../types';
import { DEFAULT_PAGE, GRID_LAYOUT } from '../utils/erDiagramConstants';
import type { ERDiagramModel } from '../utils/erDiagramParser';
import { extractPages } from '../utils/erDiagramUtils';

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

interface ERDiagramState {
  tables: ERTableNode[];
  relations: ERRelationEdge[];
  shapes: ERShapeNode[];
  isLoading: boolean;
  error: string | null;

  // Page state
  selectedPage: string;

  // Viewport per page (preserved across tab switches)
  viewports: Record<string, Viewport>;

  // Search highlight
  focusedNodeId: string | null;

  // Actions
  setTables: (tables: ERTableNode[]) => void;
  setRelations: (relations: ERRelationEdge[]) => void;
  addTable: (table: ERTableNode) => void;
  updateTablePosition: (id: string, position: { x: number; y: number }) => void;
  removeTable: (id: string) => void;
  clearDiagram: () => void;
  setSelectedPage: (page: string) => void;
  saveViewport: (page: string, viewport: Viewport) => void;
  setFocusedNodeId: (id: string | null) => void;

  // Reverse engineering
  loadFromDatabase: (connectionId: string, database: string) => Promise<void>;

  // Import from ER diagram file
  loadFromERFile: (filepath: string) => Promise<void>;

  // Import from parsed ER diagram model
  loadFromParsedModel: (model: ERDiagramModel) => void;
}

export const useERDiagramStore = create<ERDiagramState>((set, get) => ({
  tables: [],
  relations: [],
  shapes: [],
  isLoading: false,
  error: null,
  selectedPage: DEFAULT_PAGE,
  viewports: {},
  focusedNodeId: null,

  setTables: (tables) => set({ tables }),

  setRelations: (relations) => set({ relations }),

  addTable: (table) => {
    set((state) => ({
      tables: [...state.tables, table],
    }));
  },

  updateTablePosition: (id, position) => {
    set((state) => ({
      tables: state.tables.map((t) => (t.id === id ? { ...t, position } : t)),
    }));
  },

  removeTable: (id) => {
    set((state) => ({
      tables: state.tables.filter((t) => t.id !== id),
      relations: state.relations.filter((r) => r.source !== id && r.target !== id),
    }));
  },

  clearDiagram: () => {
    set({
      tables: [],
      relations: [],
      shapes: [],
      selectedPage: DEFAULT_PAGE,
      viewports: {},
      focusedNodeId: null,
    });
  },

  setSelectedPage: (page) => set({ selectedPage: page }),

  saveViewport: (page, viewport) => {
    set((state) => ({
      viewports: { ...state.viewports, [page]: viewport },
    }));
  },

  setFocusedNodeId: (id) => set({ focusedNodeId: id }),

  loadFromERFile: async (filepath) => {
    set({ isLoading: true, error: null });

    try {
      const result = await bridge.parseERDiagram({ filepath });
      const model = toERDiagramModel(result);
      get().loadFromParsedModel(model);
      set({ isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load ER diagram file',
      });
    }
  },

  loadFromDatabase: async (connectionId, database) => {
    set({ isLoading: true, error: null });

    try {
      // Get tables
      const { tables: tablesData } = await bridge.getTables(connectionId, database);
      const tables: ERTableNode[] = [];
      const relations: ERRelationEdge[] = [];

      const { columns: gridColumns, nodeWidth, nodeHeight, gap } = GRID_LAYOUT;

      // Load columns for each table
      for (let i = 0; i < tablesData.length; i++) {
        const tableInfo = tablesData[i];
        if (tableInfo.type !== 'TABLE' && tableInfo.type !== 'VIEW') continue;

        const fullTableName = tableInfo.schema
          ? `${tableInfo.schema}.${tableInfo.name}`
          : tableInfo.name;

        try {
          const columnsData = await bridge.getColumns(connectionId, fullTableName);

          const col = i % gridColumns;
          const row = Math.floor(i / gridColumns);

          tables.push({
            id: fullTableName,
            type: 'table',
            data: {
              tableName: tableInfo.name,
              columns: columnsData.map((c) => ({
                name: c.name,
                type: c.type,
                size: c.size,
                nullable: c.nullable,
                isPrimaryKey: c.isPrimaryKey,
              })),
            },
            position: {
              x: col * (nodeWidth + gap),
              y: row * (nodeHeight + gap),
            },
          });
        } catch (err) {
          console.warn(`Failed to load columns for ${fullTableName}:`, err);
        }
      }

      // Try to detect foreign key relationships
      tables.forEach((sourceTable) => {
        sourceTable.data.columns.forEach((col) => {
          if (col.name.toLowerCase().endsWith('_id') && !col.isPrimaryKey) {
            const potentialTableName = col.name.slice(0, -3);

            const targetTable = tables.find(
              (t) =>
                t.data.tableName.toLowerCase() === potentialTableName.toLowerCase() ||
                t.data.tableName.toLowerCase() === `${potentialTableName.toLowerCase()}s`
            );

            if (targetTable) {
              relations.push({
                id: `${sourceTable.id}-${targetTable.id}-${col.name}`,
                source: targetTable.id,
                target: sourceTable.id,
                type: 'relation',
                data: {
                  cardinality: '1:N',
                  sourceColumn: 'id',
                  targetColumn: col.name,
                },
              });
            }
          }
        });
      });

      set({ tables, relations, shapes: [], isLoading: false, selectedPage: DEFAULT_PAGE });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load database schema',
      });
    }
  },

  loadFromParsedModel: (model) => {
    const { columns: gridColumns, nodeWidth, nodeHeight, gap } = GRID_LAYOUT;

    // ER diagram file import: any table with explicit position data is trusted.
    // Grid layout is only applied when ALL tables have (0,0) — i.e. no position info at all.
    const anyTableHasPosition = model.tables.some((t) => t.posX !== 0 || t.posY !== 0);

    const erTables: ERTableNode[] = model.tables.map((table, i) => {
      const useFilePosition = anyTableHasPosition;
      const col = i % gridColumns;
      const row = Math.floor(i / gridColumns);

      return {
        id: table.name,
        type: 'table',
        data: {
          tableName: table.name,
          logicalName: table.logicalName || undefined,
          page: table.page || DEFAULT_PAGE,
          color: table.color || undefined,
          bkColor: table.bkColor || undefined,
          columns: table.columns.map((c) => ({
            name: c.name,
            type: c.type || undefined,
            size: 0,
            nullable: c.nullable,
            isPrimaryKey: c.isPrimaryKey,
            logicalName: c.logicalName || undefined,
            defaultValue: c.defaultValue || undefined,
            comment: c.comment || undefined,
            color: c.color || undefined,
          })),
        },
        position: useFilePosition
          ? { x: table.posX, y: table.posY }
          : { x: col * (nodeWidth + gap), y: row * (nodeHeight + gap) },
      };
    });

    const erRelations: ERRelationEdge[] = model.relations.map((rel, i) => ({
      id: `rel-${i}-${rel.name}`,
      source: rel.sourceTable,
      target: rel.targetTable,
      type: 'relation',
      data: {
        cardinality: rel.cardinality,
        sourceColumn: rel.sourceColumn,
        targetColumn: rel.targetColumn,
      },
    }));

    const erShapes: ERShapeNode[] = (model.shapes ?? []).map((shape, i) => ({
      id: `shape-${i}`,
      type: 'shape',
      data: {
        shapeType: shape.shapeType,
        text: shape.text,
        fillColor: shape.fillColor || undefined,
        fontColor: shape.fontColor || undefined,
        fillAlpha: shape.fillAlpha,
        fontSize: shape.fontSize,
        width: shape.width,
        height: shape.height,
        page: shape.page || DEFAULT_PAGE,
      },
      position: { x: shape.left, y: shape.top },
    }));

    // 最初のページを初期選択
    const pages = extractPages(erTables);
    set({
      tables: erTables,
      relations: erRelations,
      shapes: erShapes,
      selectedPage: pages[0] || DEFAULT_PAGE,
    });
  },
}));
