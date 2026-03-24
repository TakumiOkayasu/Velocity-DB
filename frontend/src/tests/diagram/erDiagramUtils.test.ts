import { describe, expect, it } from 'vitest';
import type { ERTableNode } from '../../types';
import { filterTablesByQuery } from '../../utils/erDiagramUtils';

function makeTable(
  id: string,
  tableName: string,
  logicalName?: string,
  page?: string
): ERTableNode {
  return {
    id,
    type: 'table',
    data: {
      tableName,
      logicalName,
      page,
      columns: [],
    },
    position: { x: 0, y: 0 },
  };
}

const tables: ERTableNode[] = [
  makeTable('users', 'users', 'ユーザー', 'MAIN'),
  makeTable('orders', 'orders', '注文', 'MAIN'),
  makeTable('products', 'products', '商品', 'SUB'),
  makeTable('categories', 'categories', undefined, 'SUB'),
];

describe('filterTablesByQuery', () => {
  it('should match by physical name', () => {
    const result = filterTablesByQuery(tables, 'user');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('users');
  });

  it('should match by logical name', () => {
    const result = filterTablesByQuery(tables, '注文');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('orders');
  });

  it('should be case-insensitive', () => {
    const result = filterTablesByQuery(tables, 'PROD');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('products');
  });

  it('should return empty for no match', () => {
    const result = filterTablesByQuery(tables, 'nonexistent');
    expect(result).toHaveLength(0);
  });

  it('should return all for empty query', () => {
    // filterTablesByQuery with empty string matches all
    // (caller should guard against empty query)
    const result = filterTablesByQuery(tables, '');
    expect(result).toHaveLength(4);
  });

  it('should handle tables without logicalName', () => {
    const result = filterTablesByQuery(tables, 'categ');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('categories');
  });
});
