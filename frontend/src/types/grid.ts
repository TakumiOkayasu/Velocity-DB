/**
 * グリッド関連の共通型定義とユーティリティ
 */

/** 行データの型（カラム名→値のマッピング） */
export type RowData = Record<string, string | null>;

/** カラムメタデータ（コンテキストメニュー等で使用） */
export interface ColumnMeta {
  name: string;
  comment: string;
  type: string;
}

// 数値型キーワード (SQL Server + PostgreSQL + MySQL)
const NUMERIC_TYPE_KEYWORDS = [
  'int',
  'bigint',
  'smallint',
  'tinyint',
  'decimal',
  'numeric',
  'float',
  'real',
  'money',
  'smallmoney',
  'bit',
  'serial',
  'bigserial',
  'double precision',
  'double',
] as const;

// 日付型キーワード (SQL Server + PostgreSQL + MySQL)
const DATE_TYPE_KEYWORDS = [
  'date',
  'datetime',
  'datetime2',
  'smalldatetime',
  'time',
  'datetimeoffset',
  'timestamp',
  'interval',
] as const;

/**
 * 数値型かどうかを判定
 * @param type - カラムの型文字列（例: "int", "decimal(18,2)", "serial"）
 */
export function isNumericType(type: string): boolean {
  const lower = type.toLowerCase();
  return NUMERIC_TYPE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/**
 * 日付型かどうかを判定
 * @param type - カラムの型文字列（例: "datetime", "date", "timestamp"）
 */
export function isDateType(type: string): boolean {
  const lower = type.toLowerCase();
  return DATE_TYPE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

/** テーブル識別子（スキーマ名とテーブル名） */
export interface TableIdentifier {
  schema: string;
  table: string;
}

/**
 * テーブル名文字列をパースしてスキーマ名とテーブル名に分離
 * @param fullTableName - "schema.table" または "table" 形式の文字列
 * @param defaultSchema - スキーマ名が省略された場合のデフォルト値
 * @returns パースされたテーブル識別子
 *
 * @example
 * parseTableName("[dbo].[Users]") // { schema: "dbo", table: "Users" }
 * parseTableName("Orders") // { schema: "dbo", table: "Orders" }
 * parseTableName("MyDB.dbo.Users") // { schema: "dbo", table: "Users" }
 */
export function parseTableName(fullTableName: string, defaultSchema = 'dbo'): TableIdentifier {
  // 識別子クォートを除去 (SQL Server [], PostgreSQL "", MySQL ``)
  const cleaned = fullTableName.replace(/[[\]"`]/g, '');
  const parts = cleaned.split('.');

  if (parts.length >= 2) {
    // 後ろから2つを取得（database.schema.table形式に対応）
    return {
      schema: parts[parts.length - 2],
      table: parts[parts.length - 1],
    };
  }

  return {
    schema: defaultSchema,
    table: cleaned,
  };
}
