import type {
  AsyncQueryResultResponse,
  ConstraintInfo,
  DatabaseType,
  TableMetadata,
} from '../types';
import { DEFAULT_PAGE } from '../utils/erDiagramConstants';
import type { ERDiagramModel } from '../utils/erDiagramParser';
import {
  connectionProvider,
  exportProvider,
  ioProvider,
  queryProvider,
  schemaProvider,
  searchProvider,
  settingsProvider,
  transactionProvider,
} from './providers';
import type { ConnectionInfo, TestConnectionInfo } from './providers/connection';
import type { Bookmark } from './providers/io';
import type { CacheStats, QueryHistoryEntry } from './providers/query';
import type {
  ColumnInfo,
  ERDiagramParseResult,
  ForeignKeyInfo,
  GetTablesResult,
  IndexInfo,
  ReferencingForeignKeyInfo,
  TriggerInfo,
} from './providers/schema';
import type { SearchObjectOptions, SearchObjectResult } from './providers/search';
import type {
  AppSettings,
  ConnectionProfile,
  SaveConnectionProfileInput,
  SaveSessionStateInput,
  SessionState,
  UpdateSettingsInput,
} from './providers/settings';
import type { ConnectResultResponse } from './schemas';

// ERImportDialog / erDiagramStore が `import type { ERDiagramParseResult } from '../api/bridge'` で参照しているため、
// schema.ts に型を移設した後も bridge 経由の互換を維持する目的で再エクスポートする。#527 で旧 Bridge 削除時に整理予定。
export type { ERDiagramParseResult } from './providers/schema';

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
      cardinality: toCardinality(r.cardinality),
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

type Cardinality = '1:1' | '1:N' | 'N:M';

function toCardinality(value: string): Cardinality {
  if (value === '1:1' || value === '1:N' || value === 'N:M') return value;
  return '1:N';
}

// Bridge は個別 provider への委譲ラッパ (旧 import 互換用)。完全移行は #527 で本クラス削除予定。
// - Connection methods (#518 で connectionProvider に移管)
// - Query methods (#519 で queryProvider に移管: executeQuery / executeQueryPaginated / getRowCount /
//   cancelQuery / lintSql / async query 5 件 / filterResultSet / getExecutionPlan)
// - Query history / cache / SQL builder (#520 で queryProvider に移管: getQueryHistory /
//   removeQueryHistory / clearQueryHistory / setQueryHistoryFavorite / getCacheStats / clearCache /
//   buildDataViewSql / buildWhereClause / buildDmlStatements / uppercaseKeywords)
// - Schema (#521) / Transaction (#522) / Export (#523) / Settings (#524) / Search (#525) /
//   IO (#526): 移管済 (委譲のみ)
class Bridge {
  // Connection methods (→ connectionProvider)
  async connectAsync(connectionInfo: ConnectionInfo): Promise<{ requestId: string }> {
    return connectionProvider.connectAsync(connectionInfo);
  }

  async getConnectResult(requestId: string): Promise<ConnectResultResponse> {
    return connectionProvider.getConnectResult(requestId);
  }

  async cancelConnect(requestId: string): Promise<void> {
    return connectionProvider.cancelConnect(requestId);
  }

  async disconnect(connectionId: string): Promise<void> {
    return connectionProvider.disconnect(connectionId);
  }

  async testConnection(
    connectionInfo: TestConnectionInfo
  ): Promise<{ success: boolean; message: string }> {
    return connectionProvider.testConnection(connectionInfo);
  }

  // Query methods (→ queryProvider)
  async executeQuery(
    connectionId: string,
    sql: string,
    useCache = true
  ): Promise<
    | {
        columns: { name: string; type: string; comment?: string }[];
        rows: (string | null)[][];
        affectedRows: number;
        executionTimeMs: number;
        cached: boolean;
      }
    | {
        multipleResults: true;
        results: {
          statement: string;
          data: {
            columns: { name: string; type: string }[];
            rows: (string | null)[][];
            affectedRows: number;
            executionTimeMs: number;
          };
        }[];
      }
  > {
    return queryProvider.executeQuery(connectionId, sql, useCache);
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
    return queryProvider.executeQueryPaginated(connectionId, sql, startRow, endRow, sortModel);
  }

  async getRowCount(connectionId: string, sql: string): Promise<{ rowCount: number }> {
    return queryProvider.getRowCount(connectionId, sql);
  }

  async cancelQuery(connectionId: string): Promise<void> {
    return queryProvider.cancelQuery(connectionId);
  }

