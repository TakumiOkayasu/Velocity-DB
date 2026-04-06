import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsDialog } from '../../components/dialogs/SettingsDialog';

vi.mock('../../api/bridge', () => ({
  bridge: {
    updateSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('SettingsDialog', () => {
  const defaultProps = {
    isOpen: true as boolean,
    onClose: vi.fn(),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isOpen=false時に非表示', () => {
    const { container } = render(<SettingsDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('isOpen=true時に表示', () => {
    render(<SettingsDialog {...defaultProps} />);
    expect(screen.getByText('設定')).toBeInTheDocument();
  });

  it('Escapeキーでダイアログが閉じる', () => {
    const onClose = vi.fn();
    render(<SettingsDialog {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('isOpen=false時にEscapeキーでonCloseが発火しない', () => {
    const onClose = vi.fn();
    render(<SettingsDialog {...defaultProps} isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('overlayクリックでonCloseが発火', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsDialog {...defaultProps} onClose={onClose} />);
    if (!(container.firstChild instanceof Element)) throw new Error('overlay not found');
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
