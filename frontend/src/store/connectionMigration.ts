import { useQueryStore } from './queryStore';
import { useSchemaStore } from './schemaStore';

export function applyConnectionMigration(replaced?: { oldId: string; newId: string }): void {
  if (!replaced) return;
  useQueryStore.getState().migrateConnection(replaced.oldId, replaced.newId);
  useSchemaStore.getState().migrateConnection(replaced.oldId, replaced.newId);
}
