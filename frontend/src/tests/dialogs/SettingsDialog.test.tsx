import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  webview: {
    gpuCompositing: false,
    rendererBackgrounding: false,
    cacheEnabled: false,
    openDevToolsOnStartup: false,
  },
  webviewStartup: {
    gpuCompositing: false,
    rendererBackgrounding: false,
    cacheEnabled: false,
    openDevToolsOnStartup: false,
  },
  webviewRestartRequired: false,
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
    autoCommit: true,
    maxRows: 10000,
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
    defaultProps.onClose.mockClear();
    vi.mocked(appSettingsProvider.updateSettings).mockReset().mockResolvedValue({ saved: true });
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

  it('7つの設定タブが表示される', () => {
    render(<SettingsDialog {...defaultProps} />);
    for (const label of [
      '一般',
      'エディタ',
      'クエリ',
      'グリッド',
      'WebView',
      '外観',
      'ショートカット',
    ]) {
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
      const language = screen.getByLabelText('言語 (切替未対応)') as HTMLSelectElement;
      expect(language.value).toBe('ja');

      fireEvent.click(screen.getByText('エディタ'));
      expect((screen.getByLabelText('フォントサイズ') as HTMLInputElement).value).toBe('18');
      expect((screen.getByLabelText('フォント') as HTMLInputElement).value).toBe('Cascadia Code');
      expect((screen.getByLabelText('タブサイズ') as HTMLSelectElement).value).toBe('2');

      fireEvent.click(screen.getByText('グリッド'));
      expect(
        (
          screen.getByLabelText(
            'デフォルトページサイズ (新規表示・再取得時の行数)'
          ) as HTMLInputElement
        ).value
      ).toBe('500');
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

    it('読込中に編集した値を遅れて返った backend 値で上書きしない', async () => {
      let resolveLoad: ((value: BackendAppSettings) => void) | undefined;
      vi.mocked(appSettingsProvider.getSettings).mockImplementation(
        () => new Promise((resolve) => (resolveLoad = resolve))
      );
      render(<SettingsDialog {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('クエリ履歴の最大保存件数'), {
        target: { value: '600' },
      });
      const loadResolver = resolveLoad;
      if (!loadResolver) throw new Error('getSettings resolver was not initialized');
      await act(async () => {
        loadResolver({
          ...BACKEND_SETTINGS,
          general: { ...BACKEND_SETTINGS.general, language: 'en' },
        });
      });

      expect((screen.getByLabelText('クエリ履歴の最大保存件数') as HTMLInputElement).value).toBe(
        '600'
      );
    });
  });

  describe('保存 (issue #389)', () => {
    it('キャンセル時は backend・localStorage・実行中画面へ反映しない', () => {
      const listener = vi.fn();
      window.addEventListener('settings-changed', listener);
      try {
        render(<SettingsDialog {...defaultProps} />);
        fireEvent.change(screen.getByLabelText('クエリ履歴の最大保存件数'), {
          target: { value: '600' },
        });
        fireEvent.click(screen.getByText('キャンセル'));

        expect(defaultProps.onClose).toHaveBeenCalledOnce();
        expect(appSettingsProvider.updateSettings).not.toHaveBeenCalled();
        expect(localStorage.getItem('app-settings')).toBeNull();
        expect(listener).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('settings-changed', listener);
      }
    });

    it('保存時に backend 対応の全項目を 1 回の updateSettings で送信する', async () => {
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('保存'));

      expect(appSettingsProvider.updateSettings).toHaveBeenCalledOnce();
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith({
        general: { autoConnect: false, confirmOnExit: true, maxQueryHistory: 1000, language: 'en' },
        editor: { fontSize: 14, fontFamily: 'Consolas', wordWrap: true, tabSize: 4 },
        grid: { defaultPageSize: 100000, showRowNumbers: true, nullDisplay: '(NULL)' },
        query: { timeoutSeconds: 300, autoCommit: true, maxRows: 10000 },
      });
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalled());
    });

    it('変更した一般/グリッド項目が payload に反映される', () => {
      render(<SettingsDialog {...defaultProps} />);

      fireEvent.change(screen.getByLabelText('クエリ履歴の最大保存件数'), {
        target: { value: '600' },
      });

      fireEvent.click(screen.getByText('グリッド'));
      fireEvent.change(screen.getByLabelText('NULLの表示文字列'), {
        target: { value: 'NULL' },
      });

      fireEvent.click(screen.getByText('保存'));
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          general: expect.objectContaining({ maxQueryHistory: 600 }),
          grid: expect.objectContaining({ nullDisplay: 'NULL' }),
        })
      );
    });

    it('保存成功時に localStorage へ frontend-only 項目含む全体を書き込み settings-changed を発火する', async () => {
      const listener = vi.fn();
      window.addEventListener('settings-changed', listener);
      try {
        render(<SettingsDialog {...defaultProps} />);
        fireEvent.click(screen.getByText('保存'));

        await waitFor(() => expect(listener).toHaveBeenCalledOnce());
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

    it('保存失敗時は閉じず、ローカル反映せず、再試行できる', async () => {
      const onClose = vi.fn();
      const listener = vi.fn();
      vi.mocked(appSettingsProvider.updateSettings)
        .mockRejectedValueOnce(new Error('disk full'))
        .mockResolvedValueOnce({ saved: true });
      window.addEventListener('settings-changed', listener);
      try {
        render(<SettingsDialog {...defaultProps} onClose={onClose} />);
        fireEvent.click(screen.getByText('保存'));

        expect(await screen.findByRole('alert')).toHaveTextContent('設定を保存できませんでした');
        expect(onClose).not.toHaveBeenCalled();
        expect(localStorage.getItem('app-settings')).toBeNull();
        expect(listener).not.toHaveBeenCalled();

        fireEvent.click(screen.getByText('保存'));
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
        expect(appSettingsProvider.updateSettings).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledOnce();
      } finally {
        window.removeEventListener('settings-changed', listener);
      }
    });

    it('保存中は二重送信を防ぐ', async () => {
      let resolveSave: ((value: { saved: boolean }) => void) | undefined;
      vi.mocked(appSettingsProvider.updateSettings).mockImplementation(
        () => new Promise((resolve) => (resolveSave = resolve))
      );
      render(<SettingsDialog {...defaultProps} />);

      fireEvent.click(screen.getByText('保存'));
      const savingButton = screen.getByText('保存中...');
      expect(savingButton).toBeDisabled();
      expect(screen.getByLabelText('クエリ履歴の最大保存件数')).toBeDisabled();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(defaultProps.onClose).not.toHaveBeenCalled();
      fireEvent.click(savingButton);
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledOnce();

      if (!resolveSave) throw new Error('updateSettings resolver was not initialized');
      resolveSave({ saved: true });
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalled());
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
        expect.objectContaining({
          query: { timeoutSeconds: 600, autoCommit: true, maxRows: 10000 },
        })
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
        expect.objectContaining({
          query: { timeoutSeconds: 3600, autoCommit: true, maxRows: 10000 },
        })
      );
    });
  });

  describe('WebView 起動設定 (issue #779)', () => {
    const labels = [
      'GPU 合成を許可する',
      '非アクティブ時のレンダラーの優先度低下を許可する',
      'HTTP キャッシュを有効にする',
      '起動時に開発者ツールを自動で開く',
    ];
    const enabled = {
      gpuCompositing: true,
      rendererBackgrounding: true,
      cacheEnabled: true,
      openDevToolsOnStartup: true,
    };

    async function openWebviewTab() {
      fireEvent.click(screen.getByText('WebView'));
      await waitFor(() =>
        expect(screen.getAllByText('今回の起動時に指定した設定: 無効')).toHaveLength(4)
      );
    }

    it('全項目を backend に保存し、今回の起動設定と明確に区別する', async () => {
      vi.mocked(appSettingsProvider.getSettings).mockResolvedValue(BACKEND_SETTINGS);
      render(<SettingsDialog {...defaultProps} />);
      await openWebviewTab();

      expect(screen.getByText(/変更は保存後、アプリを終了して次回起動/)).toBeInTheDocument();
      expect(screen.getByText(/自動では再起動しません/)).toBeInTheDocument();
      for (const label of labels) {
        expect(screen.getByLabelText(label)).not.toBeChecked();
        fireEvent.click(screen.getByLabelText(label));
      }
      expect(screen.getAllByText('今回の起動時に指定した設定: 無効')).toHaveLength(4);
      expect(screen.getByText(/保存しても、再起動するまで今回の設定/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('保存'));
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledOnce();
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ webview: enabled })
      );
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledOnce());
      const cached = JSON.parse(localStorage.getItem('app-settings') ?? '{}');
      expect(cached.webview).toEqual(enabled);
      expect(cached).not.toHaveProperty('webviewStartup');
      expect(screen.getAllByText('今回の起動時に指定した設定: 無効')).toHaveLength(4);
    });

    it('保存後に開き直すと保存値と変更前の起動スナップショットを表示する', async () => {
      vi.mocked(appSettingsProvider.getSettings)
        .mockResolvedValueOnce(BACKEND_SETTINGS)
        .mockResolvedValueOnce({
          ...BACKEND_SETTINGS,
          webview: enabled,
          webviewRestartRequired: true,
        });
      const { rerender } = render(<SettingsDialog {...defaultProps} />);
      await openWebviewTab();
      for (const label of labels) fireEvent.click(screen.getByLabelText(label));
      fireEvent.click(screen.getByText('保存'));
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledOnce());

      rerender(<SettingsDialog {...defaultProps} isOpen={false} />);
      rerender(<SettingsDialog {...defaultProps} />);
      expect(await screen.findByRole('status')).toHaveTextContent(
        '保存済みの WebView 設定は未適用'
      );
      for (const label of labels) expect(screen.getByLabelText(label)).toBeChecked();
      expect(screen.getAllByText('今回の起動時に指定した設定: 無効')).toHaveLength(4);
    });

    it('デフォルトに戻しても今回の起動スナップショットは変わらない', async () => {
      vi.mocked(appSettingsProvider.getSettings).mockResolvedValue({
        ...BACKEND_SETTINGS,
        webview: enabled,
        webviewStartup: enabled,
      });
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('WebView'));
      await waitFor(() =>
        expect(screen.getAllByText('今回の起動時に指定した設定: 有効')).toHaveLength(4)
      );

      fireEvent.click(screen.getByText('デフォルトに戻す'));
      for (const label of labels) expect(screen.getByLabelText(label)).not.toBeChecked();
      expect(screen.getAllByText('今回の起動時に指定した設定: 有効')).toHaveLength(4);
      fireEvent.click(screen.getByText('保存'));
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ webview: BACKEND_SETTINGS.webview })
      );
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledOnce());
    });

    it('保存失敗時は編集値とダイアログを維持し、キャッシュを更新しない', async () => {
      const initialCache = JSON.stringify({ version: 2, webview: BACKEND_SETTINGS.webview });
      localStorage.setItem('app-settings', initialCache);
      vi.mocked(appSettingsProvider.getSettings).mockResolvedValue(BACKEND_SETTINGS);
      vi.mocked(appSettingsProvider.updateSettings).mockRejectedValue(new Error('disk full'));
      render(<SettingsDialog {...defaultProps} />);
      await openWebviewTab();
      fireEvent.click(screen.getByLabelText(labels[0]));
      fireEvent.click(screen.getByText('保存'));

      expect(await screen.findByRole('alert')).toHaveTextContent('設定を保存できませんでした');
      expect(defaultProps.onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText(labels[0])).toBeChecked();
      expect(screen.getAllByText('今回の起動時に指定した設定: 無効')).toHaveLength(4);
      expect(localStorage.getItem('app-settings')).toBe(initialCache);
    });

    it('保存が未完了の間は WebView の編集と二重送信を防ぐ', async () => {
      let finish: ((value: { saved: boolean }) => void) | undefined;
      vi.mocked(appSettingsProvider.getSettings).mockResolvedValue(BACKEND_SETTINGS);
      vi.mocked(appSettingsProvider.updateSettings).mockImplementation(
        () => new Promise((resolve) => (finish = resolve))
      );
      render(<SettingsDialog {...defaultProps} />);
      await openWebviewTab();
      fireEvent.click(screen.getByLabelText(labels[0]));
      fireEvent.click(screen.getByText('保存'));
      for (const label of labels) expect(screen.getByLabelText(label)).toBeDisabled();
      expect(screen.getByText('デフォルトに戻す')).toBeDisabled();
      fireEvent.click(screen.getByText('保存中...'));
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledOnce();
      expect(defaultProps.onClose).not.toHaveBeenCalled();
      expect(localStorage.getItem('app-settings')).toBeNull();

      if (!finish) throw new Error('updateSettings resolver was not initialized');
      finish({ saved: true });
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledOnce());
    });

    it('backend 読込前に編集しても起動スナップショットだけは取得する', async () => {
      let finish: ((value: BackendAppSettings) => void) | undefined;
      vi.mocked(appSettingsProvider.getSettings).mockImplementation(
        () => new Promise((resolve) => (finish = resolve))
      );
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('WebView'));
      fireEvent.click(screen.getByLabelText(labels[0]));
      if (!finish) throw new Error('getSettings resolver was not initialized');
      await act(async () =>
        finish?.({
          ...BACKEND_SETTINGS,
          webview: { ...BACKEND_SETTINGS.webview, cacheEnabled: true },
          webviewRestartRequired: true,
        })
      );
      expect(screen.getByLabelText(labels[0])).toBeChecked();
      expect(screen.getByLabelText(labels[2])).toBeChecked();
      expect(screen.getAllByText('今回の起動時に指定した設定: 無効')).toHaveLength(4);
      fireEvent.click(screen.getByText('保存'));
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({ webview: { gpuCompositing: true } })
      );
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledOnce());
    });

    it('一般設定を先に編集しても遅れて取得した WebView 保存値を表示する', async () => {
      let finish: ((value: BackendAppSettings) => void) | undefined;
      vi.mocked(appSettingsProvider.getSettings).mockImplementation(
        () => new Promise((resolve) => (finish = resolve))
      );
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('クエリ履歴の最大保存件数'), {
        target: { value: '600' },
      });
      if (!finish) throw new Error('getSettings resolver was not initialized');
      await act(async () =>
        finish?.({ ...BACKEND_SETTINGS, webview: enabled, webviewRestartRequired: true })
      );
      fireEvent.click(screen.getByText('WebView'));
      for (const label of labels) expect(screen.getByLabelText(label)).toBeChecked();
      expect(screen.getAllByText('今回の起動時に指定した設定: 無効')).toHaveLength(4);
      fireEvent.click(screen.getByText('保存'));
      const payload = vi.mocked(appSettingsProvider.updateSettings).mock.calls[0]?.[0];
      expect(payload).not.toHaveProperty('webview');
      expect(payload?.general?.maxQueryHistory).toBe(600);
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledOnce());
    });

    it('backend 読込前の一般設定保存は未編集の WebView を上書きしない', async () => {
      let finish: ((value: BackendAppSettings) => void) | undefined;
      vi.mocked(appSettingsProvider.getSettings).mockImplementation(
        () => new Promise((resolve) => (finish = resolve))
      );
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.change(screen.getByLabelText('クエリ履歴の最大保存件数'), {
        target: { value: '600' },
      });
      fireEvent.click(screen.getByText('保存'));
      const payload = vi.mocked(appSettingsProvider.updateSettings).mock.calls[0]?.[0];
      expect(payload).not.toHaveProperty('webview');
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledOnce());
      if (!finish) throw new Error('getSettings resolver was not initialized');
      await act(async () =>
        finish?.({ ...BACKEND_SETTINGS, webview: enabled, webviewRestartRequired: true })
      );
      expect(appSettingsProvider.updateSettings).toHaveBeenCalledOnce();
    });

    it('backend 読込失敗時はキャッシュを今回の起動設定として表示しない', async () => {
      localStorage.setItem('app-settings', JSON.stringify({ version: 2, webview: enabled }));
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('WebView'));
      await waitFor(() =>
        expect(screen.getAllByText('今回の起動時に指定した設定: 確認できません')).toHaveLength(4)
      );
      for (const label of labels) expect(screen.getByLabelText(label)).toBeChecked();
    });
  });
});

it('shows unsupported settings as disabled instead of pretending to apply them', async () => {
  render(<SettingsDialog isOpen onClose={() => {}} />);
  expect(screen.getByLabelText('起動時に前回の保存済み接続を復元')).toBeEnabled();
  expect(screen.getByLabelText('終了時に確認する (未対応)')).toBeDisabled();
  expect(screen.getByLabelText('言語 (切替未対応)')).toBeDisabled();
  fireEvent.click(screen.getByText('クエリ'));
  expect(screen.getByLabelText('自動コミット (OFF時は接続ごとにCommit/Rollback)')).toBeEnabled();
  expect(screen.getByLabelText('任意SQLの最大表示行数 (各結果セット)')).toBeEnabled();
  fireEvent.click(screen.getByText('外観'));
  expect(screen.getByLabelText('テーマ (切替未対応)')).toBeDisabled();
});