  async lintSql(
    sql: string,
    dbType: DatabaseType
  ): Promise<{
    diagnostics: { line: number; column: number; code: string; message: string }[];
    lintUnavailable?: boolean;
    reason?: string;
  }> {
    return queryProvider.lintSql(sql, dbType);
  }

  // Schema methods (→ schemaProvider)
  async getDatabases(connectionId: string): Promise<string[]> {
    return schemaProvider.getDatabases(connectionId);
  }

  async getTables(connectionId: string, database: string): Promise<GetTablesResult> {
    return schemaProvider.getTables(connectionId, database);
  }

  async getColumns(connectionId: string, table: string): Promise<ColumnInfo[]> {
    return schemaProvider.getColumns(connectionId, table);
  }

  // Transaction methods (→ transactionProvider)
  async beginTransaction(connectionId: string): Promise<void> {
    return transactionProvider.beginTransaction(connectionId);
  }

  async commit(connectionId: string): Promise<void> {
    return transactionProvider.commit(connectionId);
  }

  async rollback(connectionId: string): Promise<void> {
    return transactionProvider.rollback(connectionId);
  }

  // Export methods (→ exportProvider)
  async exportCSV(data: Record<string, string | null>[], filepath: string): Promise<void> {
    return exportProvider.exportCSV(data, filepath);
  }

  async exportJSON(data: Record<string, string | null>[], filepath: string): Promise<void> {
    return exportProvider.exportJSON(data, filepath);
  }

  async exportExcel(data: Record<string, string | null>[], filepath: string): Promise<void> {
    return exportProvider.exportExcel(data, filepath);
  }

  // SQL builder methods (→ queryProvider)
  async buildDataViewSql(
    connectionId: string,
    tableName: string,
    limit: number,
    whereClause?: string
  ): Promise<{ sql: string }> {
    return queryProvider.buildDataViewSql(connectionId, tableName, limit, whereClause);
  }

  async buildWhereClause(
    connectionId: string,
    conditions: { column: string; value: string | null }[]
  ): Promise<{ whereClause: string }> {
    return queryProvider.buildWhereClause(connectionId, conditions);
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
    return queryProvider.buildDmlStatements(connectionId, params);
  }

  // SQL methods (→ queryProvider)
  async uppercaseKeywords(sql: string): Promise<{ sql: string }> {
    return queryProvider.uppercaseKeywords(sql);
  }

  // History methods (→ queryProvider)
  async getQueryHistory(): Promise<QueryHistoryEntry[]> {
    return queryProvider.getQueryHistory();
  }

  async removeQueryHistory(id: string): Promise<{ removed: boolean }> {
    return queryProvider.removeQueryHistory(id);
  }

  async clearQueryHistory(): Promise<{ cleared: boolean }> {
    return queryProvider.clearQueryHistory();
  }

  async setQueryHistoryFavorite(id: string, isFavorite: boolean): Promise<{ updated: boolean }> {
    return queryProvider.setQueryHistoryFavorite(id, isFavorite);
  }

  // ER diagram methods (→ schemaProvider)
  async parseERDiagram(params: {
    content?: string;
    filename?: string;
    filepath?: string;
  }): Promise<ERDiagramParseResult> {
    return schemaProvider.parseERDiagram(params);
  }

  // Execution plan methods (→ queryProvider)
  async getExecutionPlan(
    connectionId: string,
    sql: string,
    actual = false
  ): Promise<{ plan: string; actual: boolean }> {
    return queryProvider.getExecutionPlan(connectionId, sql, actual);
  }

  // Cache methods (→ queryProvider)
  async getCacheStats(): Promise<CacheStats> {
    return queryProvider.getCacheStats();
  }

  async clearCache(): Promise<{ cleared: boolean }> {
    return queryProvider.clearCache();
  }

  async clearSchemaCache(): Promise<{ cleared: boolean }> {
    return schemaProvider.clearSchemaCache();
  }

  // Async query methods (→ queryProvider)
  async executeAsyncQuery(connectionId: string, sql: string): Promise<{ queryId: string }> {
    return queryProvider.executeAsyncQuery(connectionId, sql);
  }

  async getAsyncQueryResult(queryId: string): Promise<AsyncQueryResultResponse> {
    return queryProvider.getAsyncQueryResult(queryId);
  }

  async cancelAsyncQuery(queryId: string): Promise<{ cancelled: boolean }> {
    return queryProvider.cancelAsyncQuery(queryId);
  }

  async removeAsyncQuery(queryId: string): Promise<{ removed: boolean }> {
    return queryProvider.removeAsyncQuery(queryId);
  }

