import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSchemaStore } from '../../store/schemaStore';

vi.mock('../../api/bridge', () => ({
  bridge: {
    getTables: vi.fn(),
    getColumns: vi.fn(),
  },
}));

describe('schemaStore', () => {
  beforeEach(() => {
    useSchemaStore.setState({ schemas: new Map() });
  });

  describe('migrateConnection', () => {
    it('旧IDのキャッシュが削除される', () => {
      // Seed cache for conn_1
      const schemas = new Map();
      schemas.set('conn_1', {
        tables: [{ name: 'users', schema: 'dbo', type: 'TABLE' as const, columnsLoaded: false }],
        tablesLoaded: true,
        loadingTables: false,
        loadingColumns: new Set<string>(),
      });
      useSchemaStore.setState({ schemas });

      useSchemaStore.getState().migrateConnection('conn_1', 'conn_2');

      const result = useSchemaStore.getState().schemas;
      expect(result.has('conn_1')).toBe(false);
      expect(result.has('conn_2')).toBe(false); // lazy-load, not copied
    });
  });
});
