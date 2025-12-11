import { create } from 'zustand';
import { bridge } from '../api/bridge';
import type { ERRelationEdge, ERTableNode } from '../types';

interface ERDiagramState {
  tables: ERTableNode[];
  relations: ERRelationEdge[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setTables: (tables: ERTableNode[]) => void;
  setRelations: (relations: ERRelationEdge[]) => void;
  addTable: (table: ERTableNode) => void;
  updateTablePosition: (id: string, position: { x: number; y: number }) => void;
  removeTable: (id: string) => void;
  clearDiagram: () => void;

  // Reverse engineering
  loadFromDatabase: (connectionId: string, database: string) => Promise<void>;

  // Import from A5:ER file
  loadFromA5ERFile: (filepath: string) => Promise<void>;

  // Import from A5:ER (legacy)
  importFromA5ER: (
    tables: {
      name: string;
      schema: string;
      columns: {
        name: string;
        type: string;
        nullable: boolean;
        isPrimaryKey: boolean;
      }[];
    }[],
    relations: {
      sourceTable: string;
      targetTable: string;
      cardinality: '1:1' | '1:N' | 'N:M';
    }[]
  ) => void;
}

export const useERDiagramStore = create<ERDiagramState>((set) => ({
  tables: [],
  relations: [],
  isLoading: false,
  error: null,

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
    set({ tables: [], relations: [] });
  },

  loadFromA5ERFile: async (filepath) => {
    set({ isLoading: true, error: null });

    try {
      const model = await bridge.parseA5ER(filepath);

      // Convert A5ER model to ERTableNode format
      const erTables: ERTableNode[] = model.tables.map((table) => ({
        id: table.name,
        type: 'table',
        data: {
          tableName: table.name,
          columns: table.columns.map((c) => ({
            name: c.name,
            type: c.type,
            size: c.size,
            nullable: c.nullable,
            isPrimaryKey: c.isPrimaryKey,
          })),
        },
        position: {
          x: table.posX || 0,
          y: table.posY || 0,
        },
      }));

      // Convert A5ER relations to ERRelationEdge format
      const erRelations: ERRelationEdge[] = model.relations.map((rel, i) => ({
        id: `rel-${i}-${rel.name}`,
        source: rel.parentTable,
        target: rel.childTable,
        type: 'relation',
        data: {
          cardinality: (rel.cardinality as '1:1' | '1:N' | 'N:M') || '1:N',
          sourceColumn: rel.parentColumn,
          targetColumn: rel.childColumn,
        },
      }));

      set({ tables: erTables, relations: erRelations, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load A5:ER file',
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

      // Layout configuration
      const nodeWidth = 200;
      const nodeHeight = 150;
      const horizontalGap = 80;
      const verticalGap = 80;
      const columns = 4;

      // Load columns for each table
      for (let i = 0; i < tablesData.length; i++) {
        const tableInfo = tablesData[i];
        if (tableInfo.type !== 'TABLE' && tableInfo.type !== 'VIEW') continue;

        const fullTableName = tableInfo.schema
          ? `${tableInfo.schema}.${tableInfo.name}`
          : tableInfo.name;

        try {
          const columnsData = await bridge.getColumns(connectionId, fullTableName);

          const col = i % columns;
          const row = Math.floor(i / columns);

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
              x: col * (nodeWidth + horizontalGap),
              y: row * (nodeHeight + verticalGap),
            },
          });
        } catch (err) {
          console.warn(`Failed to load columns for ${fullTableName}:`, err);
        }
      }

      // Try to detect foreign key relationships
      // This is a simplified detection based on naming convention
      tables.forEach((sourceTable) => {
        sourceTable.data.columns.forEach((col) => {
          // Check for columns ending with _id
          if (col.name.toLowerCase().endsWith('_id') && !col.isPrimaryKey) {
            const potentialTableName = col.name.slice(0, -3); // Remove _id

            // Find target table
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

      set({ tables, relations, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load database schema',
      });
    }
  },

  importFromA5ER: (tables, relations) => {
    const nodeWidth = 200;
    const nodeHeight = 150;
    const horizontalGap = 80;
    const verticalGap = 80;
    const columns = 4;

    const erTables: ERTableNode[] = tables.map((table, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);

      return {
        id: table.schema ? `${table.schema}.${table.name}` : table.name,
        type: 'table',
        data: {
          tableName: table.name,
          columns: table.columns.map((c) => ({
            name: c.name,
            type: c.type,
            size: 0,
            nullable: c.nullable,
            isPrimaryKey: c.isPrimaryKey,
          })),
        },
        position: {
          x: col * (nodeWidth + horizontalGap),
          y: row * (nodeHeight + verticalGap),
        },
      };
    });

    const erRelations: ERRelationEdge[] = relations.map((rel, i) => ({
      id: `rel-${i}`,
      source: rel.sourceTable,
      target: rel.targetTable,
      type: 'relation',
      data: {
        cardinality: rel.cardinality,
        sourceColumn: 'id',
        targetColumn: `${rel.sourceTable.toLowerCase()}_id`,
      },
    }));

    set({ tables: erTables, relations: erRelations });
  },
}));
