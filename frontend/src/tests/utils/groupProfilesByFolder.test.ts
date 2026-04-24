import { describe, expect, it } from 'vitest';
import type { SavedConnectionProfile } from '../../types';
import { groupProfilesByFolder } from '../../utils/groupProfilesByFolder';

function makeProfile(id: string, folderPath?: string): SavedConnectionProfile {
  return {
    id,
    name: id,
    server: 'localhost',
    port: 1433,
    database: 'db',
    username: 'u',
    useWindowsAuth: true,
    savePassword: false,
    isProduction: false,
    isReadOnly: false,
    ...(folderPath === undefined ? {} : { folderPath }),
  };
}

describe('groupProfilesByFolder', () => {
  it('returns empty array when no profiles', () => {
    expect(groupProfilesByFolder([])).toEqual([]);
  });

  it('groups all profiles under root when none have folderPath', () => {
    const profiles = [makeProfile('a'), makeProfile('b')];

    const result = groupProfilesByFolder(profiles);

    expect(result).toEqual([{ folderPath: '', profiles: [profiles[0], profiles[1]] }]);
  });

  it('treats undefined and empty string folderPath as root', () => {
    const profiles = [makeProfile('a'), makeProfile('b', ''), makeProfile('c', undefined)];

    const result = groupProfilesByFolder(profiles);

    expect(result).toHaveLength(1);
    expect(result[0].folderPath).toBe('');
    expect(result[0].profiles.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('groups profiles by folderPath preserving first-appearance order', () => {
    const profiles = [
      makeProfile('root1'),
      makeProfile('work1', 'Work'),
      makeProfile('root2'),
      makeProfile('work2', 'Work'),
      makeProfile('personal1', 'Personal'),
    ];

    const result = groupProfilesByFolder(profiles);

    expect(result.map((g) => g.folderPath)).toEqual(['', 'Work', 'Personal']);
    expect(result[0].profiles.map((p) => p.id)).toEqual(['root1', 'root2']);
    expect(result[1].profiles.map((p) => p.id)).toEqual(['work1', 'work2']);
    expect(result[2].profiles.map((p) => p.id)).toEqual(['personal1']);
  });

  it('preserves within-group profile order as given', () => {
    const profiles = [
      makeProfile('w3', 'Work'),
      makeProfile('w1', 'Work'),
      makeProfile('w2', 'Work'),
    ];

    const result = groupProfilesByFolder(profiles);

    expect(result).toHaveLength(1);
    expect(result[0].profiles.map((p) => p.id)).toEqual(['w3', 'w1', 'w2']);
  });

  it('does not create a root group if all profiles are foldered', () => {
    const profiles = [makeProfile('a', 'A'), makeProfile('b', 'B')];

    const result = groupProfilesByFolder(profiles);

    expect(result.map((g) => g.folderPath)).toEqual(['A', 'B']);
  });
});
