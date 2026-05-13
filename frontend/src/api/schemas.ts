import z from 'zod';

// --- Primitives ---
// backend 側 `JsonUtils::successResponse("{}")` で `data: {}` 空オブジェクトを返す void 応答用 schema。
// 余剰フィールドは backend 仕様逸脱なので .strict() で検出する (issue #567)
const zVoidResponse = z.object({}).strict();

// --- Connection ---
export const connectAsync = z.object({ requestId: z.string() });
export const connectResult = z.object({
  status: z.enum(['pending', 'connected', 'failed', 'cancelled']),
  connectionId: z.string().optional(),
  error: z.string().optional(),
});
export type ConnectResultResponse = z.infer<typeof connectResult>;
export const cancelConnect = zVoidResponse;
export const disconnect = zVoidResponse;
export const testConnection = z.object({ success: z.boolean(), message: z.string() });

// --- Query ---
const columnSchema = z.object({
  name: z.string(),
  type: z.string(),
  comment: z.string().optional(),
});
const singleResultSchema = z.object({
  columns: z.array(columnSchema),
  rows: z.any(), // perf: skip per-row validation
  affectedRows: z.number(),
  executionTimeMs: z.number(),
  cached: z.boolean(),
});
const multipleResultSchema = z.object({
  multipleResults: z.literal(true),
  results: z.array(
    z.object({
      statement: z.string(),
      data: z.object({
        columns: z.array(z.object({ name: z.string(), type: z.string() })),
        rows: z.any(),
        affectedRows: z.number(),
        executionTimeMs: z.number(),
      }),
    })
  ),
});
export const executeQuery = z.union([singleResultSchema, multipleResultSchema]);
export const executeQueryPaginated = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.any(),
  affectedRows: z.number(),
  executionTimeMs: z.number(),
});
export const getRowCount = z.object({ rowCount: z.number() });
export const cancelQuery = zVoidResponse;

// --- Schema ---
export const getDatabases = z.array(z.string());
export const getTables = z.array(
  z.object({
    schema: z.string(),
    name: z.string(),
    type: z.string(),
    comment: z.string().optional(),
  })
);
export const getColumns = z.array(
  z.object({
    name: z.string(),
    type: z.string(),
    size: z.number(),
    nullable: z.boolean(),
    isPrimaryKey: z.boolean(),
    comment: z.string().optional(),
  })
);

// --- Transaction ---
export const beginTransaction = zVoidResponse;
export const commit = zVoidResponse;
export const rollback = zVoidResponse;

// --- Export ---
export const exportCSV = zVoidResponse;
export const exportJSON = zVoidResponse;
export const exportExcel = zVoidResponse;

// --- SQL builder ---
export const buildDataViewSql = z.object({ sql: z.string() });
export const buildWhereClause = z.object({ whereClause: z.string() });
export const buildDmlStatements = z.object({ statements: z.array(z.string()) });
export const uppercaseKeywords = z.object({ sql: z.string() });

// --- History ---
export const getQueryHistory = z.array(
  z.object({
    id: z.string(),
    sql: z.string(),
    connectionId: z.string(),
    timestamp: z.number(),
    executionTimeMs: z.number(),
    success: z.boolean(),
    errorMessage: z.string(),
    affectedRows: z.number(),
    isFavorite: z.boolean(),
  })
);
export const removeQueryHistory = z.object({ removed: z.boolean() });
export const clearQueryHistory = z.object({ cleared: z.boolean() });
export const setQueryHistoryFavorite = z.object({ updated: z.boolean() });

