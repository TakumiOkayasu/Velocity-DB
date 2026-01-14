/**
 * SQL Safety Check Utilities
 * Used for Read-Only mode to detect potentially dangerous queries
 */

// SQL keywords that indicate data modification
const DML_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'MERGE',
  'TRUNCATE',
  'DROP',
  'ALTER',
  'CREATE',
  'EXEC',
  'EXECUTE',
  'GRANT',
  'REVOKE',
  'DENY',
];

// Pattern to match DML/DDL statements at the start of a statement
// Handles comments and whitespace
const DML_PATTERN = new RegExp(
  `^\\s*(?:--[^\\n]*\\n|/\\*[\\s\\S]*?\\*/|\\s)*\\b(${DML_KEYWORDS.join('|')})\\b`,
  'im'
);

export interface SqlSafetyResult {
  isSafe: boolean;
  detectedKeyword?: string;
  message?: string;
}

/**
 * Check if a SQL query is safe to execute in read-only mode
 * @param sql The SQL query to check
 * @returns SafetyResult indicating if the query is safe
 */
export function checkSqlSafety(sql: string): SqlSafetyResult {
  const trimmedSql = sql.trim();
  if (!trimmedSql) {
    return { isSafe: true };
  }

  const match = trimmedSql.match(DML_PATTERN);
  if (match) {
    const keyword = match[1].toUpperCase();
    return {
      isSafe: false,
      detectedKeyword: keyword,
      message: `This query contains "${keyword}" which modifies data. Read-only mode is enabled for this production connection.`,
    };
  }

  return { isSafe: true };
}

/**
 * Check if SQL contains WHERE clause for UPDATE/DELETE
 * Used for additional safety warnings
 */
export function hasWhereClause(sql: string): boolean {
  const upperSql = sql.toUpperCase();
  if (upperSql.includes('UPDATE') || upperSql.includes('DELETE')) {
    return upperSql.includes('WHERE');
  }
  return true; // Other statements don't need WHERE
}

export interface UnsafeQueryWarning {
  type: 'no_where' | 'dml_in_production';
  keyword: string;
  message: string;
}

/**
 * Get warnings for potentially unsafe queries
 * Used in production mode (even when not read-only)
 */
export function getQueryWarnings(sql: string, isProduction: boolean): UnsafeQueryWarning[] {
  const warnings: UnsafeQueryWarning[] = [];
  const trimmedSql = sql.trim();
  if (!trimmedSql) return warnings;

  const match = trimmedSql.match(DML_PATTERN);
  if (match) {
    const keyword = match[1].toUpperCase();

    // Warn about DML in production
    if (isProduction) {
      warnings.push({
        type: 'dml_in_production',
        keyword,
        message: `You are about to execute "${keyword}" on a production database.`,
      });
    }

    // Warn about UPDATE/DELETE without WHERE
    if ((keyword === 'UPDATE' || keyword === 'DELETE') && !hasWhereClause(sql)) {
      warnings.push({
        type: 'no_where',
        keyword,
        message: `${keyword} without WHERE clause will affect all rows!`,
      });
    }
  }

  return warnings;
}
