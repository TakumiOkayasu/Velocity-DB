import { describe, expect, it } from 'vitest';
import { formatSQL } from '../../utils/sqlFormat';

describe('formatSQL', () => {
  it('キーワードを大文字化する (sqlserver)', async () => {
    const out = await formatSQL('select id from users where age > 18', 'sqlserver');
    expect(out).toContain('SELECT');
    expect(out).toContain('FROM');
    expect(out).toContain('WHERE');
  });

  it('T-SQL の括弧内セミコロンを含むSQLでも例外を投げず整形する', async () => {
    const sql = [
      'USE MMS;',
      "DECLARE @orderId INT = ( SELECT ID FROM [OMS].[dbo].[tbl] WHERE code = 'SR01'; )",
      'SELECT @orderId AS orderId;',
    ].join('\n');
    const out = await formatSQL(sql, 'sqlserver');
    expect(out).toContain('DECLARE');
    expect(out).toContain('@orderId');
    expect(out).toContain('SELECT');
  });

  it('PostgreSQL: ILIKE を保持する', async () => {
    const out = await formatSQL("SELECT id FROM users WHERE name ILIKE '%x%'", 'postgresql');
    expect(out).toContain('SELECT');
    expect(out).toContain('ILIKE');
  });

  it('MySQL: JSON_EXTRACT を保持する', async () => {
    const out = await formatSQL(
      "SELECT id FROM users WHERE JSON_EXTRACT(data, '$.name') = 'x'",
      'mysql'
    );
    expect(out).toContain('SELECT');
    expect(out).toContain('JSON_EXTRACT');
  });

  it('dbType省略時は T-SQL として整形する', async () => {
    const out = await formatSQL('select 1');
    expect(out).toContain('SELECT');
  });
});
