import { checkSqlSafety, getQueryWarnings, type UnsafeQueryWarning } from './sqlSafetyCheck';

export const SQL_PREVIEW_MAX_LENGTH = 200;

export function previewSql(sql: string): string {
  if (sql.length <= SQL_PREVIEW_MAX_LENGTH) return sql;
  return `${sql.slice(0, SQL_PREVIEW_MAX_LENGTH)}...`;
}

export type ExecutionCheckResult =
  | { action: 'execute' }
  | { action: 'block'; title: string; message: string; details: string }
  | { action: 'warn'; title: string; message: string; details: string };

interface ExecutabilityOptions {
  isReadOnly: boolean;
  isProduction: boolean;
}

// Read-Only/Production 判定を handleExecute から分離。
// UI 依存なしに単体テスト可能、挙動は元のインライン実装と等価。
export function checkQueryExecutability(
  sql: string,
  opts: ExecutabilityOptions
): ExecutionCheckResult {
  if (opts.isReadOnly) {
    const safety = checkSqlSafety(sql);
    if (!safety.isSafe) {
      return {
        action: 'block',
        title: 'Read-Only Mode',
        message: safety.message ?? 'This query is blocked in read-only mode.',
        details: previewSql(sql),
      };
    }
  }

  if (opts.isProduction && !opts.isReadOnly) {
    const warnings = getQueryWarnings(sql, true);
    if (warnings.length > 0) {
      return {
        action: 'warn',
        title: 'Production Warning',
        message: warnings.map((w: UnsafeQueryWarning) => w.message).join('\n'),
        details: previewSql(sql),
      };
    }
  }

  return { action: 'execute' };
}
