import { describe, expect, it } from 'vite-plus/test';
import { getExporter } from '../../components/export/exporters';
import { csvExporter } from '../../components/export/exporters/csvExporter';
import { htmlExporter } from '../../components/export/exporters/htmlExporter';
import { jsonExporter } from '../../components/export/exporters/jsonExporter';
import { markdownExporter } from '../../components/export/exporters/markdownExporter';
import { sqlExporter } from '../../components/export/exporters/sqlExporter';
import type { ExportOptions } from '../../components/export/exporters/types';
import type { ResultSet } from '../../types';

const sampleResultSet: ResultSet = {
  columns: [
    { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
    { name: 'name', type: 'nvarchar', size: 100, nullable: true, isPrimaryKey: false },
  ],
  rows: [
    ['1', 'Alice'],
    ['2', null],
    ['3', ''],
    ['4', 'Bob'],
  ],
  affectedRows: 0,
  executionTimeMs: 10,
};

const defaultOptions: ExportOptions = {
  format: 'csv',
  includeHeaders: true,
  delimiter: ',',
  nullValue: 'NULL',
  tableName: 'dbo.Users',
};

describe('CSV Exporter', () => {
  it('should generate CSV with headers', () => {
    const result = csvExporter.generate(sampleResultSet, defaultOptions);
    const lines = result.split('\n');
    expect(lines[0]).toBe('"id","name"');
    expect(lines[1]).toBe('"1","Alice"');
    expect(lines[2]).toBe('"2",NULL');
    expect(lines[3]).toBe('"3",""');
    expect(lines).toHaveLength(5);
  });

  it('should generate CSV without headers', () => {
    const result = csvExporter.generate(sampleResultSet, {
      ...defaultOptions,
      includeHeaders: false,
    });
    const lines = result.split('\n');
    expect(lines[0]).toBe('"1","Alice"');
    expect(lines).toHaveLength(4);
  });

  it('should use custom delimiter', () => {
    const result = csvExporter.generate(sampleResultSet, { ...defaultOptions, delimiter: '\t' });
    expect(result.split('\n')[0]).toBe('"id"\t"name"');
  });

  it('should escape double quotes', () => {
    const rs: ResultSet = {
      ...sampleResultSet,
      rows: [['1', 'say "hello"']],
    };
    const result = csvExporter.generate(rs, defaultOptions);
    expect(result).toContain('"say ""hello"""');
  });
});

describe('JSON Exporter', () => {
  it('should generate JSON array of objects', () => {
    const result = jsonExporter.generate(sampleResultSet, defaultOptions);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toEqual({ id: '1', name: 'Alice' });
    expect(parsed[1]).toEqual({ id: '2', name: null });
    expect(parsed[2]).toEqual({ id: '3', name: '' });
  });
});

describe('SQL Exporter', () => {
  it('should generate INSERT statements', () => {
    const result = sqlExporter.generate(sampleResultSet, defaultOptions);
    const lines = result.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('INSERT INTO [dbo.Users]');
    expect(lines[0]).toContain('[id], [name]');
    expect(lines[0]).toContain("N'Alice'");
    expect(lines[1]).toContain(', NULL)');
    expect(lines[2]).toContain("N''");
  });

  it('should escape single quotes', () => {
    const rs: ResultSet = {
      ...sampleResultSet,
      rows: [['1', "O'Brien"]],
    };
    const result = sqlExporter.generate(rs, defaultOptions);
    expect(result).toContain("N'O''Brien'");
  });

  it('should use PostgreSQL syntax when dbType is postgresql', () => {
    const result = sqlExporter.generate(sampleResultSet, {
      ...defaultOptions,
      dbType: 'postgresql',
    });
    const lines = result.split('\n');
    expect(lines[0]).toContain('INSERT INTO "dbo.Users"');
    expect(lines[0]).toContain('"id", "name"');
    expect(lines[0]).toContain("'Alice'");
    expect(lines[0]).not.toContain("N'");
  });

  it('should use MySQL syntax when dbType is mysql', () => {
    const result = sqlExporter.generate(sampleResultSet, {
      ...defaultOptions,
      dbType: 'mysql',
    });
    const lines = result.split('\n');
    expect(lines[0]).toContain('INSERT INTO `dbo.Users`');
    expect(lines[0]).toContain('`id`, `name`');
    expect(lines[0]).toContain("'Alice'");
  });
});

describe('HTML Exporter', () => {
  it('should generate HTML table', () => {
    const result = htmlExporter.generate(sampleResultSet, defaultOptions);
    expect(result).toContain('<table>');
    expect(result).toContain('<th>id</th>');
    expect(result).toContain('<td>Alice</td>');
    expect(result).toContain('</table>');
  });

  it('should escape HTML entities', () => {
    const rs: ResultSet = {
      ...sampleResultSet,
      rows: [['1', '<script>alert("xss")</script>']],
    };
    const result = htmlExporter.generate(rs, defaultOptions);
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });
});

describe('Markdown Exporter', () => {
  it('should generate markdown table with headers', () => {
    const result = markdownExporter.generate(sampleResultSet, defaultOptions);
    const lines = result.split('\n');
    expect(lines[0]).toBe('| id | name |');
    expect(lines[1]).toBe('| --- | --- |');
    expect(lines[2]).toBe('| 1 | Alice |');
  });

  it('should escape pipe characters', () => {
    const rs: ResultSet = {
      ...sampleResultSet,
      rows: [['1', 'a|b']],
    };
    const result = markdownExporter.generate(rs, defaultOptions);
    expect(result).toContain('a\\|b');
  });
});

describe('NULL vs empty string distinction', () => {
  const rsNullEmpty: ResultSet = {
    columns: [
      { name: 'id', type: 'int', size: 4, nullable: false, isPrimaryKey: true },
      { name: 'val', type: 'nvarchar', size: 100, nullable: true, isPrimaryKey: false },
    ],
    rows: [
      ['1', null],
      ['2', ''],
    ],
    affectedRows: 0,
    executionTimeMs: 5,
  };

  it('CSV: NULL uses nullValue, empty string is quoted', () => {
    const result = csvExporter.generate(rsNullEmpty, defaultOptions);
    const lines = result.split('\n');
    expect(lines[1]).toBe('"1",NULL');
    expect(lines[2]).toBe('"2",""');
  });

  it('JSON: NULL is null, empty string is ""', () => {
    const parsed = JSON.parse(jsonExporter.generate(rsNullEmpty, defaultOptions));
    expect(parsed[0].val).toBeNull();
    expect(parsed[1].val).toBe('');
  });

  it('SQL: NULL is keyword, empty string is literal', () => {
    const result = sqlExporter.generate(rsNullEmpty, defaultOptions);
    const lines = result.split('\n');
    expect(lines[0]).toContain(', NULL)');
    expect(lines[0]).not.toContain("N''");
    expect(lines[1]).toContain("N''");
  });

  it('HTML: NULL uses nullValue, empty string is empty cell', () => {
    const result = htmlExporter.generate(rsNullEmpty, defaultOptions);
    expect(result).toContain('<td>NULL</td>');
    expect(result).toContain('<td></td>');
  });

  it('Markdown: NULL uses nullValue, empty string is empty cell', () => {
    const result = markdownExporter.generate(rsNullEmpty, defaultOptions);
    const lines = result.split('\n');
    expect(lines[2]).toBe('| 1 | NULL |');
    expect(lines[3]).toBe('| 2 |  |');
  });

  it('custom nullValue is used across exporters', () => {
    const opts = { ...defaultOptions, nullValue: '\\N' };
    const csv = csvExporter.generate(rsNullEmpty, opts);
    expect(csv.split('\n')[1]).toBe('"1",\\N');

    const html = htmlExporter.generate(rsNullEmpty, opts);
    expect(html).toContain('<td>\\N</td>');

    const md = markdownExporter.generate(rsNullEmpty, opts);
    expect(md.split('\n')[2]).toBe('| 1 | \\\\N |');
  });

  it('CSV: nullValue with special characters is safely quoted', () => {
    const csv = csvExporter.generate(rsNullEmpty, { ...defaultOptions, nullValue: 'N,A' });
    expect(csv.split('\n')[1]).toBe('"1","N,A"');

    const csv2 = csvExporter.generate(rsNullEmpty, { ...defaultOptions, nullValue: 'say "null"' });
    expect(csv2.split('\n')[1]).toBe('"1","say ""null"""');
  });

  it('SQL: NULL keyword is DB-type independent', () => {
    for (const dbType of ['postgresql', 'mysql'] as const) {
      const result = sqlExporter.generate(rsNullEmpty, { ...defaultOptions, dbType });
      const lines = result.split('\n');
      expect(lines[0]).toContain(', NULL)');
      expect(lines[1]).not.toContain(', NULL)');
      expect(lines[1]).toContain("''");
    }
  });

  it('all-null row is handled correctly', () => {
    const rs: ResultSet = {
      ...rsNullEmpty,
      rows: [[null, null]],
    };
    const csv = csvExporter.generate(rs, defaultOptions);
    expect(csv.split('\n')[1]).toBe('NULL,NULL');

    const parsed = JSON.parse(jsonExporter.generate(rs, defaultOptions));
    expect(parsed[0]).toEqual({ id: null, val: null });

    const sql = sqlExporter.generate(rs, defaultOptions);
    expect(sql).toContain('VALUES (NULL, NULL)');
  });

  it('nullValue="" produces identical output for NULL and empty string in HTML/Markdown', () => {
    const opts = { ...defaultOptions, nullValue: '' };
    const html = htmlExporter.generate(rsNullEmpty, opts);
    const emptyTds = html.match(/<td><\/td>/g);
    expect(emptyTds).toHaveLength(2);

    const md = markdownExporter.generate(rsNullEmpty, opts);
    const lines = md.split('\n');
    expect(lines[2]).toBe('| 1 |  |');
    expect(lines[3]).toBe('| 2 |  |');
  });

  it('JSON: nullValue option is ignored (native JSON null used)', () => {
    const result = jsonExporter.generate(rsNullEmpty, { ...defaultOptions, nullValue: 'CUSTOM' });
    const parsed = JSON.parse(result);
    expect(parsed[0].val).toBeNull();
    expect(result).not.toContain('CUSTOM');
  });

  it('string "NULL" is distinct from actual null', () => {
    const rs: ResultSet = {
      ...rsNullEmpty,
      rows: [
        ['1', null],
        ['2', 'NULL'],
      ],
    };
    const csv = csvExporter.generate(rs, defaultOptions);
    const csvLines = csv.split('\n');
    expect(csvLines[1]).toBe('"1",NULL');
    expect(csvLines[2]).toBe('"2","NULL"');

    const parsed = JSON.parse(jsonExporter.generate(rs, defaultOptions));
    expect(parsed[0].val).toBeNull();
    expect(parsed[1].val).toBe('NULL');

    const sql = sqlExporter.generate(rs, defaultOptions);
    const sqlLines = sql.split('\n');
    expect(sqlLines[0]).toContain(', NULL)');
    expect(sqlLines[1]).toContain("N'NULL'");
  });
});

describe('getExporter registry', () => {
  it('should return correct exporter for each format', () => {
    expect(getExporter('csv')).toBe(csvExporter);
    expect(getExporter('json')).toBe(jsonExporter);
    expect(getExporter('sql')).toBe(sqlExporter);
    expect(getExporter('html')).toBe(htmlExporter);
    expect(getExporter('markdown')).toBe(markdownExporter);
  });
});
