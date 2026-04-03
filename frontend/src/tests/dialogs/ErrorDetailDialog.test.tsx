import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDetailDialog } from '../../components/dialogs/ErrorDetailDialog';

describe('ErrorDetailDialog', () => {
  const defaultProps = {
    isOpen: true,
    errorMessage: 'psql:C:/tmp/q.tmp:3: ERROR:  relation "bp" already exists',
    onClose: vi.fn(),
  };

  it('isOpen=false時に非表示', () => {
    const { container } = render(<ErrorDetailDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('サマリーを表示', () => {
    render(<ErrorDetailDialog {...defaultProps} />);
    expect(screen.getByText('relation "bp" already exists')).toBeInTheDocument();
  });

  it('rawメッセージを詳細として表示', () => {
    const { container } = render(<ErrorDetailDialog {...defaultProps} />);
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(defaultProps.errorMessage);
  });

  it('ヘッダーに「クエリエラー」を表示', () => {
    render(<ErrorDetailDialog {...defaultProps} />);
    expect(screen.getByText('クエリエラー')).toBeInTheDocument();
  });

  it('閉じるボタンでonClose発火', () => {
    const onClose = vi.fn();
    render(<ErrorDetailDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText('閉じる'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escapeキーでダイアログを閉じる', () => {
    const onClose = vi.fn();
    render(<ErrorDetailDialog {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('コピーボタンが存在する', () => {
    render(<ErrorDetailDialog {...defaultProps} />);
    expect(screen.getByText('コピー')).toBeInTheDocument();
  });

  it('コピーボタンでクリップボードにコピー', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = navigator.clipboard;
    Object.assign(navigator, { clipboard: { writeText } });
    try {
      render(<ErrorDetailDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('コピー'));
      expect(writeText).toHaveBeenCalledWith(defaultProps.errorMessage);
    } finally {
      Object.assign(navigator, { clipboard: original });
    }
  });

  it('オーバーレイクリックでonClose発火', () => {
    const onClose = vi.fn();
    const { container } = render(<ErrorDetailDialog {...defaultProps} onClose={onClose} />);
    if (!(container.firstChild instanceof HTMLElement)) throw new Error('overlay not found');
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
