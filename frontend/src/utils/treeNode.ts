import type { DatabaseObject } from '../types';

/** Recursively update children of a specific node in the tree */
export function updateNodeChildren(
  nodes: DatabaseObject[],
  targetId: string,
  newChildren: DatabaseObject[]
): DatabaseObject[] {
  return nodes.map((n) => {
    if (n.id === targetId) return { ...n, children: newChildren };
    if (n.children)
      return { ...n, children: updateNodeChildren(n.children, targetId, newChildren) };
    return n;
  });
}

/** Extract schema and tableName from a structured node ID (connectionId-schema-tableName) */
export function parseTableNodeId(
  nodeId: string,
  connectionId: string
): { schema: string; tableName: string } | null {
  const prefix = `${connectionId}-`;
  if (!nodeId.startsWith(prefix)) return null;
  const rest = nodeId.slice(prefix.length);
  const dotIdx = rest.indexOf('-');
  if (dotIdx === -1) return null;
  return { schema: rest.slice(0, dotIdx), tableName: rest.slice(dotIdx + 1) };
}

/** カラム遅延読み込みの対象ノードか判定 */
export function shouldLoadColumns(
  node: DatabaseObject
): node is DatabaseObject & { type: 'table' | 'view' } {
  return (
    (node.type === 'table' || node.type === 'view') &&
    (!node.children || node.children.length === 0)
  );
}
