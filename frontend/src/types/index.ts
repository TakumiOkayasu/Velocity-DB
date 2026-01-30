// SSH authentication type
export type SshAuthType = 'password' | 'privateKey';

// SSH configuration types (runtime, includes secrets)
export interface SshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  password?: string;
  privateKeyPath?: string;
  keyPassphrase?: string;
}

// SSH configuration for saved profiles (no secrets in memory)
export interface SavedSshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  privateKeyPath: string;
  savePassword: boolean;
}

// Saved connection profile (persistent storage)
export interface SavedConnectionProfile {
  id: string;
  name: string;
  server: string;
  port: number;
  database: string;
  username: string;
  useWindowsAuth: boolean;
  savePassword: boolean;
  isProduction: boolean;
  isReadOnly: boolean;
  ssh?: SavedSshConfig;
}

// Connection types
export interface Connection {
  id: string;
  name: string;
  server: string;
  port: number;
  database: string;
  username: string;
  password: string;
  useWindowsAuth: boolean;
  isActive: boolean; // Track if connection is active in ObjectTree
  isProduction: boolean; // Production environment flag - enables safety features
  isReadOnly: boolean; // Read-only mode - prevents data modifications
  tableListLoadTimeMs?: number; // Time taken to load table list
  tableOpenTimeMs?: number; // Time taken to open a table (click to display)
  ssh?: SshConfig;
}

// Query types
export interface Query {
  id: string;
  name: string;
  content: string;
  connectionId: string | null;
  isDirty: boolean;
  filePath?: string; // File path when saved to disk
  sourceTable?: string; // Table name when opened from Object Tree (for WHERE filter)
  isDataView?: boolean; // True when viewing table data (show grid instead of editor)
  useServerSideRowModel?: boolean; // Use AG Grid Server-Side Row Model for large tables
}

// Bookmark types
export interface Bookmark {
  id: string;
  name: string;
  content: string;
  createdAt?: number;
}

// Result types
export interface Column {
  name: string;
  type: string;
  size: number;
  nullable: boolean;
  isPrimaryKey: boolean;
  comment?: string;
}

export interface ResultSet {
  columns: Column[];
  rows: string[][];
  affectedRows: number;
  executionTimeMs: number;
}

export interface MultipleResultSet {
  multipleResults: true;
  results: Array<{
    statement: string;
    data: ResultSet;
  }>;
}

export type QueryResult = ResultSet | MultipleResultSet;

// History types
export interface HistoryItem {
  id: string;
  sql: string;
  connectionId: string;
  timestamp: Date;
  executionTimeMs: number;
  success: boolean;
  errorMessage?: string;
  affectedRows: number;
  isFavorite: boolean;
}

// Database object types
export interface TableInfo {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  comment?: string;
}

// Table metadata types for TableViewer
export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimaryKey: boolean;
  type: string; // CLUSTERED, NONCLUSTERED, etc.
}

export interface ConstraintInfo {
  name: string;
  type: 'PRIMARY KEY' | 'UNIQUE' | 'CHECK' | 'DEFAULT';
  columns: string[];
  definition: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface ReferencingForeignKeyInfo {
  name: string;
  referencingTable: string;
  referencingColumns: string[];
  columns: string[];
  onDelete: string;
  onUpdate: string;
}

export interface TriggerInfo {
  name: string;
  type: string; // AFTER, INSTEAD OF
  events: string[]; // INSERT, UPDATE, DELETE
  isEnabled: boolean;
  definition: string;
}

export interface TableMetadata {
  schema: string;
  name: string;
  type: 'TABLE' | 'VIEW';
  rowCount: number;
  createdAt: string;
  modifiedAt: string;
  owner: string;
  comment: string;
}

export interface DatabaseObject {
  id: string;
  name: string;
  type: 'database' | 'folder' | 'table' | 'view' | 'procedure' | 'function' | 'column' | 'index';
  children?: DatabaseObject[];
  metadata?: {
    comment?: string;
    [key: string]: unknown;
  };
}

// ER Diagram types
export interface ERTableNode {
  id: string;
  type: 'table';
  data: {
    tableName: string;
    columns: Column[];
  };
  position: { x: number; y: number };
}

export interface ERRelationEdge {
  id: string;
  source: string;
  target: string;
  type: 'relation';
  data: {
    cardinality: '1:1' | '1:N' | 'N:M';
    sourceColumn: string;
    targetColumn: string;
  };
}

// IPC types
export interface IPCRequest {
  method: string;
  params: string;
}

export interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
