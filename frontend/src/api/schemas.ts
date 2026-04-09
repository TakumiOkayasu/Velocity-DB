import z from 'zod';

// --- Primitives ---
const zVoid = z.any();

// --- Connection ---
export const connectAsync = z.object({ requestId: z.string() });
export const connectResult = z.object({
  status: z.enum(['pending', 'connected', 'failed', 'cancelled']),
  connectionId: z.string().optional(),
  error: z.string().optional(),
});
export const cancelConnect = zVoid;
export const disconnect = zVoid;
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
export const cancelQuery = zVoid;

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
export const beginTransaction = zVoid;
export const commit = zVoid;
export const rollback = zVoid;

// --- Export ---
export const exportCSV = zVoid;
export const exportJSON = zVoid;
export const exportExcel = zVoid;

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
export const parseERDiagram = z.any();

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
export const getSettings = z.any();
export const updateSettings = z.object({ saved: z.boolean() });

// --- Connection profiles ---
export const getConnectionProfiles = z.any();
export const saveConnectionProfile = z.object({ id: z.string() });
export const deleteConnectionProfile = z.object({ deleted: z.boolean() });
export const getProfilePassword = z.object({ password: z.string() });
export const getSshPassword = z.object({ password: z.string() });
export const getSshKeyPassphrase = z.object({ passphrase: z.string() });

// --- Session ---
export const getSessionState = z.any();
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
export const writeFrontendLog = zVoid;
export const saveQueryToFile = z.object({ filePath: z.string() });
export const loadQueryFromFile = z.object({ filePath: z.string(), content: z.string() });
export const browseFile = z.object({ filePath: z.string() });

// --- Bookmarks ---
export const getBookmarks = z.array(
  z.object({ id: z.string(), name: z.string(), content: z.string() })
);
export const saveBookmark = zVoid;
export const deleteBookmark = zVoid;
