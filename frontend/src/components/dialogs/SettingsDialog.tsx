import { useCallback, useEffect, useState } from 'react';
import { appSettingsProvider } from '../../api/providers';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import { DialogOverlay } from '../common/DialogOverlay';
import styles from './SettingsDialog.module.css';
import {
  type AppSettings,
  defaultSettings,
  QUERY_TIMEOUT_DEFAULT_SEC,
  QUERY_TIMEOUT_MAX_SEC,
  QUERY_TIMEOUT_MIN_SEC,
} from './settingsUtils';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

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
  const [activeTab, setActiveTab] = useState<'editor' | 'query' | 'appearance' | 'shortcuts'>(
    'editor'
  );

  // Load settings from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('app-settings');
    if (saved) {
      try {
        setSettings({ ...defaultSettings, ...JSON.parse(saved) });
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    }
  }, []);

  const handleSave = useCallback(() => {
    localStorage.setItem('app-settings', JSON.stringify(settings));
    // Sync query timeout to Backend
    appSettingsProvider
      .updateSettings({
        query: { timeoutSeconds: Math.round(settings.query.timeout / 1000) },
      })
      .catch((err) => {
        console.error('Failed to sync query timeout to backend:', err);
      });
    onClose();
    // Trigger reload to apply settings
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: settings }));
  }, [settings, onClose]);

  const handleReset = useCallback(() => {
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
          {'\u2715'}
        </button>
      </div>

      <div className={styles.content}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'editor' ? styles.active : ''}`}
            onClick={() => setActiveTab('editor')}
          >
            エディタ
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'query' ? styles.active : ''}`}
            onClick={() => setActiveTab('query')}
          >
            クエリ
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'appearance' ? styles.active : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            外観
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === 'shortcuts' ? styles.active : ''}`}
            onClick={() => setActiveTab('shortcuts')}
          >
            ショートカット
          </button>
        </div>

        <div className={styles.tabContent}>
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
        <button type="button" onClick={handleReset} className={styles.resetButton}>
          デフォルトに戻す
        </button>
        <div className={styles.actions}>
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button type="button" onClick={handleSave} className={styles.saveButton}>
            保存
          </button>
        </div>
      </div>
    </DialogOverlay>
  );
}
