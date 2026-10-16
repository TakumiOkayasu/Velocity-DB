import { useCallback, useEffect, useRef, useState } from 'react';
import { appSettingsProvider } from '../../api/providers';
import { cacheSettings, mergeBackendSettings } from '../../utils/settingsCache';
import { normalizeSettings } from '../../utils/settingsUtils';
import type { WebViewSettings } from '../../types/webview';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { DialogOverlay } from '../common/DialogOverlay';
import styles from './SettingsDialog.module.css';
import {
  type AppSettings,
  defaultSettings,
  getSettings,
  MAX_QUERY_HISTORY_MAX,
  MAX_QUERY_HISTORY_MIN,
  PAGE_SIZE_MAX,
  PAGE_SIZE_MIN,
  QUERY_TIMEOUT_DEFAULT_SEC,
  QUERY_TIMEOUT_MAX_SEC,
  QUERY_TIMEOUT_MIN_SEC,
} from './settingsUtils';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const TABS = [
  { id: 'general', label: '一般' },
  { id: 'editor', label: 'エディタ' },
  { id: 'query', label: 'クエリ' },
  { id: 'grid', label: 'グリッド' },
  { id: 'webview', label: 'WebView' },
  { id: 'appearance', label: '外観' },
  { id: 'shortcuts', label: 'ショートカット' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const WEBVIEW_OPTIONS = [
  {
    key: 'gpuCompositing',
    label: 'GPU 合成を許可する',
    description:
      'GPU 合成の禁止指定を外し、WebView2 の既定動作に任せます。GPU の利用を保証する設定ではなく、ハードウェアアクセラレーション全体を切り替える設定でもありません。',
  },
  {
    key: 'rendererBackgrounding',
    label: '非アクティブ時のレンダラーの優先度低下を許可する',
    description:
      'OFF ではバックグラウンドでもレンダラープロセスの優先度を下げません。ページを一時停止する設定ではありません。',
  },
  {
    key: 'cacheEnabled',
    label: 'HTTP キャッシュを有効にする',
    description:
      'WebView2 の HTTP キャッシュを使用します。既存のキャッシュを削除する操作ではありません。',
  },
  {
    key: 'openDevToolsOnStartup',
    label: '起動時に開発者ツールを自動で開く',
    description: '次回のアプリ起動時に WebView2 の開発者ツールを開きます。',
  },
] as const satisfies ReadonlyArray<{
  key: keyof WebViewSettings;
  label: string;
  description: string;
}>;

// ショートカット表示。値は実キーハンドラ実装 (MainLayout.tsx) と同期させる
const SHORTCUT_DISPLAY: ReadonlyArray<{ label: string; keys: string }> = [
  { label: 'クエリを実行', keys: 'F9' },
  { label: '新規クエリ', keys: 'Ctrl+N' },
  { label: 'SQLフォーマット', keys: 'Ctrl+Shift+F' },
  { label: '検索', keys: 'Ctrl+Shift+P' },
];

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [webviewStartup, setWebviewStartup] = useState<WebViewSettings | null>(null);
  const [webviewRestartRequired, setWebviewRestartRequired] = useState(false);
  const [isLoadingStartup, setIsLoadingStartup] = useState(true);
  const isSavingRef = useRef(false);
  const isDirtyRef = useRef(false);
  const dirtyWebviewFieldsRef = useRef(new Set<keyof WebViewSettings>());
  const lifecycleRef = useRef(0);
  const closeDialog = useCallback(() => {
    if (!isSavingRef.current) onClose();
  }, [onClose]);
  useDialogKeyboard({ isOpen, onEscape: closeDialog });

  // 開いたタイミングで localStorage キャッシュ → backend 永続値 (settings.json) の順に読込。
  // IPC 不通時 (browser/dev 等) は localStorage / defaults のまま表示する
  useEffect(() => {
    if (!isOpen) return;
    const lifecycle = ++lifecycleRef.current;
    isDirtyRef.current = false;
    dirtyWebviewFieldsRef.current.clear();
    isSavingRef.current = false;
    setIsSaving(false);
    setSaveError(null);
    setWebviewStartup(null);
    setWebviewRestartRequired(false);
    setIsLoadingStartup(true);
    setSettings(getSettings());
    let cancelled = false;
    appSettingsProvider
      .getSettings()
      .then((backend) => {
        if (cancelled || lifecycleRef.current !== lifecycle) return;
        setWebviewStartup(backend.webviewStartup);
        setWebviewRestartRequired(backend.webviewRestartRequired);
        setIsLoadingStartup(false);
        setSettings((prev) => {
          const merged = mergeBackendSettings(prev, backend);
          for (const key of dirtyWebviewFieldsRef.current) {
            merged.webview[key] = prev.webview[key];
          }
          // Other edits must not prevent untouched native startup options from hydrating.
          return isDirtyRef.current ? { ...prev, webview: merged.webview } : merged;
        });
      })
      .catch((err) => {
        if (cancelled || lifecycleRef.current !== lifecycle) return;
        setIsLoadingStartup(false);
        console.error('Failed to load settings from backend:', err);
      });
    return () => {
      cancelled = true;
      ++lifecycleRef.current;
    };
  }, [isOpen]);

  const saveSettings = useCallback(async () => {
    if (isSavingRef.current) return;
    const lifecycle = lifecycleRef.current;
    isSavingRef.current = true;
    // A late initial read must not replace the settings being saved.
    isDirtyRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    const saved = normalizeSettings(settings);
    const webview: Partial<WebViewSettings> = {};
    for (const key of dirtyWebviewFieldsRef.current) webview[key] = saved.webview[key];
    // WebView 設定も backend に保存するが、起動時スナップショットは変更しない。
    try {
      const result = await appSettingsProvider.updateSettings({
        // Never overwrite native options from a stale cache during an unrelated save.
        ...(dirtyWebviewFieldsRef.current.size > 0 ? { webview } : {}),
        general: {
          autoConnect: saved.general.autoConnect,
          confirmOnExit: saved.general.confirmOnExit,
          maxQueryHistory: saved.general.maxQueryHistory,
          language: saved.general.language,
        },
        editor: {
          fontSize: saved.editor.fontSize,
          fontFamily: saved.editor.fontFamily,
          wordWrap: saved.editor.wordWrap,
          tabSize: saved.editor.tabSize,
        },
        grid: {
          defaultPageSize: saved.grid.defaultPageSize,
          showRowNumbers: saved.grid.showRowNumbers,
          nullDisplay: saved.grid.nullDisplay,
        },
        query: {
          timeoutSeconds: Math.round(saved.query.timeout / 1000),
          autoCommit: saved.query.autoCommit,
          maxRows: saved.query.maxRows,
        },
      });
      if (!result.saved) throw new Error('Backend did not save settings');
      if (lifecycleRef.current !== lifecycle) return;
      cacheSettings(saved);
      isSavingRef.current = false;
      setIsSaving(false);
      onClose();
    } catch (err) {
      if (lifecycleRef.current !== lifecycle) return;
      console.error('Failed to sync settings to backend:', err);
      setSaveError('設定を保存できませんでした。もう一度お試しください。');
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [settings, onClose]);

  const resetSettings = useCallback(() => {
    isDirtyRef.current = true;
    dirtyWebviewFieldsRef.current = new Set(WEBVIEW_OPTIONS.map(({ key }) => key));
    setSettings(defaultSettings);
  }, []);

  // version (primitive) は updateSetting 対象外。スプレッド不可のため型から除外。
  const updateSetting = useCallback(
    <K extends Exclude<keyof AppSettings, 'version'>, F extends keyof AppSettings[K]>(
      category: K,
      key: F,
      value: AppSettings[K][F]
    ) => {
      isDirtyRef.current = true;
      setSettings((prev) => ({
        ...prev,
        [category]: {
          ...prev[category],
          [key]: value,
        },
      }));
    },
    []
  );

  if (!isOpen) return null;

  const webviewDiffersFromStartup =
    webviewStartup !== null &&
    WEBVIEW_OPTIONS.some(({ key }) => settings.webview[key] !== webviewStartup[key]);

  return (
    <DialogOverlay
      onClose={closeDialog}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
    >
      <div className={styles.header}>
        <h2>設定</h2>
        <button
          type="button"
          className={styles.closeButton}
          onClick={closeDialog}
          disabled={isSaving}
        >
          {'✕'}
        </button>
      </div>

      <fieldset className={styles.content} disabled={isSaving} aria-busy={isSaving}>
        <div className={styles.tabs}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`${styles.tab} ${activeTab === id ? styles.active : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.tabContent}>
          <p className={styles.shortcutNote}>未対応の項目は変更できません。</p>
          {activeTab === 'general' && (
            <div className={styles.settingsGroup}>
              <div className={styles.setting}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.general.autoConnect}
                    onChange={(e) => updateSetting('general', 'autoConnect', e.target.checked)}
                  />
                  起動時に前回の保存済み接続を復元
                </label>
              </div>
              <div className={styles.setting}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.general.confirmOnExit}
                    disabled
                    onChange={(e) => updateSetting('general', 'confirmOnExit', e.target.checked)}
                  />
                  終了時に確認する (未対応)
                </label>
              </div>
              <div className={styles.setting}>
                <label htmlFor="setting-general-max-query-history">クエリ履歴の最大保存件数</label>
                <input
                  id="setting-general-max-query-history"
                  type="number"
                  value={settings.general.maxQueryHistory}
                  onChange={(e) =>
                    updateSetting(
                      'general',
                      'maxQueryHistory',
                      Number.parseInt(e.target.value, 10) || defaultSettings.general.maxQueryHistory
                    )
                  }
                  min={MAX_QUERY_HISTORY_MIN}
                  max={MAX_QUERY_HISTORY_MAX}
                  step={100}
                />
              </div>
              <div className={styles.setting}>
                <label htmlFor="setting-general-language">言語 (切替未対応)</label>
                <select
                  id="setting-general-language"
                  disabled
                  value={settings.general.language}
                  onChange={(e) => updateSetting('general', 'language', e.target.value)}
                >
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'editor' && (
            <div className={styles.settingsGroup}>
              <div className={styles.setting}>
                <label htmlFor="setting-editor-font-size">フォントサイズ</label>
                <input
                  id="setting-editor-font-size"
                  type="number"
                  value={settings.editor.fontSize}
                  onChange={(e) =>
                    updateSetting('editor', 'fontSize', Number.parseInt(e.target.value, 10) || 14)
                  }
                  min={8}
                  max={32}
                />
              </div>
              <div className={styles.setting}>
                <label htmlFor="setting-editor-font-family">フォント</label>
                <input
                  id="setting-editor-font-family"
                  type="text"
                  value={settings.editor.fontFamily}
                  onChange={(e) => updateSetting('editor', 'fontFamily', e.target.value)}
                  placeholder={defaultSettings.editor.fontFamily}
                />
              </div>
              <div className={styles.setting}>
                <label htmlFor="setting-editor-tab-size">タブサイズ</label>
                <select
                  id="setting-editor-tab-size"
                  value={settings.editor.tabSize}
                  onChange={(e) =>
                    updateSetting('editor', 'tabSize', Number.parseInt(e.target.value, 10))
                  }
                >
                  <option value={2}>2スペース</option>
                  <option value={4}>4スペース</option>
                  <option value={8}>8スペース</option>
                </select>
              </div>
              <div className={styles.setting}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.editor.wordWrap}
                    onChange={(e) => updateSetting('editor', 'wordWrap', e.target.checked)}
                  />
                  折り返し
                </label>
              </div>
              <div className={styles.setting}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.editor.minimap}
                    onChange={(e) => updateSetting('editor', 'minimap', e.target.checked)}
                  />
                  ミニマップを表示
                </label>
              </div>
            </div>
          )}

          {activeTab === 'query' && (
            <div className={styles.settingsGroup}>
              <div className={styles.setting}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.query.autoCommit}
                    onChange={(e) => updateSetting('query', 'autoCommit', e.target.checked)}
                  />
                  自動コミット (OFF時は接続ごとにCommit/Rollback)
                </label>
              </div>
              <div className={styles.setting}>
                <label htmlFor="setting-query-timeout-sec">クエリタイムアウト (秒)</label>
                <input
                  id="setting-query-timeout-sec"
                  type="number"
                  value={Math.round(settings.query.timeout / 1000)}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    const sec = Number.isFinite(parsed) ? parsed : QUERY_TIMEOUT_DEFAULT_SEC;
                    updateSetting('query', 'timeout', sec * 1000);
                  }}
                  min={QUERY_TIMEOUT_MIN_SEC}
                  max={QUERY_TIMEOUT_MAX_SEC}
                  step={60}
                />
              </div>
              <div className={styles.setting}>
                <label
                  htmlFor="setting-query-max-rows"
                  title="結果表示の上限です。SQLの検索範囲や更新件数は制限しません。"
                >
                  任意SQLの最大表示行数 (各結果セット)
                </label>
                <input
                  id="setting-query-max-rows"
                  type="number"
                  value={settings.query.maxRows}
                  onChange={(e) =>
                    updateSetting('query', 'maxRows', Number.parseInt(e.target.value, 10) || 10000)
                  }
                  min={100}
                  max={1000000}
                  step={1000}
                />
              </div>
            </div>
          )}

          {activeTab === 'grid' && (
            <div className={styles.settingsGroup}>
              <div className={styles.setting}>
                <label htmlFor="setting-grid-page-size">
                  デフォルトページサイズ (新規表示・再取得時の行数)
                </label>
                <input
                  id="setting-grid-page-size"
                  type="number"
                  value={settings.grid.defaultPageSize}
                  onChange={(e) =>
                    updateSetting(
                      'grid',
                      'defaultPageSize',
                      Number.parseInt(e.target.value, 10) || defaultSettings.grid.defaultPageSize
                    )
                  }
                  min={PAGE_SIZE_MIN}
                  max={PAGE_SIZE_MAX}
                  step={100}
                />
              </div>
              <div className={styles.setting}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.grid.showRowNumbers}
                    onChange={(e) => updateSetting('grid', 'showRowNumbers', e.target.checked)}
                  />
                  行番号を表示
                </label>
              </div>
              <div className={styles.setting}>
                <label htmlFor="setting-grid-null-display">NULLの表示文字列</label>
                <input
                  id="setting-grid-null-display"
                  type="text"
                  value={settings.grid.nullDisplay}
                  onChange={(e) => updateSetting('grid', 'nullDisplay', e.target.value)}
                  placeholder={defaultSettings.grid.nullDisplay}
                />
              </div>
            </div>
          )}

          {activeTab === 'webview' && (
            <div className={styles.settingsGroup}>
              <p className={styles.settingDescription}>
                WebView2 の起動設定です。チェック状態は保存する設定を表します。
                変更は保存後、アプリを終了して次回起動したときに適用されます。自動では再起動しません。
              </p>
              {webviewRestartRequired && (
                <output className={styles.restartNotice}>
                  保存済みの WebView 設定は未適用です。反映するにはアプリを再起動してください。
                </output>
              )}
              {webviewDiffersFromStartup && (
                <p className={styles.restartNotice}>
                  今回の起動設定と異なります。保存しても、再起動するまで今回の設定で動作します。
                </p>
              )}
              {WEBVIEW_OPTIONS.map(({ key, label, description }) => (
                <div key={key} className={styles.setting}>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.webview[key]}
                      aria-describedby={`setting-webview-${key}-description setting-webview-${key}-startup`}
                      onChange={(e) => {
                        dirtyWebviewFieldsRef.current.add(key);
                        updateSetting('webview', key, e.target.checked);
                      }}
                    />
                    {label}
                  </label>
                  <p
                    id={`setting-webview-${key}-description`}
                    className={styles.settingDescription}
                  >
                    {description}
                  </p>
                  <p id={`setting-webview-${key}-startup`} className={styles.startupValue}>
                    今回の起動時に指定した設定:{' '}
                    {webviewStartup
                      ? webviewStartup[key]
                        ? '有効'
                        : '無効'
                      : isLoadingStartup
                        ? '取得中…'
                        : '確認できません'}
                  </p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className={styles.settingsGroup}>
              <div className={styles.setting}>
                <label htmlFor="setting-appearance-theme">テーマ (切替未対応)</label>
                <select
                  id="setting-appearance-theme"
                  disabled
                  value={settings.appearance.theme}
                  onChange={(e) =>
                    updateSetting('appearance', 'theme', e.target.value as 'dark' | 'light')
                  }
                >
                  <option value="dark">ダーク</option>
                  <option value="light">ライト（準備中）</option>
                </select>
              </div>
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className={styles.settingsGroup}>
              {SHORTCUT_DISPLAY.map(({ label, keys }) => {
                const inputId = `setting-shortcut-${label}`;
                return (
                  <div key={label} className={styles.setting}>
                    <label htmlFor={inputId}>{label}</label>
                    <input id={inputId} type="text" value={keys} readOnly />
                  </div>
                );
              })}
              <p className={styles.shortcutNote}>
                このバージョンではキーボードショートカットのカスタマイズはできません。
              </p>
            </div>
          )}
        </div>
      </fieldset>

      <div className={styles.footer}>
        {saveError && <div role="alert">{saveError}</div>}
        <button
          type="button"
          onClick={resetSettings}
          className={styles.resetButton}
          disabled={isSaving}
        >
          デフォルトに戻す
        </button>
        <div className={styles.actions}>
          <button type="button" onClick={closeDialog} disabled={isSaving}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={saveSettings}
            className={styles.saveButton}
            disabled={isSaving}
          >
            {isSaving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
