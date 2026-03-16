export interface ParsedError {
  summary: string;
  detail: string;
}

const PSQL_ERROR_RE = /^(?:psql:[^\n]*?:\s*)?ERROR:\s+(.+)/;
const SQLSERVER_MSG_RE = /^Msg\s+\d+,\s+Level\s+\d+,\s+State\s+\d+,\s+Line\s+\d+\n(.+)/;
const MYSQL_ERROR_RE = /^ERROR\s+\d+\s+\(\w+\):\s+(.+)/;

export function parseErrorMessage(raw: string): ParsedError {
  if (!raw) return { summary: '', detail: '' };

  const firstLine = raw.split('\n')[0];

  const psqlMatch = firstLine.match(PSQL_ERROR_RE);
  if (psqlMatch) {
    return { summary: psqlMatch[1].trim(), detail: raw };
  }

  const sqlServerMatch = raw.match(SQLSERVER_MSG_RE);
  if (sqlServerMatch) {
    return { summary: sqlServerMatch[1].trim(), detail: raw };
  }

  const mysqlMatch = firstLine.match(MYSQL_ERROR_RE);
  if (mysqlMatch) {
    return { summary: mysqlMatch[1].trim(), detail: raw };
  }

  return { summary: firstLine, detail: raw };
}
