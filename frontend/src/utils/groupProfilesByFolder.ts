import type { SavedConnectionProfile } from '../types';
import { FOLDER_PATH_DELIMITER, normalizedFolderSegments } from './folderPath';

/** One folder in the connection tree. `fullPath` is '/'-delimited and unique. */
export interface FolderTreeNode {
  name: string;
  fullPath: string;
  subfolders: FolderTreeNode[];
  profiles: SavedConnectionProfile[];
}

export interface ProfileFolderTree {
  folders: FolderTreeNode[];
  rootProfiles: SavedConnectionProfile[];
}

/**
 * Build a nested folder tree from profiles' folderPath (#599).
 * Paths are normalized (trimmed segments, empty segments dropped, depth
 * capped at MAX_FOLDER_DEPTH). First-appearance order is preserved for
 * folders at every level and for profiles within each folder.
 */
export function groupProfilesByFolder(profiles: SavedConnectionProfile[]): ProfileFolderTree {
  const folders: FolderTreeNode[] = [];
  const rootProfiles: SavedConnectionProfile[] = [];
  const nodeByPath = new Map<string, FolderTreeNode>();

  for (const profile of profiles) {
    const segments = normalizedFolderSegments(profile.folderPath ?? '');
    if (segments.length === 0) {
      rootProfiles.push(profile);
      continue;
    }

    let siblings = folders;
    let fullPath = '';
    let target: FolderTreeNode | null = null;
    for (const segment of segments) {
      fullPath = fullPath === '' ? segment : `${fullPath}${FOLDER_PATH_DELIMITER}${segment}`;
      let node = nodeByPath.get(fullPath);
      if (node === undefined) {
        node = { name: segment, fullPath, subfolders: [], profiles: [] };
        nodeByPath.set(fullPath, node);
        siblings.push(node);
      }
      siblings = node.subfolders;
      target = node;
    }
    if (target !== null) {
      target.profiles.push(profile);
    }
  }

  return { folders, rootProfiles };
}

/** Total profile count of a folder including all descendant folders. */
export function countFolderProfiles(node: FolderTreeNode): number {
  return node.subfolders.reduce(
    (sum, child) => sum + countFolderProfiles(child),
    node.profiles.length
  );
}

/** Collect every folder fullPath in the tree (ancestors included). */
export function collectFolderPaths(folders: readonly FolderTreeNode[]): Set<string> {
  const paths = new Set<string>();
  const visit = (nodes: readonly FolderTreeNode[]): void => {
    for (const node of nodes) {
      paths.add(node.fullPath);
      visit(node.subfolders);
    }
  };
  visit(folders);
  return paths;
}
