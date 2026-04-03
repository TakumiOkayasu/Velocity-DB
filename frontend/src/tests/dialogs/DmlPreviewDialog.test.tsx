import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DmlPreviewDialog } from '../../components/dialogs/DmlPreviewDialog';

describe('DmlPreviewDialog', () => {
  const defaultProps = {
    isOpen: true,
    statements: ["UPDATE users SET name = 'test' WHERE id = 1;", 'DELETE FROM logs WHERE id = 2;'],
    isExecuting: false,
    onExecute: vi.fn(),
    onCancel: vi.fn(),
  };

  it('isOpen=false時に非表示', () => {
    const { container } = render(<DmlPreviewDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('statements表示', () => {
    render(<DmlPreviewDialog {...defaultProps} />);
    expect(screen.getByText(/UPDATE users/)).toBeInTheDocument();
    expect(screen.getByText(/DELETE FROM logs/)).toBeInTheDocument();
  });

  it('サマリ行にSQL件数を表示', () => {
    render(<DmlPreviewDialog {...defaultProps} />);
    expect(screen.getByText(/2件/)).toBeInTheDocument();
  });

  it('Executeボタンでコールバック発火', () => {
    const onExecute = vi.fn();
    render(<DmlPreviewDialog {...defaultProps} onExecute={onExecute} />);
    fireEvent.click(screen.getByText('実行'));
    expect(onExecute).toHaveBeenCalledOnce();
  });

  it('Cancelボタンでコールバック発火', () => {
    const onCancel = vi.fn();
    render(<DmlPreviewDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('isExecuting時にボタン無効化', () => {
    render(<DmlPreviewDialog {...defaultProps} isExecuting={true} />);
    expect(screen.getByText('実行中...')).toBeDisabled();
    expect(screen.getByText('キャンセル')).toBeDisabled();
  });

  it('空のstatements配列でも安全に表示', () => {
    render(<DmlPreviewDialog {...defaultProps} statements={[]} />);
    expect(screen.getByText(/0件/)).toBeInTheDocument();
  });

  it('overlayクリックでonCancelが発火', () => {
    const onCancel = vi.fn();
    const { container } = render(<DmlPreviewDialog {...defaultProps} onCancel={onCancel} />);
    if (!(container.firstChild instanceof Element)) throw new Error('overlay not found');
    fireEvent.click(container.firstChild);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('isExecuting時にoverlayクリックでonCancelが発火しない', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <DmlPreviewDialog {...defaultProps} isExecuting={true} onCancel={onCancel} />
    );
    if (!(container.firstChild instanceof Element)) throw new Error('overlay not found');
    fireEvent.click(container.firstChild);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escapeキーでキャンセル発火', () => {
    const onCancel = vi.fn();
    render(<DmlPreviewDialog {...defaultProps} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('isExecuting時にEscapeキーでキャンセルが発火しない', () => {
    const onCancel = vi.fn();
    render(<DmlPreviewDialog {...defaultProps} isExecuting={true} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
