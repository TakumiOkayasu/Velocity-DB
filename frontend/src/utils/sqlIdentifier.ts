import type { DatabaseType } from '../types';

/** sp_rename等のリテラル文字列用エスケープ (シングルクォート) */
function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** DB種別に応じたリテラルクォート */
export function quoteLiteral(value: string, dbType?: DatabaseType): string {
  const escaped = value.replace(/'/g, "''");
  switch (dbType) {
    case 'postgresql':
    case 'mysql':
      return `'${escaped}'`;
    default:
      return `N'${escaped}'`;
  }
}

/** DB種別に応じた識別子クォート */
export function quoteIdentifier(name: string, dbType?: DatabaseType): string {
  switch (dbType) {
    case 'postgresql':
      return `"${name.replace(/"/g, '""')}"`;
    case 'mysql':
      return `\`${name.replace(/`/g, '``')}\``;
    default:
      return `[${name.replace(/]/g, ']]')}]`;
  }
}

/** ALTER TABLE ... RENAME COLUMN SQL生成 */
export function buildRenameColumnSql(
  schema: string,
  table: string,
  oldName: string,
  newName: string,
  dbType?: DatabaseType
): string {
  const q = (n: string) => quoteIdentifier(n, dbType);

  switch (dbType) {
    case 'postgresql':
      return `ALTER TABLE ${q(schema)}.${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`;
    case 'mysql':
      return `ALTER TABLE ${q(table)} RENAME COLUMN ${q(oldName)} TO ${q(newName)}`;
    default:
      return `EXEC sp_rename '${escapeSqlLiteral(schema)}.${escapeSqlLiteral(table)}.${escapeSqlLiteral(oldName)}', '${escapeSqlLiteral(newName)}', 'COLUMN'`;
  }
}

/** SELECT * FROM schema.table SQL生成 */
export function buildSelectSql(displayName: string, dbType?: DatabaseType): string {
  const q = (n: string) => quoteIdentifier(n, dbType);
  const parts = displayName.split('.');
  const tableName = parts.length >= 2 ? `${q(parts[0])}.${q(parts[1])}` : q(parts[0]);
  return `SELECT * FROM ${tableName}`;
}

/** ALTER TABLE ... DROP COLUMN SQL生成 */
export function buildDropColumnSql(
  schema: string,
  table: string,
  column: string,
  dbType?: DatabaseType
): string {
  const q = (n: string) => quoteIdentifier(n, dbType);

  switch (dbType) {
    case 'postgresql':
      return `ALTER TABLE ${q(schema)}.${q(table)} DROP COLUMN ${q(column)}`;
    case 'mysql':
      return `ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`;
    default:
      return `ALTER TABLE ${q(schema)}.${q(table)} DROP COLUMN ${q(column)}`;
  }
}

// ---------------------------------------------------------------------------
// View DDL
// ---------------------------------------------------------------------------

/** ビュー定義取得SQL生成 */
export function buildGetViewDefinitionSql(
  schema: string,
  viewName: string,
  dbType?: DatabaseType
): string {
  const s = escapeSqlLiteral(schema);
  const v = escapeSqlLiteral(viewName);

  switch (dbType) {
    case 'postgresql':
      return `SELECT pg_get_viewdef('${s}.${v}', true)`;
    case 'mysql':
      return `SELECT VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = '${s}' AND TABLE_NAME = '${v}'`;
    default:
      return `SELECT OBJECT_DEFINITION(OBJECT_ID(N'${s}.${v}'))`;
  }
}

/** ビュー定義を取得 (空文字列 = 取得失敗) */
export async function fetchViewDefinition(
  connectionId: string,
  schema: string,
  viewName: string,
  dbType?: DatabaseType
): Promise<string> {
  const { bridge } = await import('../api/bridge');
  const defQuery = buildGetViewDefinitionSql(schema, viewName, dbType);
  const result = await bridge.executeQuery(connectionId, defQuery);
  return result.rows[0]?.[0] ?? '';
}

/** 正規表現メタ文字のエスケープ */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * SELECT句とFROM句を括弧深度を追跡して分割する。
 * サブクエリ内の FROM を無視し、トップレベルの FROM で分割。
 * 戻り値: [selectPart, fromAndRest] または null (FROM未検出)
 */
function splitSelectFrom(body: string): [string, string] | null {
  let depth = 0;
  const upper = body.toUpperCase();
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') {
      depth++;
    } else if (body[i] === ')') {
      depth--;
    } else if (depth === 0 && upper.startsWith('FROM', i)) {
      // 単語境界チェック: FROM の前後が英数字でないこと
      const before = i > 0 ? upper[i - 1] : ' ';
      const after = i + 4 < upper.length ? upper[i + 4] : ' ';
      if (/\w/.test(before) || /\w/.test(after)) continue;
      return [body.slice(0, i), body.slice(i)];
    }
  }
  return null;
}

/** ビュー定義を書き換えてカラム名を変更するALTER VIEW SQL生成 */
export function buildAlterViewSql(
  viewDefinition: string,
  oldCol: string,
  newCol: string,
  dbType?: DatabaseType
): string {
  const q = (n: string) => quoteIdentifier(n, dbType);
  let sql = viewDefinition;

  // CREATE VIEW → ALTER VIEW (PostgreSQL は CREATE OR REPLACE VIEW)
  if (dbType === 'postgresql') {
    sql = sql.replace(/^CREATE\s+(OR\s+REPLACE\s+)?VIEW/i, 'CREATE OR REPLACE VIEW');
  } else {
    sql = sql.replace(/^CREATE\s+VIEW/i, 'ALTER VIEW');
  }

  // SELECT [TOP N|DISTINCT] ... FROM の間でカラムを探してエイリアスを付与/置換
  const selectIdx = sql.search(/\bSELECT\s/i);
  if (selectIdx === -1) return sql;

  const afterSelect = sql.slice(selectIdx).replace(/^SELECT\s+/i, '');
  const prefixMatch = afterSelect.match(/^(TOP\s+\d+\s+|DISTINCT\s+)/i);
  const selectPrefix = prefixMatch?.[0] ?? '';
  const bodyAfterPrefix = afterSelect.slice(selectPrefix.length);

  const split = splitSelectFrom(bodyAfterPrefix);
  if (!split) return sql;

  const [selectPart, fromAndRest] = split;
  const selectFromStart = sql.slice(0, selectIdx);
  const escapedCol = escapeRegex(oldCol);

  // 名前付きパーツで正規表現を構築
  const tablePrefix = '(?:\\w+\\.)?';
  const quotedCol = `\\[?${escapedCol}\\]?`;
  const colBoundary = '(?=\\s*[,\\s]|\\s+AS\\b)';
  const aliasValue = '\\[[^\\]]*\\]|"[^"]*"|`[^`]*`|\\w+';
  const existingAlias = `(\\s+AS\\s+(?:${aliasValue}))`;

  const colPattern = new RegExp(`(${tablePrefix}${quotedCol})${colBoundary}${existingAlias}?`, 'i');

  if (colPattern.test(selectPart)) {
    const newSelectPart = selectPart.replace(colPattern, `$1 AS ${q(newCol)}`);
    sql = `${selectFromStart}SELECT ${selectPrefix}${newSelectPart}${fromAndRest}`;
  }

  return sql;
}
