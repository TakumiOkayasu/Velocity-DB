import { describe, expect, it } from 'vitest';
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
    ['2', ''],
    ['3', 'Bob'],
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
    expect(lines).toHaveLength(4);
  });

  it('should generate CSV without headers', () => {
    const result = csvExporter.generate(sampleResultSet, {
      ...defaultOptions,
      includeHeaders: false,
    });
    const lines = result.split('\n');
    expect(lines[0]).toBe('"1","Alice"');
    expect(lines).toHaveLength(3);
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
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({ id: '1', name: 'Alice' });
    expect(parsed[1]).toEqual({ id: '2', name: null });
  });
});

describe('SQL Exporter', () => {
  it('should generate INSERT statements', () => {
    const result = sqlExporter.generate(sampleResultSet, defaultOptions);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('INSERT INTO [dbo.Users]');
    expect(lines[0]).toContain('[id], [name]');
    expect(lines[0]).toContain("N'Alice'");
    expect(lines[1]).toContain("N''");
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

describe('getExporter registry', () => {
  it('should return correct exporter for each format', () => {
    expect(getExporter('csv')).toBe(csvExporter);
    expect(getExporter('json')).toBe(jsonExporter);
    expect(getExporter('sql')).toBe(sqlExporter);
    expect(getExporter('html')).toBe(htmlExporter);
    expect(getExporter('markdown')).toBe(markdownExporter);
  });
});
