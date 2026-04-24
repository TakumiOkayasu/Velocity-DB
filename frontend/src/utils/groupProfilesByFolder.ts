import type { SavedConnectionProfile } from '../types';

export interface ProfileGroup {
  folderPath: string;
  profiles: SavedConnectionProfile[];
}

export function groupProfilesByFolder(profiles: SavedConnectionProfile[]): ProfileGroup[] {
  const groupIndex = new Map<string, number>();
  const groups: ProfileGroup[] = [];

  for (const profile of profiles) {
    const folderPath = profile.folderPath ?? '';
    const existing = groupIndex.get(folderPath);
    if (existing === undefined) {
      groupIndex.set(folderPath, groups.length);
      groups.push({ folderPath, profiles: [profile] });
    } else {
      groups[existing].profiles.push(profile);
    }
  }

  return groups;
}
