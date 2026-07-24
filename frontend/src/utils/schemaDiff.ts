// スキーマ比較エンジン (純関数層)。
// 2 つのスキーマモデル (テーブル + カラム定義) を比較し、構造化された差分モデルを返す。
// DDL 生成は utils/migrationDdl.ts が担当する (本モジュールは SQL を一切生成しない)。

import type { Column } from '../types';

/** 比較対象のテーブル定義 (schema 名は空文字許容: 既定スキーマ扱い) */
export interface SchemaTable {
  schema: string;
  name: string;
  columns: Column[];
}

/** カラム比較で差分検出の対象となる属性 */
export type ColumnChangeKind = 'type' | 'size' | 'nullable' | 'isPrimaryKey';

/** 共通テーブル内で定義が変化したカラム */
export interface ColumnChange {
  name: string;
  /** 移行元 (from) 側の定義 */
  from: Column;
  /** 移行先 (to) 側の定義 */
  to: Column;
  /** 変化した属性の一覧 (定義順: type, size, nullable, isPrimaryKey) */
  changes: ColumnChangeKind[];
}

/** 両スキーマに存在するテーブルのカラムレベル差分 */
export interface TableDiff {
  schema: string;
  name: string;
  /** 移行先にのみ存在するカラム (ADD COLUMN 対象)。移行先の定義順 */
  addedColumns: Column[];
  /** 移行元にのみ存在するカラム (DROP COLUMN 対象)。移行元の定義順 */
  removedColumns: Column[];
  /** 定義が変化したカラム。移行先の定義順 */
  changedColumns: ColumnChange[];
}

/** スキーマ全体の差分モデル。「移行元 (from) → 移行先 (to)」方向で解釈する */
export interface SchemaDiff {
  /** 移行先にのみ存在するテーブル (CREATE TABLE 対象)。キー昇順 */
  addedTables: SchemaTable[];
  /** 移行元にのみ存在するテーブル (DROP TABLE 対象)。キー昇順 */
  removedTables: SchemaTable[];
  /** 両方に存在し差分があるテーブル。キー昇順 */
  changedTables: TableDiff[];
  /** 両方に存在し差分がないテーブル数 */
  unchangedTableCount: number;
}

/** テーブル識別キー ("schema.name" / schema 空なら "name")。大文字小文字は区別する */
export function tableKey(table: Pick<SchemaTable, 'schema' | 'name'>): string {
  return table.schema !== '' ? `${table.schema}.${table.name}` : table.name;
}

function compareColumn(from: Column, to: Column): ColumnChangeKind[] {
  const changes: ColumnChangeKind[] = [];
  if (from.type !== to.type) changes.push('type');
  if (from.size !== to.size) changes.push('size');
  if (from.nullable !== to.nullable) changes.push('nullable');
  if (from.isPrimaryKey !== to.isPrimaryKey) changes.push('isPrimaryKey');
  return changes;
}

function diffTableColumns(from: SchemaTable, to: SchemaTable): TableDiff | null {
  const fromByName = new Map(from.columns.map((c) => [c.name, c]));
  const toByName = new Map(to.columns.map((c) => [c.name, c]));

  const addedColumns = to.columns.filter((c) => !fromByName.has(c.name));
  const removedColumns = from.columns.filter((c) => !toByName.has(c.name));

  const changedColumns: ColumnChange[] = [];
  for (const toCol of to.columns) {
    const fromCol = fromByName.get(toCol.name);
    if (!fromCol) continue;
    const changes = compareColumn(fromCol, toCol);
    if (changes.length > 0) {
      changedColumns.push({ name: toCol.name, from: fromCol, to: toCol, changes });
    }
  }

  if (addedColumns.length === 0 && removedColumns.length === 0 && changedColumns.length === 0) {
    return null;
  }
  return { schema: to.schema, name: to.name, addedColumns, removedColumns, changedColumns };
}

function sortByKey<T extends Pick<SchemaTable, 'schema' | 'name'>>(tables: T[]): T[] {
  return [...tables].sort((a, b) => {
    const ka = tableKey(a);
    const kb = tableKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

/**
 * 2 つのスキーマモデルを比較し差分を返す。
 *
 * - 方向: `from` (移行元) を `to` (移行先) の形へ変換するための差分。
 * - テーブル / カラム名は取得値のまま大文字小文字を区別して比較する。
 * - 出力の各テーブル一覧はキー昇順で決定的に整列する。
 */
export function diffSchemas(from: SchemaTable[], to: SchemaTable[]): SchemaDiff {
  const fromByKey = new Map(from.map((t) => [tableKey(t), t]));
  const toByKey = new Map(to.map((t) => [tableKey(t), t]));

  const addedTables = sortByKey(to.filter((t) => !fromByKey.has(tableKey(t))));
  const removedTables = sortByKey(from.filter((t) => !toByKey.has(tableKey(t))));

  const changedTables: TableDiff[] = [];
  let unchangedTableCount = 0;
  for (const toTable of sortByKey(to.filter((t) => fromByKey.has(tableKey(t))))) {
    const fromTable = fromByKey.get(tableKey(toTable));
    if (!fromTable) continue;
    const diff = diffTableColumns(fromTable, toTable);
    if (diff) {
      changedTables.push(diff);
    } else {
      unchangedTableCount += 1;
    }
  }

  return { addedTables, removedTables, changedTables, unchangedTableCount };
}

/** 差分が 1 件も存在しないかを判定する */
export function isEmptyDiff(diff: SchemaDiff): boolean {
  return (
    diff.addedTables.length === 0 &&
    diff.removedTables.length === 0 &&
    diff.changedTables.length === 0
  );
}
