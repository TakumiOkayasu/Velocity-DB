import { create } from 'zustand';
import { bridge } from '../api/bridge';
import type { Column } from '../types';
import { log } from '../utils/logger';

interface TableSchema {
  name: string;
  schema: string;
  type: 'TABLE' | 'VIEW';
  columns?: Column[];
  columnsLoaded: boolean;
}

interface ConnectionSchema {
  tables: TableSchema[];
  tablesLoaded: boolean;
  loadingTables: boolean;
  loadingColumns: Set<string>;
}

interface SchemaState {
  schemas: Map<string, ConnectionSchema>;
  loadTables: (connectionId: string) => Promise<void>;
  loadColumns: (connectionId: string, tableName: string) => Promise<Column[]>;
  getTableColumns: (connectionId: string, tableName: string) => Column[] | undefined;
  getTables: (connectionId: string) => TableSchema[];
  clearSchema: (connectionId: string) => void;
  migrateConnection: (oldId: string, newId: string) => void;
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  schemas: new Map(),

  loadTables: async (connectionId: string) => {
    const { schemas } = get();
    const existing = schemas.get(connectionId);

    if (existing?.tablesLoaded || existing?.loadingTables) {
      return;
    }

    set((state) => {
      const newSchemas = new Map(state.schemas);
      newSchemas.set(connectionId, {
        tables: [],
        tablesLoaded: false,
        loadingTables: true,
        loadingColumns: new Set(),
      });
      return { schemas: newSchemas };
    });

    try {
      const { tables } = await bridge.getTables(connectionId, '');
      log.debug(`[SchemaStore] Loaded ${tables.length} tables for ${connectionId}`);

      const tableSchemas: TableSchema[] = tables.map((t) => ({
        name: t.name,
        schema: t.schema,
        type: t.type as 'TABLE' | 'VIEW',
        columnsLoaded: false,
      }));

      set((state) => {
        const newSchemas = new Map(state.schemas);
        newSchemas.set(connectionId, {
          tables: tableSchemas,
          tablesLoaded: true,
          loadingTables: false,
          loadingColumns: new Set(),
        });
        return { schemas: newSchemas };
      });
    } catch (error) {
      log.error(`[SchemaStore] Failed to load tables: ${error}`);
      set((state) => {
        const newSchemas = new Map(state.schemas);
        newSchemas.set(connectionId, {
          tables: [],
          tablesLoaded: false,
          loadingTables: false,
          loadingColumns: new Set(),
        });
        return { schemas: newSchemas };
      });
    }
  },

  loadColumns: async (connectionId: string, tableName: string) => {
    const { schemas } = get();
    const schema = schemas.get(connectionId);

    if (!schema) {
      return [];
    }

    const table = schema.tables.find(
      (t) =>
        t.name.toLowerCase() === tableName.toLowerCase() ||
        `${t.schema}.${t.name}`.toLowerCase() === tableName.toLowerCase()
    );

    if (table?.columnsLoaded && table.columns) {
      return table.columns;
    }

    if (schema.loadingColumns.has(tableName)) {
      return [];
    }

    set((state) => {
      const newSchemas = new Map(state.schemas);
      const current = newSchemas.get(connectionId);
      if (current) {
        const newLoadingColumns = new Set(current.loadingColumns);
        newLoadingColumns.add(tableName);
        newSchemas.set(connectionId, { ...current, loadingColumns: newLoadingColumns });
      }
      return { schemas: newSchemas };
    });

    try {
      const columns = await bridge.getColumns(connectionId, tableName);
      log.debug(`[SchemaStore] Loaded ${columns.length} columns for ${tableName}`);

      set((state) => {
        const newSchemas = new Map(state.schemas);
        const current = newSchemas.get(connectionId);
        if (current) {
          const updatedTables = current.tables.map((t) => {
            if (
              t.name.toLowerCase() === tableName.toLowerCase() ||
              `${t.schema}.${t.name}`.toLowerCase() === tableName.toLowerCase()
            ) {
              return { ...t, columns, columnsLoaded: true };
            }
            return t;
          });
          const newLoadingColumns = new Set(current.loadingColumns);
          newLoadingColumns.delete(tableName);
          newSchemas.set(connectionId, {
            ...current,
            tables: updatedTables,
            loadingColumns: newLoadingColumns,
          });
        }
        return { schemas: newSchemas };
      });

      return columns;
    } catch (error) {
      log.error(`[SchemaStore] Failed to load columns for ${tableName}: ${error}`);

      set((state) => {
        const newSchemas = new Map(state.schemas);
        const current = newSchemas.get(connectionId);
        if (current) {
          const newLoadingColumns = new Set(current.loadingColumns);
          newLoadingColumns.delete(tableName);
          newSchemas.set(connectionId, { ...current, loadingColumns: newLoadingColumns });
        }
        return { schemas: newSchemas };
      });

      return [];
    }
  },

  getTableColumns: (connectionId: string, tableName: string) => {
    const { schemas } = get();
    const schema = schemas.get(connectionId);
    if (!schema) return undefined;

    const table = schema.tables.find(
      (t) =>
        t.name.toLowerCase() === tableName.toLowerCase() ||
        `${t.schema}.${t.name}`.toLowerCase() === tableName.toLowerCase()
    );
    return table?.columns;
  },

  getTables: (connectionId: string) => {
    const { schemas } = get();
    return schemas.get(connectionId)?.tables ?? [];
  },

  clearSchema: (connectionId: string) => {
    set((state) => {
      const newSchemas = new Map(state.schemas);
      newSchemas.delete(connectionId);
      return { schemas: newSchemas };
    });
  },

  migrateConnection: (oldId: string, _newId: string) => {
    set((state) => {
      const newSchemas = new Map(state.schemas);
      newSchemas.delete(oldId);
      return { schemas: newSchemas };
    });
  },
}));
