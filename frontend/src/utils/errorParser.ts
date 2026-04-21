export interface ParsedError {
  summary: string;
  detail: string;
  line?: number;
  hint?: string;
}

const PSQL_ERROR_RE = /^(?:psql:[^\n]*?:\s*)?ERROR:\s+(.+)/;
const SQLSERVER_MSG_RE = /^Msg\s+\d+,\s+Level\s+\d+,\s+State\s+\d+,\s+Line\s+(\d+)\n(.+)/;
const MYSQL_ERROR_RE = /^ERROR\s+\d+\s+\(\w+\):\s+(.+)/;

const POSTGRES_LINE_RE = /\bLINE\s+(\d+)\s*:/;
const MYSQL_AT_LINE_RE = /\bat\s+line\s+(\d+)\b/i;
const POSTGRES_CROSS_DB_RE = /cross-database\s+references\s+are\s+not\s+implemented/i;

const POSTGRES_CROSS_DB_HINT =
  'PostgreSQL は別データベース間の参照を直接サポートしていません。postgres_fdw または dblink 拡張を使用してください。';

export function parseErrorMessage(raw: string): ParsedError {
  if (!raw) return { summary: '', detail: '' };

  const firstLine = raw.split('\n')[0];

  const psqlMatch = firstLine.match(PSQL_ERROR_RE);
  if (psqlMatch) {
    const lineMatch = raw.match(POSTGRES_LINE_RE);
    const hint = POSTGRES_CROSS_DB_RE.test(raw) ? POSTGRES_CROSS_DB_HINT : undefined;
    return {
      summary: psqlMatch[1].trim(),
      detail: raw,
      line: lineMatch ? Number(lineMatch[1]) : undefined,
      hint,
    };
  }

  const sqlServerMatch = raw.match(SQLSERVER_MSG_RE);
  if (sqlServerMatch) {
    return {
      summary: sqlServerMatch[2].trim(),
      detail: raw,
      line: Number(sqlServerMatch[1]),
    };
  }

  const mysqlMatch = firstLine.match(MYSQL_ERROR_RE);
  if (mysqlMatch) {
    const lineMatch = raw.match(MYSQL_AT_LINE_RE);
    return {
      summary: mysqlMatch[1].trim(),
      detail: raw,
      line: lineMatch ? Number(lineMatch[1]) : undefined,
    };
  }

  return { summary: firstLine, detail: raw };
}
