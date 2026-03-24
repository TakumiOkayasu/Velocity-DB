export interface Manageable {
  addQuery: (connectionId?: string | null) => void;
  removeQuery: (id: string) => void;
  updateQuery: (id: string, content: string) => void;
  updateQueryConnection: (id: string, connectionId: string | null) => void;
  renameQuery: (id: string, name: string) => void;
  setActive: (id: string | null) => void;
  reorderQuery: (fromIndex: number, toIndex: number) => void;
  migrateConnection: (oldId: string, newId: string) => void;
}
