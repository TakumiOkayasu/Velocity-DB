import { describe, expect, it } from 'vite-plus/test';
import type { DatabaseObject } from '../../types';
import { shouldLoadColumns } from '../../utils/treeNode';

describe('viewColumnExpand', () => {
  it('ビューノードはカラム読み込み対象', () => {
    const viewNode: DatabaseObject = {
      id: 'conn1-dbo-vw_Users',
      name: 'vw_Users',
      type: 'view',
      children: [],
    };
    expect(shouldLoadColumns(viewNode)).toBe(true);
  });

  it('テーブルノードはカラム読み込み対象 (回帰テスト)', () => {
    const tableNode: DatabaseObject = {
      id: 'conn1-dbo-Users',
      name: 'Users',
      type: 'table',
      children: [],
    };
    expect(shouldLoadColumns(tableNode)).toBe(true);
  });

  it('カラム読み込み済みノードは対象外', () => {
    const node: DatabaseObject = {
      id: 'conn1-dbo-Users',
      name: 'Users',
      type: 'table',
      children: [{ id: 'col1', name: 'id', type: 'column' }],
    };
    expect(shouldLoadColumns(node)).toBe(false);
  });

  it('folderノードは対象外', () => {
    const node: DatabaseObject = {
      id: 'conn1-tables',
      name: 'Tables',
      type: 'folder',
      children: [],
    };
    expect(shouldLoadColumns(node)).toBe(false);
  });
});
