/**
 * Connection profile folder path helpers (#599).
 *
 * A folder path is a '/'-delimited string (e.g. "ProjectA/Backend").
 * Empty string = root. Nesting is capped at MAX_FOLDER_DEPTH levels.
 */

export const FOLDER_PATH_DELIMITER = '/';
export const MAX_FOLDER_DEPTH = 5;

/** Split a folder path into trimmed, non-empty segments. */
export function splitFolderPath(path: string): string[] {
  return path
    .split(FOLDER_PATH_DELIMITER)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');
}

/** Split + normalize, truncating to MAX_FOLDER_DEPTH segments. */
export function normalizedFolderSegments(raw: string): string[] {
  return splitFolderPath(raw).slice(0, MAX_FOLDER_DEPTH);
}

/**
 * Normalize a raw folder path: trim each segment, drop empty segments
 * (collapses '//' runs and leading/trailing delimiters), truncate to
 * MAX_FOLDER_DEPTH segments, and rejoin. '' stays root.
 */
export function normalizeFolderPath(raw: string): string {
  return normalizedFolderSegments(raw).join(FOLDER_PATH_DELIMITER);
}
