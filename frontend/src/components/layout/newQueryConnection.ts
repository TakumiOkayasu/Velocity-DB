export function resolveNewQueryConnectionId(
  activeQueryConnectionId: string | null | undefined,
  activeConnectionId: string | null | undefined
): string | null {
  return activeQueryConnectionId ?? activeConnectionId ?? null;
}
