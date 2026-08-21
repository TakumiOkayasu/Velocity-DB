import { describe, expect, it } from 'vite-plus/test';
import { pruneCollapsedFolders } from '../../utils/pruneCollapsedFolders';

describe('pruneCollapsedFolders', () => {
  it('returns null when collapsed set is empty', () => {
    expect(pruneCollapsedFolders(new Set(), new Set(['Work']))).toBeNull();
  });

  it('returns null when every collapsed folder still exists', () => {
    expect(
      pruneCollapsedFolders(new Set(['Work', 'Personal']), new Set(['Work', 'Personal']))
    ).toBeNull();
  });

  it('drops folders that no longer exist', () => {
    const result = pruneCollapsedFolders(new Set(['Work', 'Personal']), new Set(['Work']));
    expect(result).not.toBeNull();
    expect([...(result ?? [])]).toEqual(['Work']);
  });

  it('returns empty set when no collapsed folder remains', () => {
    const result = pruneCollapsedFolders(new Set(['Work']), new Set(['Personal']));
    expect(result).not.toBeNull();
    expect(result?.size).toBe(0);
  });

  it('preserves insertion order of surviving folders', () => {
    const result = pruneCollapsedFolders(new Set(['A', 'B', 'C', 'D']), new Set(['A', 'C', 'D']));
    expect([...(result ?? [])]).toEqual(['A', 'C', 'D']);
  });
});