  async getActiveQueries(): Promise<string[]> {
    return queryProvider.getActiveQueries();
  }

  // SIMD filter methods (→ queryProvider)
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
    return queryProvider.filterResultSet(
      connectionId,
      sql,
      columnIndex,
      filterType,
      filterValue,
      filterValueMax
    );
  }

  // Settings methods (→ settingsProvider)
  async getSettings(): Promise<AppSettings> {
    return settingsProvider.getSettings();
  }

  async updateSettings(settings: UpdateSettingsInput): Promise<{ saved: boolean }> {
    return settingsProvider.updateSettings(settings);
  }

  // Connection profile methods (→ settingsProvider)
  async getConnectionProfiles(): Promise<{ profiles: ConnectionProfile[] }> {
    return settingsProvider.getConnectionProfiles();
  }

  async saveConnectionProfile(profile: SaveConnectionProfileInput): Promise<{ id: string }> {
    return settingsProvider.saveConnectionProfile(profile);
  }

  async deleteConnectionProfile(id: string): Promise<{ deleted: boolean }> {
    return settingsProvider.deleteConnectionProfile(id);
  }

  async getProfilePassword(profileId: string): Promise<{ password: string }> {
    return settingsProvider.getProfilePassword(profileId);
  }

  async getSshPassword(profileId: string): Promise<{ password: string }> {
    return settingsProvider.getSshPassword(profileId);
  }

  async getSshKeyPassphrase(profileId: string): Promise<{ passphrase: string }> {
    return settingsProvider.getSshKeyPassphrase(profileId);
  }

  // Session methods (→ settingsProvider)
  async getSessionState(): Promise<SessionState> {
    return settingsProvider.getSessionState();
  }

  async saveSessionState(state: SaveSessionStateInput): Promise<{ saved: boolean }> {
    return settingsProvider.saveSessionState(state);
  }

  // Search methods (→ searchProvider)
  async searchObjects(
    connectionId: string,
    pattern: string,
    options?: SearchObjectOptions
  ): Promise<SearchObjectResult[]> {
    return searchProvider.searchObjects(connectionId, pattern, options);
  }

  async quickSearch(connectionId: string, prefix: string, limit = 20): Promise<string[]> {
    return searchProvider.quickSearch(connectionId, prefix, limit);
  }

  // Table metadata methods (→ schemaProvider)
  async getIndexes(connectionId: string, table: string): Promise<IndexInfo[]> {
    return schemaProvider.getIndexes(connectionId, table);
  }

  async getConstraints(connectionId: string, table: string): Promise<ConstraintInfo[]> {
    return schemaProvider.getConstraints(connectionId, table);
  }

  async getForeignKeys(connectionId: string, table: string): Promise<ForeignKeyInfo[]> {
    return schemaProvider.getForeignKeys(connectionId, table);
  }

  async getReferencingForeignKeys(
    connectionId: string,
    table: string
  ): Promise<ReferencingForeignKeyInfo[]> {
    return schemaProvider.getReferencingForeignKeys(connectionId, table);
  }

  async getTriggers(connectionId: string, table: string): Promise<TriggerInfo[]> {
    return schemaProvider.getTriggers(connectionId, table);
  }

  async getTableMetadata(connectionId: string, table: string): Promise<TableMetadata> {
    return schemaProvider.getTableMetadata(connectionId, table);
  }

  async getTableDDL(connectionId: string, table: string): Promise<{ ddl: string }> {
    return schemaProvider.getTableDDL(connectionId, table);
  }

  // IO methods (→ ioProvider)
  async writeFrontendLog(content: string): Promise<void> {
    return ioProvider.writeFrontendLog(content);
  }

  async saveQueryToFile(content: string, defaultFileName?: string): Promise<{ filePath: string }> {
    return ioProvider.saveQueryToFile(content, defaultFileName);
  }

  async loadQueryFromFile(): Promise<{ filePath: string; content: string }> {
    return ioProvider.loadQueryFromFile();
  }

  async browseFile(filter?: string): Promise<{ filePath: string }> {
    return ioProvider.browseFile(filter);
  }

  async getBookmarks(): Promise<Bookmark[]> {
    return ioProvider.getBookmarks();
  }

  async saveBookmark(id: string, name: string, content: string): Promise<void> {
    return ioProvider.saveBookmark(id, name, content);
  }

  async deleteBookmark(id: string): Promise<void> {
    return ioProvider.deleteBookmark(id);
  }
}

export const bridge = new Bridge();