// --- ER diagram ---
const erColumnSchema = z.object({
  name: z.string(),
  logicalName: z.string(),
  type: z.string(),
  size: z.number(),
  scale: z.number(),
  nullable: z.boolean(),
  isPrimaryKey: z.boolean(),
  defaultValue: z.string(),
  comment: z.string(),
  color: z.string(),
});
const erIndexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  isUnique: z.boolean(),
});
const erTableSchema = z.object({
  name: z.string(),
  logicalName: z.string(),
  comment: z.string(),
  columns: z.array(erColumnSchema),
  indexes: z.array(erIndexSchema),
  posX: z.number(),
  posY: z.number(),
  page: z.string(),
  color: z.string(),
  bkColor: z.string(),
});
const erRelationSchema = z.object({
  name: z.string(),
  parentTable: z.string(),
  childTable: z.string(),
  parentColumn: z.string(),
  childColumn: z.string(),
  cardinality: z.string(),
});
const erShapeSchema = z.object({
  shapeType: z.string(),
  text: z.string(),
  fillColor: z.string(),
  fontColor: z.string(),
  fillAlpha: z.number(),
  fontSize: z.number(),
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
  page: z.string(),
});
export const parseERDiagram = z.object({
  name: z.string(),
  databaseType: z.string(),
  tables: z.array(erTableSchema),
  relations: z.array(erRelationSchema),
  shapes: z.array(erShapeSchema),
  ddl: z.string(),
});

// --- Execution plan ---
export const getExecutionPlan = z.object({ plan: z.string(), actual: z.boolean() });

// --- Cache ---
export const getCacheStats = z.object({
  currentSizeBytes: z.number(),
  maxSizeBytes: z.number(),
  usagePercent: z.number(),
});
export const clearCache = z.object({ cleared: z.boolean() });

// --- Async query ---
export const executeAsyncQuery = z.object({ queryId: z.string() });
export const getAsyncQueryResult = z.any();
export const cancelAsyncQuery = z.object({ cancelled: z.boolean() });
export const removeAsyncQuery = z.object({ removed: z.boolean() });
export const getActiveQueries = z.array(z.string());

// --- Filter ---
export const filterResultSet = z.object({
  columns: z.array(z.object({ name: z.string(), type: z.string() })),
  rows: z.any(),
  totalRows: z.number(),
  filteredRows: z.number(),
  simdAvailable: z.boolean(),
});

// --- Settings ---
const generalSettingsSchema = z.object({
  autoConnect: z.boolean(),
  lastConnectionId: z.string(),
  confirmOnExit: z.boolean(),
  maxQueryHistory: z.number(),
  maxRecentConnections: z.number(),
  language: z.string(),
});
const editorSettingsSchema = z.object({
  fontSize: z.number(),
  fontFamily: z.string(),
  wordWrap: z.boolean(),
  tabSize: z.number(),
  insertSpaces: z.boolean(),
  showLineNumbers: z.boolean(),
  showMinimap: z.boolean(),
  theme: z.string(),
});
const gridSettingsSchema = z.object({
  defaultPageSize: z.number(),
  showRowNumbers: z.boolean(),
  enableCellEditing: z.boolean(),
  dateFormat: z.string(),
  nullDisplay: z.string(),
});
const querySettingsSchema = z.object({
  timeoutSeconds: z.number(),
});
export const getSettings = z.object({
  general: generalSettingsSchema,
  editor: editorSettingsSchema,
  grid: gridSettingsSchema,
  query: querySettingsSchema,
});
export const updateSettings = z.object({ saved: z.boolean() });

// --- Connection profiles ---
const sshProfileSchema = z.object({
  enabled: z.boolean(),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  authType: z.enum(['password', 'privateKey']),
  privateKeyPath: z.string(),
  savePassword: z.boolean(),
});
const connectionProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  server: z.string(),
  port: z.number().optional(),
  database: z.string(),
  username: z.string(),
  useWindowsAuth: z.boolean(),
  savePassword: z.boolean().optional(),
  isProduction: z.boolean().optional(),
  isReadOnly: z.boolean().optional(),
  environment: z.enum(['development', 'staging', 'production']).optional(),
  dbType: z.enum(['sqlserver', 'postgresql', 'mysql']).optional(),
  folderPath: z.string().optional(),
  ssh: sshProfileSchema.optional(),
});
export const getConnectionProfiles = z.object({
  profiles: z.array(connectionProfileSchema),
});
export const saveConnectionProfile = z.object({ id: z.string() });
export const deleteConnectionProfile = z.object({ deleted: z.boolean() });
export const getProfilePassword = z.object({ password: z.string() });
export const getSshPassword = z.object({ password: z.string() });
export const getSshKeyPassphrase = z.object({ passphrase: z.string() });

