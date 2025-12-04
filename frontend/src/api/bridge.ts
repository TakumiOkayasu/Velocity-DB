import type { IPCRequest, IPCResponse } from '../types';

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
      const responseStr = await window.invoke(JSON.stringify(request));
      const response: IPCResponse<T> = JSON.parse(responseStr);

      if (!response.success) {
        throw new Error(response.error || 'Unknown error');
      }

      return response.data as T;
    }

    // Development mode only: dynamically import mock data
    if (import.meta.env.DEV) {
      const { mockData } = await import('./mockData');
      // Small delay to simulate network
      await new Promise((resolve) => setTimeout(resolve, 50));
      return (mockData[method] ?? {}) as T;
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
    return this.call('testConnection', { ...connectionInfo, server: serverWithPort });
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
  ): Promise<
    {
      schema: string;
      name: string;
      type: string;
    }[]
  > {
    return this.call('getTables', { connectionId, database });
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
  }): Promise<{ saved: boolean }> {
    return this.call('updateSettings', settings);
  }

  // Connection profile methods
  async getConnectionProfiles(): Promise<
    {
      id: string;
      name: string;
      server: string;
      database: string;
      username: string;
      useWindowsAuth: boolean;
    }[]
  > {
    return this.call('getConnectionProfiles', {});
  }

  async saveConnectionProfile(profile: {
    id?: string;
    name: string;
    server: string;
    database: string;
    username?: string;
    useWindowsAuth: boolean;
  }): Promise<{ id: string }> {
    return this.call('saveConnectionProfile', profile);
  }

  async deleteConnectionProfile(id: string): Promise<{ deleted: boolean }> {
    return this.call('deleteConnectionProfile', { id });
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
}

export const bridge = new Bridge();
