import type { ConstraintInfo, TableMetadata } from '../../types';
import * as S from '../schemas';
import type { BridgeLogger, IpcInvoker, ResponseValidator } from './types';

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

class SchemaProviderImpl implements SchemaProvider {
  constructor(
    private readonly invoker: IpcInvoker,
    private readonly logger: BridgeLogger,
    private readonly validator: ResponseValidator
  ) {}

  async getDatabases(connectionId: string): Promise<string[]> {
    const raw = await this.invoker.invoke('getDatabases', { connectionId });
    return this.validator.parse(S.getDatabases, raw);
  }

  async getTables(connectionId: string, database: string): Promise<GetTablesResult> {
    this.logger.info(
      `[Bridge] Getting tables for connection: ${connectionId}, database: ${database}`
    );
    const startTime = performance.now();
    const raw = await this.invoker.invoke('getTables', { connectionId, database });
    const tables = this.validator.parse(S.getTables, raw);
    const loadTimeMs = performance.now() - startTime;
    this.logger.info(`[Bridge] Received ${tables.length} tables in ${loadTimeMs.toFixed(2)}ms`);
    return { tables, loadTimeMs };
  }

  async getColumns(connectionId: string, table: string): Promise<ColumnInfo[]> {
    const raw = await this.invoker.invoke('getColumns', { connectionId, table });
    return this.validator.parse(S.getColumns, raw);
  }

  async getIndexes(connectionId: string, table: string): Promise<IndexInfo[]> {
    const raw = await this.invoker.invoke('getIndexes', { connectionId, table });
    return this.validator.parse(S.getIndexes, raw);
  }

  async getConstraints(connectionId: string, table: string): Promise<ConstraintInfo[]> {
    const raw = await this.invoker.invoke('getConstraints', { connectionId, table });
    return this.validator.parse(S.getConstraints, raw);
  }

  async getForeignKeys(connectionId: string, table: string): Promise<ForeignKeyInfo[]> {
    const raw = await this.invoker.invoke('getForeignKeys', { connectionId, table });
    return this.validator.parse(S.getForeignKeys, raw);
  }

  async getReferencingForeignKeys(
    connectionId: string,
    table: string
  ): Promise<ReferencingForeignKeyInfo[]> {
    const raw = await this.invoker.invoke('getReferencingForeignKeys', { connectionId, table });
    return this.validator.parse(S.getReferencingForeignKeys, raw);
  }

  async getTriggers(connectionId: string, table: string): Promise<TriggerInfo[]> {
    const raw = await this.invoker.invoke('getTriggers', { connectionId, table });
    return this.validator.parse(S.getTriggers, raw);
  }

  async getTableMetadata(connectionId: string, table: string): Promise<TableMetadata> {
    const raw = await this.invoker.invoke('getTableMetadata', { connectionId, table });
    return this.validator.parse(S.getTableMetadata, raw);
  }

  async getTableDDL(connectionId: string, table: string): Promise<{ ddl: string }> {
    const raw = await this.invoker.invoke('getTableDDL', { connectionId, table });
    return this.validator.parse(S.getTableDDL, raw);
  }

  async clearSchemaCache(): Promise<{ cleared: boolean }> {
    const raw = await this.invoker.invoke('clearSchemaCache', {});
    return this.validator.parse(S.clearCache, raw);
  }

  async parseERDiagram(params: {
    content?: string;
    filename?: string;
    filepath?: string;
  }): Promise<ERDiagramParseResult> {
    const raw = await this.invoker.invoke('parseERDiagram', params);
    // S.parseERDiagram は z.any() のため parse 後の型は unknown 相当。
    // backend 側 IPC が ERDiagramParseResult 形状を返す契約。
    return this.validator.parse(S.parseERDiagram, raw) as ERDiagramParseResult;
  }
}

export function createSchemaProvider(
  invoker: IpcInvoker,
  logger: BridgeLogger,
  validator: ResponseValidator
): SchemaProvider {
  return new SchemaProviderImpl(invoker, logger, validator);
}