// --- Session ---
const sessionTabSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  filePath: z.string(),
  isDirty: z.boolean(),
  cursorLine: z.number(),
  cursorColumn: z.number(),
});
export const getSessionState = z.object({
  activeConnectionId: z.string(),
  activeTabId: z.string(),
  windowX: z.number(),
  windowY: z.number(),
  windowWidth: z.number(),
  windowHeight: z.number(),
  isMaximized: z.boolean(),
  leftPanelWidth: z.number(),
  bottomPanelHeight: z.number(),
  openTabs: z.array(sessionTabSchema),
  expandedTreeNodes: z.array(z.string()),
});
export const saveSessionState = z.object({ saved: z.boolean() });

// --- Search ---
export const searchObjects = z.array(
  z.object({
    objectType: z.string(),
    schemaName: z.string(),
    objectName: z.string(),
    parentName: z.string(),
  })
);
export const quickSearch = z.array(z.string());

// --- Table metadata ---
export const getIndexes = z.array(
  z.object({
    name: z.string(),
    columns: z.array(z.string()),
    isUnique: z.boolean(),
    isPrimaryKey: z.boolean(),
    type: z.string(),
  })
);
export const getConstraints = z.array(
  z.object({
    name: z.string(),
    type: z.enum(['PRIMARY KEY', 'UNIQUE', 'CHECK', 'DEFAULT']),
    columns: z.array(z.string()),
    definition: z.string(),
  })
);
export const getForeignKeys = z.array(
  z.object({
    name: z.string(),
    columns: z.array(z.string()),
    referencedTable: z.string(),
    referencedColumns: z.array(z.string()),
    onDelete: z.string(),
    onUpdate: z.string(),
  })
);
export const getReferencingForeignKeys = z.array(
  z.object({
    name: z.string(),
    referencingTable: z.string(),
    referencingColumns: z.array(z.string()),
    columns: z.array(z.string()),
    onDelete: z.string(),
    onUpdate: z.string(),
  })
);
export const getTriggers = z.array(
  z.object({
    name: z.string(),
    type: z.string(),
    events: z.array(z.string()),
    isEnabled: z.boolean(),
    definition: z.string(),
  })
);
export const getTableMetadata = z.object({
  schema: z.string(),
  name: z.string(),
  type: z.enum(['TABLE', 'VIEW']),
  rowCount: z.number(),
  createdAt: z.string(),
  modifiedAt: z.string(),
  owner: z.string(),
  comment: z.string(),
});
export const getTableDDL = z.object({ ddl: z.string() });

// --- File operations ---
export const writeFrontendLog = zVoidResponse;
export const saveQueryToFile = z.object({ filePath: z.string() });
export const loadQueryFromFile = z.object({ filePath: z.string(), content: z.string() });
export const browseFile = z.object({ filePath: z.string() });

// --- Bookmarks ---
export const getBookmarks = z.array(
  z.object({ id: z.string(), name: z.string(), content: z.string() })
);
export const saveBookmark = zVoidResponse;
export const deleteBookmark = zVoidResponse;

// --- Lint (sqruff) ---
export const lintSql = z.object({
  diagnostics: z.array(
    z.object({
      line: z.number(),
      column: z.number(),
      code: z.string(),
      message: z.string(),
    })
  ),
  lintUnavailable: z.boolean().optional(),
  reason: z.string().optional(),
});

// --- Compile-time type check (#567) ---
// TS interface と zod schema の型ドリフトを tsc で検出する。
// Equals<A, B> が false (= z.infer と interface が不一致) なら下の `: true` 代入で型エラーとなる。
import type { AppSettings } from './providers/app-settings';
import type { ConnectionProfile } from './providers/connection-profile';
import type { SessionState } from './providers/session';

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const _appSettingsTypeMatch: Equals<AppSettings, z.infer<typeof getSettings>> = true;
const _connectionProfileTypeMatch: Equals<
  ConnectionProfile,
  z.infer<typeof connectionProfileSchema>
> = true;
const _sessionStateTypeMatch: Equals<SessionState, z.infer<typeof getSessionState>> = true;
// 未使用変数として tree-shake されるよう void で参照
void [_appSettingsTypeMatch, _connectionProfileTypeMatch, _sessionStateTypeMatch];
