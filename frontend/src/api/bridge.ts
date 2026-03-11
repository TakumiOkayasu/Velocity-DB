import type { AsyncQueryResultResponse, IPCRequest, IPCResponse } from '../types';
import { DEFAULT_PAGE } from '../utils/erDiagramConstants';
import type { ERDiagramModel } from '../utils/erDiagramParser';
import { log } from '../utils/logger';

declare global {
  interface Window {
    invoke?: (request: string) => Promise<string>;
  }
}

/** ER diagram parse result returned from backend IPC (tool-agnostic) */
export interface ERDiagramParseResult {
  name: string;
  databaseType: string;
  tables: {
    name: string;
    logicalName: string;
    comment: string;
    columns: {
      name: string;
      logicalName: string;
      type: string;
      size: number;
      scale: number;
      nullable: boolean;
      isPrimaryKey: boolean;
      defaultValue: string;
      comment: string;
      color: string;
    }[];
    indexes: {
      name: string;
      columns: string[];
      isUnique: boolean;
    }[];
    posX: number;
    posY: number;
    page: string;
    color: string;
    bkColor: string;
  }[];
  relations: {
    name: string;
    parentTable: string;
    childTable: string;
    parentColumn: string;
    childColumn: string;
    cardinality: string;
  }[];
  shapes: {
    shapeType: string;
    text: string;
    fillColor: string;
    fontColor: string;
    fillAlpha: number;
    fontSize: number;
    left: number;
    top: number;
    width: number;
    height: number;
    page: string;
  }[];
  ddl: string;
}

/** ERDiagramParseResult → ERDiagramModel 変換 */
export function toERDiagramModel(
  result: ERDiagramParseResult,
  fallbackName?: string
): ERDiagramModel {
  return {
    name: result.name || fallbackName || '',
    tables: result.tables.map((t) => ({
      name: t.name,
      logicalName: t.logicalName,
      comment: t.comment,
      page: t.page || DEFAULT_PAGE,
      posX: t.posX,
      posY: t.posY,
      color: t.color || undefined,
      bkColor: t.bkColor || undefined,
      columns: t.columns.map((c) => ({
        name: c.name,
        logicalName: c.logicalName,
        type: c.type,
        nullable: c.nullable,
        isPrimaryKey: c.isPrimaryKey,
        defaultValue: c.defaultValue,
        comment: c.comment,
        color: c.color || undefined,
      })),
      indexes: t.indexes.map((idx) => ({
        name: idx.name,
        isUnique: idx.isUnique,
        columns: idx.columns,
      })),
    })),
    relations: result.relations.map((r) => ({
      name: r.name,
      sourceTable: r.parentTable,
      targetTable: r.childTable,
      sourceColumn: r.parentColumn,
      targetColumn: r.childColumn,
      cardinality: (r.cardinality as '1:1' | '1:N' | 'N:M') || '1:N',
    })),
    shapes: result.shapes.map((s) => ({
      shapeType: s.shapeType,
      text: s.text,
      fillColor: s.fillColor || undefined,
      fontColor: s.fontColor || undefined,
      fillAlpha: s.fillAlpha,
      fontSize: s.fontSize,
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height,
      page: s.page || DEFAULT_PAGE,
    })),
  };
}

function isIPCResponse(obj: unknown): obj is IPCResponse {
  return typeof obj === 'object' && obj !== null && 'success' in obj;
}

class Bridge {
  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const request: IPCRequest = {
      method,
      params: JSON.stringify(params),
    };

    if (window.invoke) {
      const requestStr = JSON.stringify(request);
      // Skip logging for writeFrontendLog to prevent infinite loop
      const shouldLog = method !== 'writeFrontendLog';

      if (shouldLog) {
        log.debug(`[Bridge] Sending request: ${method}`);
      }

      const responseRaw = await window.invoke(requestStr);

      if (shouldLog) {
        log.debug(`[Bridge] Received response for ${method} (type: ${typeof responseRaw})`);
      }

      // If response is already an object, webview may have parsed it
      let response: IPCResponse<T>;
      if (typeof responseRaw === 'string') {
        const parsed: unknown = JSON.parse(responseRaw);
        if (!isIPCResponse(parsed)) {
          log.error(`[Bridge] Invalid response structure for ${method}`);
          throw new Error(`Invalid response structure for ${method}`);
        }
        response = parsed as IPCResponse<T>;
      } else if (isIPCResponse(responseRaw)) {
        response = responseRaw as IPCResponse<T>;
      } else {
        log.error(`[Bridge] Unexpected response type: ${typeof responseRaw}`);
        throw new Error(`Unexpected response type: ${typeof responseRaw}`);
      }

      if (!response.success) {
        log.error(`[Bridge] Error response for ${method}: ${response.error}`);
        throw new Error(response.error || 'Unknown error');
      }

      if (shouldLog) {
        log.debug(`[Bridge] Successfully processed ${method}`);
      }
      return response.data as T;
    }

