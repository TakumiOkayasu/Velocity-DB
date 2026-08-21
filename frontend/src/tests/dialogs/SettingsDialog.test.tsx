import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { appSettingsProvider } from '../../api/providers';
import type { AppSettings as BackendAppSettings } from '../../api/providers/app-settings';
import { SettingsDialog } from '../../components/dialogs/SettingsDialog';

vi.mock('../../api/providers', () => ({
  appSettingsProvider: {
    getSettings: vi.fn(),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

// backend getSettings が返す settings.json 相当のフィクスチャ (デフォルトとは異なる値)
const BACKEND_SETTINGS: BackendAppSettings = {
  general: {
    autoConnect: true,
    lastConnectionId: 'conn-1',
    confirmOnExit: false,
    maxQueryHistory: 250,
    maxRecentConnections: 10,
    language: 'ja',
  },
  editor: {
    fontSize: 18,
    fontFamily: 'Cascadia Code',
    wordWrap: false,
    tabSize: 2,
    insertSpaces: true,
    showLineNumbers: true,
    showMinimap: false,
    theme: 'dark',
  },
  grid: {
    defaultPageSize: 500,
    showRowNumbers: false,
    enableCellEditing: false,
    dateFormat: 'yyyy-MM-dd',
    nullDisplay: '<null>',
  },
  query: {
    timeoutSeconds: 45,
  },
};

describe('SettingsDialog', () => {
  const defaultProps = {
    isOpen: true as boolean,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(appSettingsProvider.updateSettings).mockClear();
    // デフォルトは IPC 不通 (browser/dev モック環境相当)。必要なテストで resolve に差し替える
    vi.mocked(appSettingsProvider.getSettings)
      .mockReset()
      .mockRejectedValue(new Error('backend unavailable'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getTimeoutInput(): HTMLInputElement {
    return screen.getByLabelText('クエリタイムアウト (秒)') as HTMLInputElement;
  }

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

  it('6つのタブが表示される (一般/エディタ/クエリ/グリッド/外観/ショートカット)', () => {
    render(<SettingsDialog {...defaultProps} />);
    for (const label of ['一般', 'エディタ', 'クエリ', 'グリッド', '外観', 'ショートカット']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  describe('バックエンド初期値読込 (issue #389)', () => {
    it('開いた時に getSettings の値でフォームが初期化される', async () => {
      vi.mocked(appSettingsProvider.getSettings).mockResolvedValue(BACKEND_SETTINGS);
      render(<SettingsDialog {...defaultProps} />);

      // 一般タブ (初期表示) が backend 値になるまで待つ
      await waitFor(() => {
        const history = screen.getByLabelText('クエリ履歴の最大保存件数') as HTMLInputElement;
        expect(history.value).toBe('250');
      });
      const language = screen.getByLabelText('言語') as HTMLSelectElement;
      expect(language.value).toBe('ja');

      fireEvent.click(screen.getByText('エディタ'));
      expect((screen.getByLabelText('フォントサイズ') as HTMLInputElement).value).toBe('18');
      expect((screen.getByLabelText('フォント') as HTMLInputElement).value).toBe('Cascadia Code');
      expect((screen.getByLabelText('タブサイズ') as HTMLSelectElement).value).toBe('2');

      fireEvent.click(screen.getByText('グリッド'));
      expect((screen.getByLabelText('デフォルトページサイズ (行)') as HTMLInputElement).value).toBe(
        '500'
      );
      expect((screen.getByLabelText('NULLの表示文字列') as HTMLInputElement).value).toBe('<null>');

      fireEvent.click(screen.getByText('クエリ'));
      expect(getTimeoutInput().value).toBe('45');
    });

    it('getSettings 失敗時は defaults で表示される (フォールバック)', async () => {
      render(<SettingsDialog {...defaultProps} />);
      await waitFor(() => {
        expect(appSettingsProvider.getSettings).toHaveBeenCalled();
      });

      expect((screen.getByLabelText('クエリ履歴の最大保存件数') as HTMLInputElement).value).toBe(
        '1000'
      );
      fireEvent.click(screen.getByText('エディタ'));
      expect((screen.getByLabelText('フォントサイズ') as HTMLInputElement).value).toBe('14');
      expect((screen.getByLabelText('フォント') as HTMLInputElement).value).toBe('Consolas');
    });

    it('getSettings 失敗時は localStorage キャッシュの値を表示する', async () => {
      localStorage.setItem(
        'app-settings',
        JSON.stringify({ version: 2, editor: { fontSize: 20 } })
      );
      render(<SettingsDialog {...defaultProps} />);
      await waitFor(() => {
        expect(appSettingsProvider.getSettings).toHaveBeenCalled();
      });

      fireEvent.click(screen.getByText('エディタ'));
      expect((screen.getByLabelText('フォントサイズ') as HTMLInputElement).value).toBe('20');
    });
  });

  describe('保存 (issue #389)', () => {
    it('保存時に backend 対応の全項目を 1 回の updateSettings で送信する', () => {
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('保存'));

      expect(appSettingsProvider.updateSettings).toHaveBeenCalledOnce();
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith({
        general: { autoConnect: false, confirmOnExit: true, maxQueryHistory: 1000, language: 'en' },
        editor: { fontSize: 14, fontFamily: 'Consolas', wordWrap: true, tabSize: 4 },
        grid: { defaultPageSize: 100000, showRowNumbers: true, nullDisplay: '(NULL)' },
        query: { timeoutSeconds: 300 },
      });
    });

    it('変更した一般/グリッド項目が payload に反映される', () => {
      render(<SettingsDialog {...defaultProps} />);

      const language = screen.getByLabelText('言語') as HTMLSelectElement;
      fireEvent.change(language, { target: { value: 'ja' } });

      fireEvent.click(screen.getByText('グリッド'));
      fireEvent.change(screen.getByLabelText('NULLの表示文字列'), {
        target: { value: 'NULL' },
      });

      fireEvent.click(screen.getByText('保存'));
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({ language: 'ja' }),
          grid: expect.objectContaining({ nullDisplay: 'NULL' }),
        })
      );
    });

    it('保存時に localStorage へ frontend-only 項目含む全体を書き込み settings-changed を発火する', () => {
      const listener = vi.fn();
      window.addEventListener('settings-changed', listener);
      try {
        render(<SettingsDialog {...defaultProps} />);
        fireEvent.click(screen.getByText('保存'));

        const saved = localStorage.getItem('app-settings');
        expect(saved).not.toBeNull();
        const parsed = JSON.parse(saved ?? '{}');
        expect(parsed.version).toBe(2);
        expect(parsed.appearance.theme).toBe('dark');
        expect(parsed.editor.minimap).toBe(false);
        expect(parsed.query.autoCommit).toBe(true);
        expect(listener).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener('settings-changed', listener);
      }
    });
  });

  describe('クエリタイムアウト (issue #373)', () => {
    it('デフォルト300秒が秒単位で表示される (defaultSettings.timeout=300000ms)', () => {
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('クエリ'));

      const input = getTimeoutInput();
      expect(input.value).toBe('300');
      expect(input.min).toBe('1');
      expect(input.max).toBe('3600');
    });

    it('入力値変更で内部状態がms単位で保持される (秒→ms変換)', () => {
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('クエリ'));

      const input = getTimeoutInput();
      fireEvent.change(input, { target: { value: '600' } });
      expect(input.value).toBe('600');

      fireEvent.click(screen.getByText('保存'));
      // 保存時は秒単位で Backend へ同期される (Backend の clamp 1-3600 と整合)
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ query: { timeoutSeconds: 600 } })
      );
    });

    it('localStorage に保存された旧値 (30000ms) は秒単位で30と表示される (後方互換)', () => {
      localStorage.setItem(
        'app-settings',
        JSON.stringify({ query: { autoCommit: true, timeout: 30000, maxRows: 10000 } })
      );

      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('クエリ'));

      const input = getTimeoutInput();
      expect(input.value).toBe('30');
    });

    it('上限値3600を入力した場合も保存できる (Backend clamp 上限と整合)', () => {
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('クエリ'));

      const input = getTimeoutInput();
      fireEvent.change(input, { target: { value: '3600' } });
      fireEvent.click(screen.getByText('保存'));
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ query: { timeoutSeconds: 3600 } })
      );
    });
  });
});
