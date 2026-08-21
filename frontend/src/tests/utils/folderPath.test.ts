import { describe, expect, it } from 'vite-plus/test';
import {
  FOLDER_PATH_DELIMITER,
  MAX_FOLDER_DEPTH,
  normalizedFolderSegments,
  normalizeFolderPath,
  splitFolderPath,
} from '../../utils/folderPath';

describe('folderPath constants', () => {
  it('uses "/" as delimiter and caps depth at 5', () => {
    expect(FOLDER_PATH_DELIMITER).toBe('/');
    expect(MAX_FOLDER_DEPTH).toBe(5);
  });
});

describe('splitFolderPath', () => {
  it('splits a simple path into segments', () => {
    expect(splitFolderPath('a/b/c')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for empty string', () => {
    expect(splitFolderPath('')).toEqual([]);
  });

  it('trims each segment', () => {
    expect(splitFolderPath(' a / b ')).toEqual(['a', 'b']);
  });

  it('drops empty segments from delimiter runs', () => {
    expect(splitFolderPath('a//b')).toEqual(['a', 'b']);
  });

  it('drops leading and trailing delimiters', () => {
    expect(splitFolderPath('/a/b/')).toEqual(['a', 'b']);
  });

  it('drops whitespace-only segments', () => {
    expect(splitFolderPath('a/   /b')).toEqual(['a', 'b']);
  });

  it('does not cap depth (capping is normalization concern)', () => {
    expect(splitFolderPath('a/b/c/d/e/f/g')).toHaveLength(7);
  });
});

describe('normalizedFolderSegments', () => {
  it('truncates to MAX_FOLDER_DEPTH segments', () => {
    expect(normalizedFolderSegments('a/b/c/d/e/f/g')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps paths at or below the cap intact', () => {
    expect(normalizedFolderSegments('a/b/c/d/e')).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(normalizedFolderSegments('a')).toEqual(['a']);
  });
});

describe('normalizeFolderPath', () => {
  it('keeps root as empty string', () => {
    expect(normalizeFolderPath('')).toBe('');
  });

  it('normalizes whitespace-only input to root', () => {
    expect(normalizeFolderPath('   ')).toBe('');
  });

  it('normalizes delimiter-only input to root', () => {
    expect(normalizeFolderPath('///')).toBe('');
  });

  it('leaves a clean nested path unchanged', () => {
    expect(normalizeFolderPath('ProjectA/Backend')).toBe('ProjectA/Backend');
  });

  it('trims whitespace around segments', () => {
    expect(normalizeFolderPath('  ProjectA  /  Backend  ')).toBe('ProjectA/Backend');
  });

  it('collapses delimiter runs', () => {
    expect(normalizeFolderPath('a//b')).toBe('a/b');
  });

  it('drops whitespace-only segments', () => {
    expect(normalizeFolderPath('a/  /b')).toBe('a/b');
  });

  it('drops leading and trailing delimiters', () => {
    expect(normalizeFolderPath('/a/b/')).toBe('a/b');
  });

  it('truncates paths deeper than MAX_FOLDER_DEPTH', () => {
    expect(normalizeFolderPath('a/b/c/d/e/f/g')).toBe('a/b/c/d/e');
  });

  it('keeps a depth-5 path intact', () => {
    expect(normalizeFolderPath('a/b/c/d/e')).toBe('a/b/c/d/e');
  });

  it('preserves inner whitespace within a segment name', () => {
    expect(normalizeFolderPath('My Project/Sub Folder')).toBe('My Project/Sub Folder');
  });
});
