import type { IPCRequest, IPCResponse } from '../types'

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
    }

    if (window.invoke) {
      const responseStr = await window.invoke(JSON.stringify(request))
      const response: IPCResponse<T> = JSON.parse(responseStr)

      if (!response.success) {
        throw new Error(response.error || 'Unknown error')
      }

      return response.data as T
    }

    // Development mode: mock responses
    console.warn(`Bridge call in development mode: ${method}`, params)
    return {} as T
  }

  // Connection methods
  async connect(connectionInfo: {
    server: string;
    database: string;
    username?: string;
    password?: string;
    useWindowsAuth: boolean;
  }): Promise<{ connectionId: string }> {
    return this.call('connect', connectionInfo)
  }

  async disconnect(connectionId: string): Promise<void> {
    return this.call('disconnect', { connectionId })
  }

  async testConnection(connectionInfo: {
    server: string;
    database: string;
    username?: string;
    password?: string;
    useWindowsAuth: boolean;
  }): Promise<{ success: boolean; message: string }> {
    return this.call('testConnection', connectionInfo)
  }

  // Query methods
  async executeQuery(connectionId: string, sql: string): Promise<{
    columns: { name: string; type: string }[];
    rows: string[][];
    affectedRows: number;
    executionTimeMs: number;
  }> {
    return this.call('executeQuery', { connectionId, sql })
  }

  async cancelQuery(connectionId: string): Promise<void> {
    return this.call('cancelQuery', { connectionId })
  }

  // Schema methods
  async getDatabases(connectionId: string): Promise<string[]> {
    return this.call('getDatabases', { connectionId })
  }

  async getTables(connectionId: string, database: string): Promise<{
    schema: string;
    name: string;
    type: string;
  }[]> {
    return this.call('getTables', { connectionId, database })
  }

  async getColumns(connectionId: string, table: string): Promise<{
    name: string;
    type: string;
    size: number;
    nullable: boolean;
    isPrimaryKey: boolean;
  }[]> {
    return this.call('getColumns', { connectionId, table })
  }

  // Transaction methods
  async beginTransaction(connectionId: string): Promise<void> {
    return this.call('beginTransaction', { connectionId })
  }

  async commit(connectionId: string): Promise<void> {
    return this.call('commit', { connectionId })
  }

  async rollback(connectionId: string): Promise<void> {
    return this.call('rollback', { connectionId })
  }

  // Export methods
  async exportCSV(data: unknown, filepath: string): Promise<void> {
    return this.call('exportCSV', { data, filepath })
  }

  async exportJSON(data: unknown, filepath: string): Promise<void> {
    return this.call('exportJSON', { data, filepath })
  }

  async exportExcel(data: unknown, filepath: string): Promise<void> {
    return this.call('exportExcel', { data, filepath })
  }

  // SQL methods
  async formatSQL(sql: string): Promise<{ sql: string }> {
    return this.call('formatSQL', { sql })
  }

  // History methods
  async getQueryHistory(): Promise<{
    id: string;
    sql: string;
    timestamp: number;
    executionTimeMs: number;
    success: boolean;
  }[]> {
    return this.call('getQueryHistory', {})
  }

  // A5:ER methods
  async parseA5ER(filepath: string): Promise<{
    tables: { name: string; columns: { name: string; type: string }[] }[];
    relations: { source: string; target: string; cardinality: string }[];
  }> {
    return this.call('parseA5ER', { filepath })
  }
}

export const bridge = new Bridge()
