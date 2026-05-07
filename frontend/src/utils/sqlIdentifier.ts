// SQL identifier ベースの DML builder (操作層)。
// テーブル DDL は utils/sql/ddl/table-ddl.ts、ビュー DDL は utils/sql/ddl/view-ddl.ts、
// 識別子クォート / リテラルエスケープは utils/sql/quoting.ts、
// ステートメント種別判定は utils/sql/statement-type.ts に分離されている。

import type { DatabaseType } from '../types';
import { quoteDottedName, quoteIdentifier } from './sql/quoting';

/** SELECT * FROM schema.table SQL生成 */
export function buildSelectSql(displayName: string, dbType?: DatabaseType): string {
  return `SELECT * FROM ${quoteDottedName(displayName, dbType)}`;
}

/** INSERT INTO schema.table (cols...) VALUES (?, ?, ...); テンプレート生成 */
export function buildInsertTemplateSql(
  displayName: string,
  columnNames: readonly string[],
  dbType?: DatabaseType
): string {
  const cols = columnNames.map((c) => quoteIdentifier(c, dbType)).join(', ');
  const placeholders = columnNames.map(() => '?').join(', ');
  return `INSERT INTO ${quoteDottedName(displayName, dbType)} (${cols}) VALUES (${placeholders});`;
}