    // Development mode only: dynamically import mock data
    // Note: mockData types are not strictly validated - this is intentional for dev mode flexibility
    // Real API calls in production go through proper type checking via IPC response handling above
    if (import.meta.env.DEV) {
      const { mockData } = await import('./mockData');
      // Small delay to simulate network
      await new Promise((resolve) => setTimeout(resolve, 50));
      const data = mockData[method];
      if (data === undefined) {
        log.warning(`[Bridge DEV] No mock data for method: ${method}`);
        return {} as T;
      }
      log.debug(`[Bridge DEV] Returning mock data for ${method}`);
      return data as T;
    }

    throw new Error('Backend not available');
  }

  // Connection methods
  async connect(connectionInfo: {
    server: string;
    port?: number;
    database: string;
    username?: string;
    password?: string;
    useWindowsAuth: boolean;
    dbType?: 'sqlserver' | 'postgresql' | 'mysql';
    ssh?: {
      enabled: boolean;
      host: string;
      port: number;
      username: string;
      authType: string;
      password?: string;
      privateKeyPath?: string;
      keyPassphrase?: string;
    };
  }): Promise<{ connectionId: string }> {
    return this.call('connect', connectionInfo);
  }

  async disconnect(connectionId: string): Promise<void> {
    return this.call('disconnect', { connectionId });
  }

  async testConnection(connectionInfo: {
    server: string;
    port?: number;
    database: string;
    username?: string;
    password?: string;
    useWindowsAuth: boolean;
    dbType?: 'sqlserver' | 'postgresql' | 'mysql';
    ssh?: {
      enabled: boolean;
      host: string;
      port: number;
      username: string;
      authType: string;
      password?: string;
      privateKeyPath?: string;
      keyPassphrase?: string;
    };
  }): Promise<{ success: boolean; message: string }> {
    return this.call('testConnection', connectionInfo);
  }

  // Query methods
  async executeQuery(
    connectionId: string,
    sql: string,
    useCache = true
  ): Promise<{
    columns: { name: string; type: string; comment?: string }[];
    rows: (string | null)[][];
    affectedRows: number;
    executionTimeMs: number;
    cached: boolean;
  }> {
    return this.call('executeQuery', { connectionId, sql, useCache });
  }

  async executeQueryPaginated(
    connectionId: string,
    sql: string,
    startRow: number,
    endRow: number,
    sortModel?: Array<{ colId: string; sort: 'asc' | 'desc' }>
  ): Promise<{
    columns: { name: string; type: string }[];
    rows: (string | null)[][];
    affectedRows: number;
    executionTimeMs: number;
  }> {
    return this.call('executeQueryPaginated', {
      connectionId,
      sql,
      startRow,
      endRow,
      sortModel,
    });
  }

  async getRowCount(connectionId: string, sql: string): Promise<{ rowCount: number }> {
    return this.call('getRowCount', { connectionId, sql });
  }

  async cancelQuery(connectionId: string): Promise<void> {
    return this.call('cancelQuery', { connectionId });
  }

  // Schema methods
  async getDatabases(connectionId: string): Promise<string[]> {
    return this.call('getDatabases', { connectionId });
  }

  async getTables(
    connectionId: string,
    database: string
  ): Promise<{
    tables: {
      schema: string;
      name: string;
      type: string;
      comment?: string;
    }[];
    loadTimeMs: number;
  }> {
    log.info(`[Bridge] Getting tables for connection: ${connectionId}, database: ${database}`);
    const startTime = performance.now();
    const tables = await this.call<
      {
        schema: string;
        name: string;
        type: string;
        comment?: string;
      }[]
    >('getTables', { connectionId, database });
    const endTime = performance.now();
    const loadTimeMs = endTime - startTime;

    log.info(`[Bridge] Received ${tables.length} tables in ${loadTimeMs.toFixed(2)}ms`);

    return {
      tables,
      loadTimeMs,
    };
  }

  async getColumns(
    connectionId: string,
    table: string
  ): Promise<
    {
      name: string;
      type: string;
      size: number;
      nullable: boolean;
      isPrimaryKey: boolean;
      comment?: string;
    }[]
  > {
    return this.call('getColumns', { connectionId, table });
  }

  // Transaction methods
  async beginTransaction(connectionId: string): Promise<void> {
    return this.call('beginTransaction', { connectionId });
  }

  async commit(connectionId: string): Promise<void> {
    return this.call('commit', { connectionId });
  }

  async rollback(connectionId: string): Promise<void> {
    return this.call('rollback', { connectionId });
  }

  // Export methods
  async exportCSV(data: unknown, filepath: string): Promise<void> {
    return this.call('exportCSV', { data, filepath });
  }

  async exportJSON(data: unknown, filepath: string): Promise<void> {
    return this.call('exportJSON', { data, filepath });
  }

  async exportExcel(data: unknown, filepath: string): Promise<void> {
    return this.call('exportExcel', { data, filepath });
  }

  // SQL builder methods (dialect-aware, delegated to backend)
  async buildDataViewSql(
    connectionId: string,
    tableName: string,
    limit: number,
    whereClause?: string
  ): Promise<{ sql: string }> {
    return this.call('buildDataViewSql', { connectionId, tableName, limit, whereClause });
  }

  async buildWhereClause(
    connectionId: string,
    conditions: { column: string; value: string | null }[]
  ): Promise<{ whereClause: string }> {
    return this.call('buildWhereClause', { connectionId, conditions });
  }

  async buildDmlStatements(
    connectionId: string,
    params: {
      schema: string;
      table: string;
      pkColumns: string[];
      updates?: {
        changes: Record<string, string | null>;
        originalData: Record<string, string | null>;
      }[];
      inserts?: Record<string, string | null>[];
      deletes?: Record<string, string | null>[];
    }
  ): Promise<{ statements: string[] }> {
    return this.call('buildDmlStatements', { connectionId, ...params });
  }

  // SQL methods
  async uppercaseKeywords(sql: string): Promise<{ sql: string }> {
    return this.call('uppercaseKeywords', { sql });
  }

  // History methods
  async getQueryHistory(): Promise<
    {
      id: string;
      sql: string;
      connectionId: string;
      timestamp: number;
      executionTimeMs: number;
      success: boolean;
      errorMessage: string;
      affectedRows: number;
      isFavorite: boolean;
    }[]
  > {
    return this.call('getQueryHistory', {});
  }

  async removeQueryHistory(id: string): Promise<{ removed: boolean }> {
    return this.call('removeQueryHistory', { id });
  }

  async clearQueryHistory(): Promise<{ cleared: boolean }> {
    return this.call('clearQueryHistory', {});
  }

  async setQueryHistoryFavorite(id: string, isFavorite: boolean): Promise<{ updated: boolean }> {
    return this.call('setQueryHistoryFavorite', { id, isFavorite });
  }

  // ER diagram methods
  async parseERDiagram(params: {
    content?: string;
    filename?: string;
    filepath?: string;
  }): Promise<ERDiagramParseResult> {
    return this.call('parseERDiagram', params);
  }

  // Execution plan methods
  async getExecutionPlan(
    connectionId: string,
    sql: string,
    actual = false
  ): Promise<{ plan: string; actual: boolean }> {
    return this.call('getExecutionPlan', { connectionId, sql, actual });
  }

  // Cache methods
  async getCacheStats(): Promise<{
    currentSizeBytes: number;
    maxSizeBytes: number;
    usagePercent: number;
  }> {
    return this.call('getCacheStats', {});
  }

  async clearCache(): Promise<{ cleared: boolean }> {
    return this.call('clearCache', {});
  }

  // Async query methods
  async executeAsyncQuery(connectionId: string, sql: string): Promise<{ queryId: string }> {
    return this.call('executeAsyncQuery', { connectionId, sql });
  }

  async getAsyncQueryResult(queryId: string): Promise<AsyncQueryResultResponse> {
    return this.call('getAsyncQueryResult', { queryId });
  }

  async cancelAsyncQuery(queryId: string): Promise<{ cancelled: boolean }> {
    return this.call('cancelAsyncQuery', { queryId });
  }

  async removeAsyncQuery(queryId: string): Promise<{ removed: boolean }> {
    return this.call('removeAsyncQuery', { queryId });
  }

  async getActiveQueries(): Promise<string[]> {
    return this.call('getActiveQueries', {});
  }

  // SIMD filter methods
  async filterResultSet(
    connectionId: string,
    sql: string,
    columnIndex: number,
    filterType: 'equals' | 'contains' | 'range',
    filterValue: string,
    filterValueMax?: string
  ): Promise<{
    columns: { name: string; type: string }[];
    rows: (string | null)[][];
    totalRows: number;
    filteredRows: number;
    simdAvailable: boolean;
  }> {
    return this.call('filterResultSet', {
      connectionId,
      sql,
      columnIndex,
      filterType,
      filterValue,
      filterValueMax,
    });
  }

  // Settings methods
  async getSettings(): Promise<{
    general: {
      autoConnect: boolean;
      lastConnectionId: string;
      confirmOnExit: boolean;
      maxQueryHistory: number;
      maxRecentConnections: number;
      language: string;
    };
    editor: {
      fontSize: number;
      fontFamily: string;
      wordWrap: boolean;
      tabSize: number;
      insertSpaces: boolean;
      showLineNumbers: boolean;
      showMinimap: boolean;
      theme: string;
    };
    grid: {
      defaultPageSize: number;
      showRowNumbers: boolean;
      enableCellEditing: boolean;
      dateFormat: string;
      nullDisplay: string;
    };
    query: {
      timeoutSeconds: number;
    };
  }> {
    return this.call('getSettings', {});
  }

  async updateSettings(settings: {
    general?: Partial<{
      autoConnect: boolean;
      confirmOnExit: boolean;
      maxQueryHistory: number;
      language: string;
    }>;
    editor?: Partial<{
      fontSize: number;
      fontFamily: string;
      wordWrap: boolean;
      tabSize: number;
      theme: string;
    }>;
    grid?: Partial<{
      defaultPageSize: number;
      showRowNumbers: boolean;
      nullDisplay: string;
    }>;
    query?: Partial<{
      timeoutSeconds: number;
    }>;
    window?: Partial<{
      width: number;
      height: number;
      x: number;
      y: number;
      isMaximized: boolean;
    }>;
  }): Promise<{ saved: boolean }> {
    return this.call('updateSettings', settings);
  }

  // Connection profile methods
  async getConnectionProfiles(): Promise<{
    profiles: {
      id: string;
      name: string;
      server: string;
      port?: number;
      database: string;
      username: string;
      useWindowsAuth: boolean;
      savePassword?: boolean;
      isProduction?: boolean;
      isReadOnly?: boolean;
      environment?: 'development' | 'staging' | 'production';
      dbType?: 'sqlserver' | 'postgresql' | 'mysql';
      ssh?: {
        enabled: boolean;
        host: string;
        port: number;
        username: string;
        authType: 'password' | 'privateKey';
        privateKeyPath: string;
        savePassword: boolean;
      };
    }[];
  }> {
    return this.call('getConnectionProfiles', {});
  }

  async saveConnectionProfile(profile: {
    id?: string;
    name: string;
    server: string;
    port?: number;
    database: string;
    username?: string;
    useWindowsAuth: boolean;
    savePassword?: boolean;
    password?: string;
    isProduction?: boolean;
    isReadOnly?: boolean;
    environment?: 'development' | 'staging' | 'production';
    dbType?: 'sqlserver' | 'postgresql' | 'mysql';
    ssh?: {
      enabled: boolean;
      host: string;
      port: number;
      username: string;
      authType: 'password' | 'privateKey';
      privateKeyPath?: string;
      savePassword?: boolean;
      password?: string;
      keyPassphrase?: string;
    };
  }): Promise<{ id: string }> {
    return this.call('saveConnectionProfile', profile);
  }

  async deleteConnectionProfile(id: string): Promise<{ deleted: boolean }> {
    return this.call('deleteConnectionProfile', { id });
  }

  async getProfilePassword(profileId: string): Promise<{ password: string }> {
    return this.call('getProfilePassword', { id: profileId });
  }

  async getSshPassword(profileId: string): Promise<{ password: string }> {
    return this.call('getSshPassword', { id: profileId });
  }

  async getSshKeyPassphrase(profileId: string): Promise<{ passphrase: string }> {
    return this.call('getSshKeyPassphrase', { id: profileId });
  }

  // Session methods
  async getSessionState(): Promise<{
    activeConnectionId: string;
    activeTabId: string;
    windowX: number;
    windowY: number;
    windowWidth: number;
    windowHeight: number;
    isMaximized: boolean;
    leftPanelWidth: number;
    bottomPanelHeight: number;
    openTabs: {
      id: string;
      title: string;
      content: string;
      filePath: string;
      isDirty: boolean;
      cursorLine: number;
      cursorColumn: number;
    }[];
    expandedTreeNodes: string[];
  }> {
    return this.call('getSessionState', {});
  }

  async saveSessionState(state: {
    activeConnectionId?: string;
    activeTabId?: string;
    windowX?: number;
    windowY?: number;
    windowWidth?: number;
    windowHeight?: number;
    isMaximized?: boolean;
    leftPanelWidth?: number;
    bottomPanelHeight?: number;
    openTabs?: {
      id: string;
      title: string;
      content: string;
      filePath: string;
      isDirty: boolean;
      cursorLine: number;
      cursorColumn: number;
    }[];
    expandedTreeNodes?: string[];
  }): Promise<{ saved: boolean }> {
    return this.call('saveSessionState', state);
  }

  // Search methods
  async searchObjects(
    connectionId: string,
    pattern: string,
    options?: {
      searchTables?: boolean;
      searchViews?: boolean;
      searchProcedures?: boolean;
      searchFunctions?: boolean;
      searchColumns?: boolean;
      caseSensitive?: boolean;
      maxResults?: number;
    }
  ): Promise<
    {
      objectType: string;
      schemaName: string;
      objectName: string;
      parentName: string;
    }[]
  > {
    return this.call('searchObjects', { connectionId, pattern, ...options });
  }

  async quickSearch(connectionId: string, prefix: string, limit = 20): Promise<string[]> {
    return this.call('quickSearch', { connectionId, prefix, limit });
  }

  // Table metadata methods
  async getIndexes(
    connectionId: string,
    table: string
  ): Promise<
    {
      name: string;
      columns: string[];
      isUnique: boolean;
      isPrimaryKey: boolean;
      type: string;
    }[]
  > {
    return this.call('getIndexes', { connectionId, table });
  }

  async getConstraints(
    connectionId: string,
    table: string
  ): Promise<
    {
      name: string;
      type: string;
      columns: string[];
      definition: string;
    }[]
  > {
    return this.call('getConstraints', { connectionId, table });
  }

  async getForeignKeys(
    connectionId: string,
    table: string
  ): Promise<
    {
      name: string;
      columns: string[];
      referencedTable: string;
      referencedColumns: string[];
      onDelete: string;
      onUpdate: string;
    }[]
  > {
    return this.call('getForeignKeys', { connectionId, table });
  }

  async getReferencingForeignKeys(
    connectionId: string,
    table: string
  ): Promise<
    {
      name: string;
      referencingTable: string;
      referencingColumns: string[];
      columns: string[];
      onDelete: string;
      onUpdate: string;
    }[]
  > {
    return this.call('getReferencingForeignKeys', { connectionId, table });
  }

  async getTriggers(
    connectionId: string,
    table: string
  ): Promise<
    {
      name: string;
      type: string;
      events: string[];
      isEnabled: boolean;
      definition: string;
    }[]
  > {
    return this.call('getTriggers', { connectionId, table });
  }

  async getTableMetadata(
    connectionId: string,
    table: string
  ): Promise<{
    schema: string;
    name: string;
    type: string;
    rowCount: number;
    createdAt: string;
    modifiedAt: string;
    owner: string;
    comment: string;
  }> {
    return this.call('getTableMetadata', { connectionId, table });
  }

  async getTableDDL(connectionId: string, table: string): Promise<{ ddl: string }> {
    return this.call('getTableDDL', { connectionId, table });
  }

  async writeFrontendLog(content: string): Promise<void> {
    return this.call('writeFrontendLog', { content });
  }

  // File operations
  async saveQueryToFile(content: string, defaultFileName?: string): Promise<{ filePath: string }> {
    return this.call('saveQueryToFile', { content, defaultFileName });
  }

  async loadQueryFromFile(): Promise<{ filePath: string; content: string }> {
    return this.call('loadQueryFromFile', {});
  }

  async browseFile(filter?: string): Promise<{ filePath: string }> {
    return this.call('browseFile', { filter });
  }

  // Bookmark operations
  async getBookmarks(): Promise<
    {
      id: string;
      name: string;
      content: string;
    }[]
  > {
    return this.call('getBookmarks', {});
  }

  async saveBookmark(id: string, name: string, content: string): Promise<void> {
    return this.call('saveBookmark', { id, name, content });
  }

  async deleteBookmark(id: string): Promise<void> {
    return this.call('deleteBookmark', { id });
  }
}

export const bridge = new Bridge();
