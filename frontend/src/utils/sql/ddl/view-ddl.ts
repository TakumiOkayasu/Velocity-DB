// ビュー DDL builder (操作層)。
// CREATE/ALTER VIEW SQL の生成、ビュー定義の取得を扱う。
// 識別子クォート / リテラルエスケープは utils/sql/quoting.ts に依存。

import type { DatabaseType } from '../../../types';
import { escapeSingleQuotes, quoteIdentifier } from '../quoting';

/** ビュー定義取得SQL生成 */
export function buildGetViewDefinitionSql(
  schema: string,
  viewName: string,
  dbType?: DatabaseType
): string {
  const s = escapeSingleQuotes(schema);
  const v = escapeSingleQuotes(viewName);

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
  const { bridge } = await import('../../../api/bridge');
  const defQuery = buildGetViewDefinitionSql(schema, viewName, dbType);
  const result = await bridge.executeQuery(connectionId, defQuery);
  if ('multipleResults' in result) return '';
  return result.rows[0]?.[0] ?? '';
}

/**
 * SELECT 句に出現するカラム参照を検出する静的パターン。
 * - グループ1: ブラケット識別子の中身 `[name]` → `name`
 * - グループ2: 素の識別子 `name`
 * - グループ3: 既存エイリアス節 ` AS xxx` (省略可)
 * 末尾の lookahead でカラム境界 (カンマ / 空白 / AS) を保証する。
 * 動的に oldCol を埋め込まず、識別子の等価比較で oldCol を判定することで
 * ReDoS リスク (Semgrep detect-non-literal-regexp) を回避する。
 */
const COLUMN_REFERENCE_PATTERN =
  /(?:\w+\.)?(?:\[([^\]]+)\]|(\w+))(?=\s*[,\s]|\s+AS\b)(\s+AS\s+(?:\[[^\]]*\]|"[^"]*"|`[^`]*`|\w+))?/gi;

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
  const oldColLower = oldCol.toLowerCase();

  for (const match of selectPart.matchAll(COLUMN_REFERENCE_PATTERN)) {
    const matchedName = match[1] ?? match[2];
    if (matchedName.toLowerCase() !== oldColLower) continue;
    if (match.index === undefined) continue;

    const aliasClause = match[3] ?? '';
    const identifierPart = aliasClause ? match[0].slice(0, -aliasClause.length) : match[0];
    const newSelectPart =
      selectPart.slice(0, match.index) +
      `${identifierPart} AS ${q(newCol)}` +
      selectPart.slice(match.index + match[0].length);
    sql = `${selectFromStart}SELECT ${selectPrefix}${newSelectPart}${fromAndRest}`;
    break;
  }

  return sql;
}
