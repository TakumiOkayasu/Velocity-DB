import type { ConstraintInfo, TableMetadata } from '../../types';
import * as S from '../schemas';
import { BaseProvider, type BridgeLogger, type IpcInvoker, type ResponseValidator } from './types';

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

export interface TableInfo {
  schema: string;
  name: string;
  type: string;
  comment?: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  size: number;
  nullable: boolean;
  isPrimaryKey: boolean;
  comment?: string;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimaryKey: boolean;
  type: string;
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
  type: string;
  events: string[];
  isEnabled: boolean;
  definition: string;
}

export interface GetTablesResult {
  tables: TableInfo[];
  loadTimeMs: number;
}

export interface SchemaProvider {
  getDatabases(connectionId: string): Promise<string[]>;
  getTables(connectionId: string, database: string): Promise<GetTablesResult>;
  getColumns(connectionId: string, table: string): Promise<ColumnInfo[]>;
  getIndexes(connectionId: string, table: string): Promise<IndexInfo[]>;
  getConstraints(connectionId: string, table: string): Promise<ConstraintInfo[]>;
  getForeignKeys(connectionId: string, table: string): Promise<ForeignKeyInfo[]>;
  getReferencingForeignKeys(
    connectionId: string,
    table: string
  ): Promise<ReferencingForeignKeyInfo[]>;
  getTriggers(connectionId: string, table: string): Promise<TriggerInfo[]>;
  getTableMetadata(connectionId: string, table: string): Promise<TableMetadata>;
  getTableDDL(connectionId: string, table: string): Promise<{ ddl: string }>;
  clearSchemaCache(): Promise<{ cleared: boolean }>;
  parseERDiagram(params: {
    content?: string;
    filename?: string;
    filepath?: string;
  }): Promise<ERDiagramParseResult>;
}

class SchemaProviderImpl extends BaseProvider implements SchemaProvider {
  constructor(
    invoker: IpcInvoker,
    private readonly logger: BridgeLogger,
    validator: ResponseValidator
  ) {
    super(invoker, validator);
  }

  async getDatabases(connectionId: string): Promise<string[]> {
    return this.invokeAndParse('getDatabases', { connectionId }, S.getDatabases);
  }

  async getTables(connectionId: string, database: string): Promise<GetTablesResult> {
    this.logger.info(
      `[Bridge] Getting tables for connection: ${connectionId}, database: ${database}`
    );
    const startTime = performance.now();
    const tables = await this.invokeAndParse('getTables', { connectionId, database }, S.getTables);
    const loadTimeMs = performance.now() - startTime;
    this.logger.info(`[Bridge] Received ${tables.length} tables in ${loadTimeMs.toFixed(2)}ms`);
    return { tables, loadTimeMs };
  }

  async getColumns(connectionId: string, table: string): Promise<ColumnInfo[]> {
    return this.invokeAndParse('getColumns', { connectionId, table }, S.getColumns);
  }

  async getIndexes(connectionId: string, table: string): Promise<IndexInfo[]> {
    return this.invokeAndParse('getIndexes', { connectionId, table }, S.getIndexes);
  }

  async getConstraints(connectionId: string, table: string): Promise<ConstraintInfo[]> {
    return this.invokeAndParse('getConstraints', { connectionId, table }, S.getConstraints);
  }

  async getForeignKeys(connectionId: string, table: string): Promise<ForeignKeyInfo[]> {
    return this.invokeAndParse('getForeignKeys', { connectionId, table }, S.getForeignKeys);
  }

  async getReferencingForeignKeys(
    connectionId: string,
    table: string
  ): Promise<ReferencingForeignKeyInfo[]> {
    return this.invokeAndParse(
      'getReferencingForeignKeys',
      { connectionId, table },
      S.getReferencingForeignKeys
    );
  }

  async getTriggers(connectionId: string, table: string): Promise<TriggerInfo[]> {
    return this.invokeAndParse('getTriggers', { connectionId, table }, S.getTriggers);
  }

  async getTableMetadata(connectionId: string, table: string): Promise<TableMetadata> {
    return this.invokeAndParse('getTableMetadata', { connectionId, table }, S.getTableMetadata);
  }

  async getTableDDL(connectionId: string, table: string): Promise<{ ddl: string }> {
    return this.invokeAndParse('getTableDDL', { connectionId, table }, S.getTableDDL);
  }

  async clearSchemaCache(): Promise<{ cleared: boolean }> {
    return this.invokeAndParse('clearSchemaCache', {}, S.clearCache);
  }

  async parseERDiagram(params: {
    content?: string;
    filename?: string;
    filepath?: string;
  }): Promise<ERDiagramParseResult> {
    // S.parseERDiagram は z.any() のため parse 後の型は unknown 相当。
    // backend 側 IPC が ERDiagramParseResult 形状を返す契約。
    return (await this.invokeAndParse(
      'parseERDiagram',
      params,
      S.parseERDiagram
    )) as ERDiagramParseResult;
  }
}

export function createSchemaProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): SchemaProvider {
  return new SchemaProviderImpl(invoker, logger, validator);
}
