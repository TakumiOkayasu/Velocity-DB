import type { IPCRequest, IPCResponse } from '../types';
import { log } from '../utils/logger';

declare global {
  interface Window {
    invoke?: (request: string) => Promise<string>;
  }
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
        response = JSON.parse(responseRaw);
      } else if (typeof responseRaw === 'object' && responseRaw !== null) {
        // webview already parsed the JSON for us
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
  }): Promise<{ connectionId: string }> {
    // Build server string with port if provided
    const serverWithPort =
      connectionInfo.port && connectionInfo.port !== 1433
        ? `${connectionInfo.server},${connectionInfo.port}`
        : connectionInfo.server;
    return this.call('connect', { ...connectionInfo, server: serverWithPort });
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
  }): Promise<{ success: boolean; message: string }> {
    // Build server string with port if provided
    const serverWithPort =
      connectionInfo.port && connectionInfo.port !== 1433
        ? `${connectionInfo.server},${connectionInfo.port}`
        : connectionInfo.server;
    return this.call('testConnection', {
      ...connectionInfo,
      server: serverWithPort,
    });
  }

  // Query methods
  async executeQuery(
    connectionId: string,
    sql: string,
    useCache = true
  ): Promise<{
    columns: { name: string; type: string }[];
    rows: string[][];
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
    rows: string[][];
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

  // SQL methods
  async formatSQL(sql: string): Promise<{ sql: string }> {
    return this.call('formatSQL', { sql });
  }

  async uppercaseKeywords(sql: string): Promise<{ sql: string }> {
    return this.call('uppercaseKeywords', { sql });
  }

  // History methods
  async getQueryHistory(): Promise<
    {
      id: string;
      sql: string;
      timestamp: number;
      executionTimeMs: number;
      success: boolean;
    }[]
  > {
    return this.call('getQueryHistory', {});
  }

  // A5:ER methods
  async parseA5ER(filepath: string): Promise<{
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
      }[];
      indexes: {
        name: string;
        columns: string[];
        isUnique: boolean;
      }[];
      posX: number;
      posY: number;
    }[];
    relations: {
      name: string;
      parentTable: string;
      childTable: string;
      parentColumn: string;
      childColumn: string;
      cardinality: string;
    }[];
  }> {
    return this.call('parseA5ER', { filepath });
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

  async getAsyncQueryResult(queryId: string): Promise<{
    queryId: string;
    status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
    error?: string;
    columns?: { name: string; type: string }[];
    rows?: string[][];
    affectedRows?: number;
    executionTimeMs?: number;
  }> {
    return this.call('getAsyncQueryResult', { queryId });
  }

  async cancelAsyncQuery(queryId: string): Promise<{ cancelled: boolean }> {
    return this.call('cancelAsyncQuery', { queryId });
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
    rows: string[][];
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
  }): Promise<{ id: string }> {
    return this.call('saveConnectionProfile', profile);
  }

  async deleteConnectionProfile(id: string): Promise<{ deleted: boolean }> {
    return this.call('deleteConnectionProfile', { id });
  }

  async getProfilePassword(profileId: string): Promise<{ password: string }> {
    return this.call('getProfilePassword', { id: profileId });
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
}

export const bridge = new Bridge();
