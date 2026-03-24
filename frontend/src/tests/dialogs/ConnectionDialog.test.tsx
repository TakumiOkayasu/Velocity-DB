import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionDialog } from '../../components/dialogs/ConnectionDialog';

vi.mock('../../api/bridge', () => ({
  bridge: {
    getConnectionProfiles: vi.fn().mockResolvedValue({ profiles: [] }),
    testConnection: vi.fn(),
    saveConnectionProfile: vi.fn(),
    deleteConnectionProfile: vi.fn(),
    getProfilePassword: vi.fn(),
  },
}));

describe('ConnectionDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onConnect: vi.fn(),
  };

  it('Escapeキーでダイアログを閉じる', async () => {
    const onClose = vi.fn();
    render(<ConnectionDialog {...defaultProps} onClose={onClose} />);
    await waitFor(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('オーバーレイクリックでダイアログを閉じる', async () => {
    const onClose = vi.fn();
    const { container } = render(<ConnectionDialog {...defaultProps} onClose={onClose} />);
    await waitFor(() => {
      const backdrop = container.querySelector('[class*="backdrop"]') as HTMLElement;
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('ダイアログ内クリックでは閉じない', async () => {
    const onClose = vi.fn();
    const { container } = render(<ConnectionDialog {...defaultProps} onClose={onClose} />);
    await waitFor(() => {
      const dialog = container.querySelector('[class*="dialog"]') as HTMLElement;
      fireEvent.click(dialog);
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('isOpen=false時に非表示', () => {
    const { container } = render(<ConnectionDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('接続中に「接続中止」ボタンが表示される', async () => {
    render(<ConnectionDialog {...defaultProps} isConnecting={true} onCancelConnect={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('接続中止')).toBeTruthy();
    });
  });

  it('接続中でないときに「接続」ボタンが表示される', async () => {
    render(<ConnectionDialog {...defaultProps} isConnecting={false} />);
    await waitFor(() => {
      expect(screen.getByText('接続')).toBeTruthy();
    });
  });

  it('接続中止ボタンがonCancelConnectを呼ぶ', async () => {
    const onCancelConnect = vi.fn();
    render(
      <ConnectionDialog {...defaultProps} isConnecting={true} onCancelConnect={onCancelConnect} />
    );
    await waitFor(() => {
      fireEvent.click(screen.getByText('接続中止'));
      expect(onCancelConnect).toHaveBeenCalledOnce();
    });
  });

  it('接続中にキャンセルボタンでonCancelConnect+onCloseが呼ばれる', async () => {
    const onClose = vi.fn();
    const onCancelConnect = vi.fn();
    render(
      <ConnectionDialog
        {...defaultProps}
        onClose={onClose}
        isConnecting={true}
        onCancelConnect={onCancelConnect}
      />
    );
    await waitFor(() => {
      fireEvent.click(screen.getByText('キャンセル'));
      expect(onCancelConnect).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
