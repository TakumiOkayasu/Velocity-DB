export function pruneCollapsedFolders(
  collapsed: ReadonlySet<string>,
  existing: ReadonlySet<string>
): Set<string> | null {
  if (collapsed.size === 0) return null;
  let changed = false;
  const next = new Set<string>();
  for (const path of collapsed) {
    if (existing.has(path)) next.add(path);
    else changed = true;
  }
  return changed ? next : null;
}
