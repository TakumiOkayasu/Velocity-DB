import { useCallback, useEffect, useState } from 'react';
import { appSettingsProvider } from '../../api/providers';
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
  SETTINGS_CHANGED_EVENT,
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
  { id: 'appearance', label: '外観' },
  { id: 'shortcuts', label: 'ショートカット' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// ショートカット表示。値は実キーハンドラ実装 (MainLayout.tsx) と同期させる
const SHORTCUT_DISPLAY: ReadonlyArray<{ label: string; keys: string }> = [
  { label: 'クエリを実行', keys: 'F9' },
  { label: '新規クエリ', keys: 'Ctrl+N' },
  { label: 'SQLフォーマット', keys: 'Ctrl+Shift+F' },
  { label: '検索', keys: 'Ctrl+Shift+P' },
];

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  useDialogKeyboard({ isOpen, onEscape: onClose });
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [activeTab, setActiveTab] = useState<TabId>('general');

  // 開いたタイミングで localStorage キャッシュ → backend 永続値 (settings.json) の順に読込。
  // IPC 不通時 (browser/dev 等) は localStorage / defaults のまま表示する
  useEffect(() => {
    if (!isOpen) return;
    setSettings(getSettings());
    let cancelled = false;
    appSettingsProvider
      .getSettings()
      .then((backend) => {
        if (cancelled) return;
        setSettings((prev) => ({
          ...prev,
          general: {
            autoConnect: backend.general.autoConnect,
            confirmOnExit: backend.general.confirmOnExit,
            maxQueryHistory: backend.general.maxQueryHistory,
            language: backend.general.language,
          },
          editor: {
            ...prev.editor,
            fontSize: backend.editor.fontSize,
            fontFamily: backend.editor.fontFamily,
            tabSize: backend.editor.tabSize,
            wordWrap: backend.editor.wordWrap,
          },
          grid: {
            defaultPageSize: backend.grid.defaultPageSize,
            showRowNumbers: backend.grid.showRowNumbers,
            nullDisplay: backend.grid.nullDisplay,
          },
          query: {
            ...prev.query,
            timeout: backend.query.timeoutSeconds * 1000,
          },
        }));
      })
      .catch((err) => {
        console.error('Failed to load settings from backend:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const saveSettings = useCallback(() => {
    localStorage.setItem('app-settings', JSON.stringify(settings));
    // Backend 対応項目 (general/editor/grid/query) を 1 回の updateSettings で永続化
    appSettingsProvider
      .updateSettings({
        general: {
          autoConnect: settings.general.autoConnect,
          confirmOnExit: settings.general.confirmOnExit,
          maxQueryHistory: settings.general.maxQueryHistory,
          language: settings.general.language,
        },
        editor: {
          fontSize: settings.editor.fontSize,
          fontFamily: settings.editor.fontFamily,
          wordWrap: settings.editor.wordWrap,
          tabSize: settings.editor.tabSize,
        },
        grid: {
          defaultPageSize: settings.grid.defaultPageSize,
          showRowNumbers: settings.grid.showRowNumbers,
          nullDisplay: settings.grid.nullDisplay,
        },
        query: { timeoutSeconds: Math.round(settings.query.timeout / 1000) },
      })
      .catch((err) => {
        console.error('Failed to sync settings to backend:', err);
      });
    onClose();
    // 購読側 (useEditorSettings 等) へ反映を通知
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, { detail: settings }));
  }, [settings, onClose]);

  const resetSettings = useCallback(() => {
    setSettings(defaultSettings);
  }, []);

  // version (primitive) は updateSetting 対象外。スプレッド不可のため型から除外。
  const updateSetting = useCallback(
    <K extends Exclude<keyof AppSettings, 'version'>>(
      category: K,
      key: keyof AppSettings[K],
      value: AppSettings[K][keyof AppSettings[K]]
    ) => {
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

  return (
    <DialogOverlay
      onClose={onClose}
      overlayClassName={styles.overlay}
      dialogClassName={styles.dialog}
    >
      <div className={styles.header}>
        <h2>設定</h2>
        <button type="button" className={styles.closeButton} onClick={onClose}>
          {'✕'}
        </button>
      </div>

      <div className={styles.content}>
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
          {activeTab === 'general' && (
            <div className={styles.settingsGroup}>
              <div className={styles.setting}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.general.autoConnect}
                    onChange={(e) => updateSetting('general', 'autoConnect', e.target.checked)}
                  />
                  起動時に前回の接続を復元
                </label>
              </div>
              <div className={styles.setting}>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.general.confirmOnExit}
                    onChange={(e) => updateSetting('general', 'confirmOnExit', e.target.checked)}
                  />
                  終了時に確認する
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
                <label htmlFor="setting-general-language">言語</label>
                <select
                  id="setting-general-language"
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
                  自動コミット
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
                <label htmlFor="setting-query-max-rows">最大行数</label>
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
                <label htmlFor="setting-grid-page-size">デフォルトページサイズ (行)</label>
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

          {activeTab === 'appearance' && (
            <div className={styles.settingsGroup}>
              <div className={styles.setting}>
                <label htmlFor="setting-appearance-theme">テーマ</label>
                <select
                  id="setting-appearance-theme"
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
      </div>

      <div className={styles.footer}>
        <button type="button" onClick={resetSettings} className={styles.resetButton}>
          デフォルトに戻す
        </button>
        <div className={styles.actions}>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" onClick={saveSettings} className={styles.saveButton}>
            保存
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
