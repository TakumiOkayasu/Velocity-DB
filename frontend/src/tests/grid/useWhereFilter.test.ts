import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWhereFilter } from '../../components/grid/hooks/useWhereFilter';

interface SetupProps {
  activeQueryId: string | null;
  queryConnectionId: string | null;
  storedWhereClause: string;
}

function setup(
  initial: SetupProps = {
    activeQueryId: 'q1',
    queryConnectionId: 'c1',
    storedWhereClause: '',
  }
) {
  const applyWhereFilter = vi.fn().mockResolvedValue(null);
  const hook = renderHook(
    ({ activeQueryId, queryConnectionId, storedWhereClause }: SetupProps) =>
      useWhereFilter({
        activeQueryId,
        queryConnectionId,
        storedWhereClause,
        applyWhereFilter,
      }),
    { initialProps: initial }
  );
  return { hook, applyWhereFilter };
}

describe('useWhereFilter', () => {
  it('アクティブクエリが切り替わると storedWhereClause に同期する', () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.setWhereClause('age > 18');
    });
    expect(hook.result.current.whereClause).toBe('age > 18');

    hook.rerender({ activeQueryId: 'q2', queryConnectionId: 'c1', storedWhereClause: '' });

    expect(hook.result.current.whereClause).toBe('');
    expect(hook.result.current.whereFilterError).toBeNull();
  });

  it('保存された WHERE 句があるタブに切り替えるとそれを復元する', () => {
    const { hook } = setup();

    hook.rerender({
      activeQueryId: 'q2',
      queryConnectionId: 'c1',
      storedWhereClause: 'status = 1',
    });

    expect(hook.result.current.whereClause).toBe('status = 1');
  });

  it('同じクエリIDではリセットせず、applyWhereFilter も呼ばれない', () => {
    const { hook, applyWhereFilter } = setup();

    act(() => {
      hook.result.current.setWhereClause('id = 1');
    });

    hook.rerender({
      activeQueryId: 'q1',
      queryConnectionId: 'c1',
      storedWhereClause: '',
    });

    expect(hook.result.current.whereClause).toBe('id = 1');
    expect(applyWhereFilter).not.toHaveBeenCalled();
  });

  it('エラー表示も切り替え時にクリアする', () => {
    const { hook } = setup();

    act(() => {
      hook.result.current.setWhereFilterError('syntax error');
    });
    expect(hook.result.current.whereFilterError).toBe('syntax error');

    hook.rerender({ activeQueryId: 'q2', queryConnectionId: 'c1', storedWhereClause: '' });

    expect(hook.result.current.whereFilterError).toBeNull();
  });

  it('フィルタ適用中に入力が空になったら自動で applyWhereFilter("") を呼ぶ', async () => {
    const { hook, applyWhereFilter } = setup({
      activeQueryId: 'q1',
      queryConnectionId: 'c1',
      storedWhereClause: 'id = 1',
    });

    await act(async () => {
      hook.result.current.whereChange('');
    });

    expect(applyWhereFilter).toHaveBeenCalledWith('q1', 'c1', '');
    expect(hook.result.current.whereClause).toBe('');
  });

  it('storedWhereClause が既に空なら空入力で applyWhereFilter は呼ばれない', () => {
    const { hook, applyWhereFilter } = setup({
      activeQueryId: 'q1',
      queryConnectionId: 'c1',
      storedWhereClause: '',
    });

    act(() => {
      hook.result.current.whereChange('');
    });

    expect(applyWhereFilter).not.toHaveBeenCalled();
  });

  it('空白のみの入力も空扱いで自動解除する', async () => {
    const { hook, applyWhereFilter } = setup({
      activeQueryId: 'q1',
      queryConnectionId: 'c1',
      storedWhereClause: 'id = 1',
    });

    await act(async () => {
      hook.result.current.whereChange('   ');
    });

    expect(applyWhereFilter).toHaveBeenCalledWith('q1', 'c1', '');
  });

  it('非空入力では applyWhereFilter は呼ばれず、ローカル値のみ更新する', () => {
    const { hook, applyWhereFilter } = setup({
      activeQueryId: 'q1',
      queryConnectionId: 'c1',
      storedWhereClause: 'id = 1',
    });

    act(() => {
      hook.result.current.whereChange('age > 18');
    });

    expect(applyWhereFilter).not.toHaveBeenCalled();
    expect(hook.result.current.whereClause).toBe('age > 18');
  });
});
