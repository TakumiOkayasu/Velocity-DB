import { describe, expect, it } from 'vitest';
import { detectContextFromText } from '../../../components/editor/completionProvider';

describe('detectContextFromText', () => {
  it('detects alias_column after dot', () => {
    expect(detectContextFromText('SELECT a.')).toEqual({ type: 'alias_column', aliasOrTable: 'a' });
  });

  it('detects alias_column after dot with bracketed table prefix', () => {
    expect(detectContextFromText('SELECT [t].')).toEqual({
      type: 'alias_column',
      aliasOrTable: 't',
    });
  });

  it('detects table after FROM+space', () => {
    expect(detectContextFromText('SELECT * FROM ')).toEqual({ type: 'table' });
  });

  it('detects table after FROM with partial word typed', () => {
    expect(detectContextFromText('SELECT * FROM aut')).toEqual({ type: 'table' });
  });

  it('detects table after JOIN+space', () => {
    expect(detectContextFromText('SELECT * FROM a JOIN ')).toEqual({ type: 'table' });
  });

  it('detects column after SELECT+space', () => {
    expect(detectContextFromText('SELECT ')).toEqual({ type: 'column' });
  });

  it('detects column after SELECT with partial word typed (was keyword before fix)', () => {
    expect(detectContextFromText('SELECT n')).toEqual({ type: 'column' });
  });

  it('detects column after WHERE with partial word', () => {
    expect(detectContextFromText('SELECT * FROM t WHERE n')).toEqual({ type: 'column' });
  });

  it('detects column after comma', () => {
    expect(detectContextFromText('SELECT a, b, ')).toEqual({ type: 'column' });
  });

  it('detects column after AND', () => {
    expect(detectContextFromText('SELECT * FROM t WHERE x=1 AND ')).toEqual({ type: 'column' });
  });

  it('detects column across multi-line (SQL formatted)', () => {
    expect(detectContextFromText('SELECT\n    n')).toEqual({ type: 'column' });
  });

  it('detects table across multi-line after FROM', () => {
    expect(detectContextFromText('SELECT\n    name\nFROM\n    a')).toEqual({ type: 'table' });
  });

  it('defaults to keyword at top of empty input', () => {
    expect(detectContextFromText('')).toEqual({ type: 'keyword' });
  });

  it('defaults to keyword for unrecognized prefix', () => {
    expect(detectContextFromText('CREATE TABLE')).toEqual({ type: 'keyword' });
  });
});
