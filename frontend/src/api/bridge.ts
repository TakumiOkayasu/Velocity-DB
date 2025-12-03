import type { IPCRequest, IPCResponse } from '../types';

declare global {
  interface Window {
    invoke?: (request: string) => Promise<string>;
  }
}

// Development mode mock data
const mockData: Record<string, unknown> = {
  connect: { connectionId: 'mock-conn-1' },
  disconnect: undefined,
  testConnection: { success: true, message: 'Mock connection successful' },
  executeQuery: {
    columns: [
      { name: 'id', type: 'int' },
      { name: 'name', type: 'nvarchar' },
      { name: 'created_at', type: 'datetime' },
    ],
    rows: [
      ['1', 'Test Item 1', '2024-01-01 00:00:00'],
      ['2', 'Test Item 2', '2024-01-02 00:00:00'],
      ['3', 'Test Item 3', '2024-01-03 00:00:00'],
    ],
    affectedRows: 0,
    executionTimeMs: 15,
    cached: false,
  },
  getCacheStats: {
    currentSizeBytes: 0,
    maxSizeBytes: 104857600,
    usagePercent: 0,
  },
  clearCache: { cleared: true },
  getDatabases: ['master', 'tempdb', 'model', 'msdb'],
  getTables: [
    { schema: 'dbo', name: 'Users', type: 'TABLE' },
    { schema: 'dbo', name: 'Orders', type: 'TABLE' },
    { schema: 'dbo', name: 'Products', type: 'TABLE' },
  ],
  getColumns: [
    { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
    { name: 'name', type: 'nvarchar', size: 255, nullable: false, isPrimaryKey: false },
    { name: 'created_at', type: 'datetime', size: 8, nullable: true, isPrimaryKey: false },
  ],
  formatSQL: { sql: 'SELECT\n    *\nFROM\n    users\nWHERE\n    id = 1;' },
  getQueryHistory: [],
  parseA5ER: { name: '', databaseType: '', tables: [], relations: [] },
  getExecutionPlan: { plan: 'Mock execution plan text', actual: false },
};

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

    // Development mode: return mock data
    if (import.meta.env.DEV) {
      // Small delay to simulate network
      await new Promise((resolve) => setTimeout(resolve, 50));
      return (mockData[method] ?? {}) as T;
    }

    throw new Error('Backend not available');
  }

  // Connection methods
  async connect(connectionInfo: {
    server: string;
    database: string;
    username?: string;
    password?: string;
    useWindowsAuth: boolean;
  }): Promise<{ connectionId: string }> {
    return this.call('connect', connectionInfo);
  }

  async disconnect(connectionId: string): Promise<void> {
    return this.call('disconnect', { connectionId });
  }

  async testConnection(connectionInfo: {
    server: string;
    database: string;
    username?: string;
    password?: string;
    useWindowsAuth: boolean;
  }): Promise<{ success: boolean; message: string }> {
    return this.call('testConnection', connectionInfo);
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
}

export const bridge = new Bridge();
