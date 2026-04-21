export const sliceAt = (sql: string, p: { offset: number; length: number }) =>
  sql.slice(p.offset, p.offset + p.length);
