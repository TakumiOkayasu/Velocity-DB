import { describe, expect, it } from 'vitest';
import type { SavedConnectionProfile } from '../../types';
import {
  collectFolderPaths,
  countFolderProfiles,
  type FolderTreeNode,
  groupProfilesByFolder,
} from '../../utils/groupProfilesByFolder';

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

function findFolder(folders: FolderTreeNode[], fullPath: string): FolderTreeNode | undefined {
  for (const node of folders) {
    if (node.fullPath === fullPath) return node;
    const nested = findFolder(node.subfolders, fullPath);
    if (nested) return nested;
  }
  return undefined;
}

describe('groupProfilesByFolder', () => {
  it('returns empty tree when no profiles', () => {
    expect(groupProfilesByFolder([])).toEqual({ folders: [], rootProfiles: [] });
  });

  it('puts all profiles at root when none have folderPath', () => {
    const profiles = [makeProfile('a'), makeProfile('b')];

    const result = groupProfilesByFolder(profiles);

    expect(result.folders).toEqual([]);
    expect(result.rootProfiles).toEqual([profiles[0], profiles[1]]);
  });

  it('treats undefined, empty and delimiter-only folderPath as root', () => {
    const profiles = [
      makeProfile('a'),
      makeProfile('b', ''),
      makeProfile('c', undefined),
      makeProfile('d', ' / '),
    ];

    const result = groupProfilesByFolder(profiles);

    expect(result.folders).toEqual([]);
    expect(result.rootProfiles.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('groups flat folders preserving first-appearance order', () => {
    const profiles = [
      makeProfile('root1'),
      makeProfile('work1', 'Work'),
      makeProfile('root2'),
      makeProfile('work2', 'Work'),
      makeProfile('personal1', 'Personal'),
    ];

    const result = groupProfilesByFolder(profiles);

    expect(result.folders.map((f) => f.fullPath)).toEqual(['Work', 'Personal']);
    expect(result.rootProfiles.map((p) => p.id)).toEqual(['root1', 'root2']);
    expect(result.folders[0].profiles.map((p) => p.id)).toEqual(['work1', 'work2']);
    expect(result.folders[1].profiles.map((p) => p.id)).toEqual(['personal1']);
  });

  it('builds nested folders from "/"-delimited paths', () => {
    const profiles = [makeProfile('deep', 'Work/ProjectA/Backend'), makeProfile('mid', 'Work')];

    const result = groupProfilesByFolder(profiles);

    expect(result.folders).toHaveLength(1);
    const work = result.folders[0];
    expect(work.name).toBe('Work');
    expect(work.fullPath).toBe('Work');
    expect(work.profiles.map((p) => p.id)).toEqual(['mid']);
    expect(work.subfolders).toHaveLength(1);

    const projectA = work.subfolders[0];
    expect(projectA.name).toBe('ProjectA');
    expect(projectA.fullPath).toBe('Work/ProjectA');
    expect(projectA.profiles).toEqual([]);

    const backend = projectA.subfolders[0];
    expect(backend.name).toBe('Backend');
    expect(backend.fullPath).toBe('Work/ProjectA/Backend');
    expect(backend.profiles.map((p) => p.id)).toEqual(['deep']);
    expect(backend.subfolders).toEqual([]);
  });

  it('preserves first-appearance order at every level', () => {
    const profiles = [
      makeProfile('1', 'B/Second'),
      makeProfile('2', 'A'),
      makeProfile('3', 'B/First'),
      makeProfile('4', 'B'),
    ];

    const result = groupProfilesByFolder(profiles);

    expect(result.folders.map((f) => f.name)).toEqual(['B', 'A']);
    const b = result.folders[0];
    expect(b.subfolders.map((f) => f.name)).toEqual(['Second', 'First']);
    expect(b.profiles.map((p) => p.id)).toEqual(['4']);
  });

  it('keeps same leaf name under different parents as distinct folders', () => {
    const profiles = [makeProfile('a', 'Alpha/Sub'), makeProfile('b', 'Beta/Sub')];

    const result = groupProfilesByFolder(profiles);

    const alphaSub = findFolder(result.folders, 'Alpha/Sub');
    const betaSub = findFolder(result.folders, 'Beta/Sub');
    expect(alphaSub?.profiles.map((p) => p.id)).toEqual(['a']);
    expect(betaSub?.profiles.map((p) => p.id)).toEqual(['b']);
  });

  it('normalizes paths so messy variants group together', () => {
    const profiles = [
      makeProfile('a', 'Work/ProjectA'),
      makeProfile('b', ' Work / ProjectA '),
      makeProfile('c', '/Work//ProjectA/'),
    ];

    const result = groupProfilesByFolder(profiles);

    const projectA = findFolder(result.folders, 'Work/ProjectA');
    expect(projectA?.profiles.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('caps folder depth at 5, attaching deeper profiles to the depth-5 folder', () => {
    const profiles = [makeProfile('deep', 'a/b/c/d/e/f/g')];

    const result = groupProfilesByFolder(profiles);

    const depth5 = findFolder(result.folders, 'a/b/c/d/e');
    expect(depth5?.profiles.map((p) => p.id)).toEqual(['deep']);
    expect(depth5?.subfolders).toEqual([]);
    expect(findFolder(result.folders, 'a/b/c/d/e/f')).toBeUndefined();
  });

  it('preserves within-folder profile order as given', () => {
    const profiles = [
      makeProfile('w3', 'Work'),
      makeProfile('w1', 'Work'),
      makeProfile('w2', 'Work'),
    ];

    const result = groupProfilesByFolder(profiles);

    expect(result.folders[0].profiles.map((p) => p.id)).toEqual(['w3', 'w1', 'w2']);
  });
});

describe('countFolderProfiles', () => {
  it('counts direct and descendant profiles', () => {
    const { folders } = groupProfilesByFolder([
      makeProfile('a', 'Work'),
      makeProfile('b', 'Work/Sub'),
      makeProfile('c', 'Work/Sub/Deep'),
    ]);

    expect(countFolderProfiles(folders[0])).toBe(3);
    const sub = findFolder(folders, 'Work/Sub');
    expect(sub === undefined ? -1 : countFolderProfiles(sub)).toBe(2);
  });

  it('returns 0 for a folder with no profiles anywhere', () => {
    const node: FolderTreeNode = { name: 'X', fullPath: 'X', subfolders: [], profiles: [] };
    expect(countFolderProfiles(node)).toBe(0);
  });
});

describe('collectFolderPaths', () => {
  it('collects every fullPath including ancestors', () => {
    const { folders } = groupProfilesByFolder([
      makeProfile('a', 'Work/ProjectA/Backend'),
      makeProfile('b', 'Personal'),
    ]);

    expect([...collectFolderPaths(folders)].sort()).toEqual([
      'Personal',
      'Work',
      'Work/ProjectA',
      'Work/ProjectA/Backend',
    ]);
  });

  it('returns empty set for empty tree', () => {
    expect(collectFolderPaths([]).size).toBe(0);
  });
});
