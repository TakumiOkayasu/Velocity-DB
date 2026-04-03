// SSH authentication type
export type SshAuthType = 'password' | 'privateKey';

export function isSshAuthType(value: string): value is SshAuthType {
  return value === 'password' || value === 'privateKey';
}

// Environment type for connection
export type EnvironmentType = 'development' | 'staging' | 'production';

export function isEnvironmentType(value: string): value is EnvironmentType {
  return value === 'development' || value === 'staging' || value === 'production';
}

// Database type for multi-DB support
export type DatabaseType = 'sqlserver' | 'postgresql' | 'mysql';

export function isDatabaseType(value: string): value is DatabaseType {
  return value === 'sqlserver' || value === 'postgresql' || value === 'mysql';
}

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
  environment?: EnvironmentType;
  dbType?: DatabaseType;
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
  environment?: EnvironmentType; // Environment type for color coding
  dbType?: DatabaseType; // Database type (SQL Server, PostgreSQL, MySQL)
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
  isERDiagram?: boolean; // True when viewing ER diagram
  useServerSideRowModel?: boolean; // Use AG Grid Server-Side Row Model for large tables
  logicalName?: string; // テーブル論理名（A5:ER由来、ツールチップ用）
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

/** ER図表示用の拡張カラム型（Column + ER固有属性） */
export interface ERColumn extends Omit<Column, 'type'> {
  type?: string;
  logicalName?: string;
  defaultValue?: string;
  color?: string; // CSS #RRGGBB
}

export interface ResultSet {
  columns: Column[];
  rows: (string | null)[][];
  affectedRows: number;
  executionTimeMs: number;
  truncated?: boolean;
  totalRowCount?: number;
}

export interface MultipleResultSet {
  multipleResults: true;
  results: Array<{
    statement: string;
    data: ResultSet;
  }>;
}

export type QueryResult = ResultSet | MultipleResultSet;

// Async query types (lightweight, from polling result)
export interface AsyncColumn {
  name: string;
  type: string;
  comment?: string;
}

export type AsyncPollResult =
  | {
      multipleResults?: false;
      columns: AsyncColumn[];
      rows: (string | null)[][];
      affectedRows: number;
      executionTimeMs: number;
      truncated?: boolean;
    }
  | {
      multipleResults: true;
      results: Array<{
        statement: string;
        data: {
          columns: AsyncColumn[];
          rows: (string | null)[][];
          affectedRows: number;
          executionTimeMs: number;
          truncated?: boolean;
        };
      }>;
    };

// Async query result response (from backend polling API) - discriminated union by status
export type AsyncQueryResultResponse =
  | { queryId: string; status: 'pending' | 'running' }
  | {
      queryId: string;
      status: 'completed';
      multipleResults: true;
      results: Array<{
        statement: string;
        data: {
          columns: AsyncColumn[];
          rows: (string | null)[][];
          affectedRows: number;
          executionTimeMs: number;
          truncated?: boolean;
        };
      }>;
    }
  | {
      queryId: string;
      status: 'completed';
      multipleResults?: false;
      columns: AsyncColumn[];
      rows: (string | null)[][];
      affectedRows: number;
      executionTimeMs: number;
      truncated?: boolean;
    }
  | { queryId: string; status: 'failed'; error: string }
  | { queryId: string; status: 'cancelled' };

// History types
export interface HistoryItem {
  id: string;
  sql: string;
  connectionId: string;
  timestamp: number;
  executionTimeMs: number;
  success: boolean;
  errorMessage: string;
  affectedRows: number;
  isFavorite: boolean;
}

// Context menu item type (shared between components and hooks)
export interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  action: () => void;
  disabled?: boolean;
  divider?: boolean;
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

export interface DatabaseObjectMetadata {
  comment?: string;
  schema?: string;
  tableName?: string;
  isPrimaryKey?: boolean;
  nullable?: boolean;
  columnType?: string;
  objectType?: 'table' | 'view';
}

export interface DatabaseObject {
  id: string;
  name: string;
  type: 'database' | 'folder' | 'table' | 'view' | 'procedure' | 'function' | 'column' | 'index';
  children?: DatabaseObject[];
  metadata?: DatabaseObjectMetadata;
}

// ER Diagram types
export interface ERTableNode {
  id: string;
  type: 'table';
  data: {
    tableName: string;
    logicalName?: string;
    columns: ERColumn[];
    page?: string;
    color?: string; // CSS #RRGGBB
    bkColor?: string; // CSS #RRGGBB
  };
  position: { x: number; y: number };
}

export interface ERShapeNode {
  id: string;
  type: 'shape';
  data: {
    shapeType: string;
    text: string;
    fillColor?: string;
    fontColor?: string;
    fillAlpha: number;
    fontSize: number;
    width: number;
    height: number;
    page?: string;
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
