import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreeNode } from '../../components/tree/TreeNode';
import type { DatabaseObject, EnvironmentType } from '../../types';

const createNode = (overrides: Partial<DatabaseObject> = {}): DatabaseObject => ({
  id: 'test-1',
  name: 'TestNode',
  type: 'table',
  ...overrides,
});

const createBaseProps = () => ({
  level: 0,
  expandedNodes: new Set<string>(),
  onToggle: vi.fn(),
});

describe('TreeNode canExpand', () => {
  it('テーブルノードに展開矢印が表示される', () => {
    render(<TreeNode {...createBaseProps()} node={createNode({ type: 'table' })} />);
    const expander = screen.getByRole('button');
    expect(expander).toBeVisible();
  });

  it('ビューノードに展開矢印が表示される', () => {
    render(
      <TreeNode {...createBaseProps()} node={createNode({ type: 'view', name: 'v_users' })} />
    );
    const expander = screen.getByRole('button');
    expect(expander).toBeVisible();
  });

  it('ビューノード展開時にonToggleが呼ばれる', () => {
    const onToggle = vi.fn();
    const viewNode = createNode({ type: 'view', name: 'v_users' });
    render(<TreeNode {...createBaseProps()} node={viewNode} onToggle={onToggle} />);
    const expander = screen.getByRole('button');
    fireEvent.click(expander);
    expect(onToggle).toHaveBeenCalledWith(viewNode.id, viewNode);
  });

  it('カラムノードには展開矢印が非表示', () => {
    render(<TreeNode {...createBaseProps()} node={createNode({ type: 'column', name: 'id' })} />);
    const expander = screen.getByRole('button', { hidden: true });
    expect(expander).not.toBeVisible();
  });
});

describe('TreeNode environment color', () => {
  const envCases: Array<{ env: EnvironmentType; expectedClass: string }> = [
    { env: 'development', expectedClass: 'nameEnvDevelopment' },
    { env: 'staging', expectedClass: 'nameEnvStaging' },
    { env: 'production', expectedClass: 'nameEnvProduction' },
  ];

  for (const { env, expectedClass } of envCases) {
    it(`databaseノードに environment=${env} を渡すと ${expectedClass} クラスが付く`, () => {
      render(
        <TreeNode
          {...createBaseProps()}
          node={createNode({ type: 'database', name: 'mydb' })}
          environment={env}
        />
      );
      const name = screen.getByText('mydb');
      expect(name.className).toMatch(new RegExp(expectedClass));
    });
  }

  it('environment未指定なら環境クラスは付かない', () => {
    render(
      <TreeNode {...createBaseProps()} node={createNode({ type: 'database', name: 'mydb' })} />
    );
    const name = screen.getByText('mydb');
    expect(name.className).not.toMatch(/nameEnv(Development|Staging|Production)/);
  });

  it('databaseタイプ以外にenvironmentを渡しても環境クラスは付かない（ルートのみ）', () => {
    render(
      <TreeNode
        {...createBaseProps()}
        node={createNode({ type: 'table', name: 'users' })}
        environment="production"
      />
    );
    const name = screen.getByText('users');
    expect(name.className).not.toMatch(/nameEnv(Development|Staging|Production)/);
  });
});
