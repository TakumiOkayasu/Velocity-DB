// Connection types
export interface Connection {
  id: string;
  name: string;
  server: string;
  database: string;
  username: string;
  password: string;
  useWindowsAuth: boolean;
}

// Query types
export interface Query {
  id: string;
  name: string;
  content: string;
  connectionId: string | null;
  isDirty: boolean;
}

// Result types
export interface Column {
  name: string;
  type: string;
  size: number;
  nullable: boolean;
  isPrimaryKey: boolean;
}

export interface ResultSet {
  columns: Column[];
  rows: string[][];
  affectedRows: number;
  executionTimeMs: number;
}

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
}

export interface DatabaseObject {
  id: string;
  name: string;
  type: 'database' | 'folder' | 'table' | 'view' | 'procedure' | 'function' | 'column' | 'index';
  children?: DatabaseObject[];
  metadata?: Record<string, unknown>;
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
