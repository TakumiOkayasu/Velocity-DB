import { within } from '@testing-library/dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { connectionProfileProvider as bridge } from '../../api/providers';
import { ConnectionDialog } from '../../components/dialogs/ConnectionDialog';
import { useConnectionStore } from '../../store/connectionStore';

vi.mock('../../api/providers', () => ({
  connectionProfileProvider: {
    getConnectionProfiles: vi.fn().mockResolvedValue({ profiles: [] }),
    saveConnectionProfile: vi.fn(),
    deleteConnectionProfile: vi.fn(),
    getProfilePassword: vi.fn(),
  },
  connectionProvider: {
    testConnection: vi.fn(),
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
      const backdrop = container.querySelector('[class*="backdrop"]');
      if (!(backdrop instanceof HTMLElement)) throw new Error('backdrop not found');
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('ダイアログ内クリックでは閉じない', async () => {
    const onClose = vi.fn();
    const { container } = render(<ConnectionDialog {...defaultProps} onClose={onClose} />);
    await waitFor(() => {
      const dialog = container.querySelector('[class*="dialog"]');
      if (!(dialog instanceof HTMLElement)) throw new Error('dialog not found');
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

  it('ダイアログ内のフォーム要素クリックでは閉じない', async () => {
    const onClose = vi.fn();
    render(<ConnectionDialog {...defaultProps} onClose={onClose} />);
    await waitFor(() => {
      const input = document.querySelector('input');
      if (!(input instanceof HTMLElement)) throw new Error('input not found');
      fireEvent.click(input);
      expect(onClose).not.toHaveBeenCalled();
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

  describe('profileVersion連携', () => {
    const mockedBridge = vi.mocked(bridge);

    beforeEach(() => {
      useConnectionStore.setState({ profileVersion: 0 });
    });

    afterEach(() => {
      useConnectionStore.setState({ profileVersion: 0 });
    });

    it('プロファイル保存後にprofileVersionがインクリメントされる', async () => {
      mockedBridge.saveConnectionProfile.mockResolvedValue({ id: 'profile_1' });
      mockedBridge.getConnectionProfiles.mockResolvedValue({ profiles: [] });

      render(<ConnectionDialog {...defaultProps} />);

      // ダイアログ表示を待つ
      await waitFor(() => {
        expect(screen.getByText('新規保存')).toBeTruthy();
      });

      // 保存ボタンをクリック
      fireEvent.click(screen.getByText('新規保存'));

      await waitFor(() => {
        expect(useConnectionStore.getState().profileVersion).toBe(1);
      });
    });

    it('プロファイル削除後にprofileVersionがインクリメントされる', async () => {
      const testProfile = {
        id: 'profile_1',
        name: 'Test DB',
        server: 'localhost',
        port: 1433,
        database: 'testdb',
        username: 'sa',
        useWindowsAuth: false,
        savePassword: false,
        isProduction: false,
        isReadOnly: false,
      };
      mockedBridge.getConnectionProfiles.mockResolvedValue({ profiles: [testProfile] });
      mockedBridge.getProfilePassword.mockResolvedValue({ password: '' });
      mockedBridge.deleteConnectionProfile.mockResolvedValue({ deleted: true });

      render(<ConnectionDialog {...defaultProps} />);

      // プロファイルがロードされてeditモードになるのを待つ
      await waitFor(() => {
        expect(screen.getByText('削除')).toBeTruthy();
      });

      // 削除ボタンをクリック → 確認ダイアログ
      fireEvent.click(screen.getByText('削除'));

      // 確認ダイアログの「削除」ボタンをクリック
      await waitFor(() => {
        const confirmDialog = screen
          .getByText('接続プロファイルの削除')
          .closest('[class*="dialog"]');
        const confirmDeleteButton = within(confirmDialog as HTMLElement).getByText('削除');
        fireEvent.click(confirmDeleteButton);
      });

      await waitFor(() => {
        expect(useConnectionStore.getState().profileVersion).toBe(1);
      });
    });
  });
});
