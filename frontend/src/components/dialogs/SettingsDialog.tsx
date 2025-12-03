import { useCallback, useEffect, useState } from 'react';
import styles from './SettingsDialog.module.css';
import { type AppSettings, defaultSettings } from './settingsUtils';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
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
    onClose();
    // Trigger reload to apply settings
    window.dispatchEvent(new CustomEvent('settings-changed', { detail: settings }));
  }, [settings, onClose]);

  const handleReset = useCallback(() => {
    setSettings(defaultSettings);
  }, []);

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(
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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Settings</h2>
          <button className={styles.closeButton} onClick={onClose}>
            {'\u2715'}
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${activeTab === 'editor' ? styles.active : ''}`}
              onClick={() => setActiveTab('editor')}
            >
              Editor
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'query' ? styles.active : ''}`}
              onClick={() => setActiveTab('query')}
            >
              Query
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'appearance' ? styles.active : ''}`}
              onClick={() => setActiveTab('appearance')}
            >
              Appearance
            </button>
            <button
              className={`${styles.tab} ${activeTab === 'shortcuts' ? styles.active : ''}`}
              onClick={() => setActiveTab('shortcuts')}
            >
              Shortcuts
            </button>
          </div>

          <div className={styles.tabContent}>
            {activeTab === 'editor' && (
              <div className={styles.settingsGroup}>
                <div className={styles.setting}>
                  <label>Font Size</label>
                  <input
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
                  <label>Tab Size</label>
                  <select
                    value={settings.editor.tabSize}
                    onChange={(e) =>
                      updateSetting('editor', 'tabSize', Number.parseInt(e.target.value, 10))
                    }
                  >
                    <option value={2}>2 spaces</option>
                    <option value={4}>4 spaces</option>
                    <option value={8}>8 spaces</option>
                  </select>
                </div>
                <div className={styles.setting}>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.editor.wordWrap}
                      onChange={(e) => updateSetting('editor', 'wordWrap', e.target.checked)}
                    />
                    Word Wrap
                  </label>
                </div>
                <div className={styles.setting}>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.editor.minimap}
                      onChange={(e) => updateSetting('editor', 'minimap', e.target.checked)}
                    />
                    Show Minimap
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
                    Auto Commit
                  </label>
                </div>
                <div className={styles.setting}>
                  <label>Query Timeout (ms)</label>
                  <input
                    type="number"
                    value={settings.query.timeout}
                    onChange={(e) =>
                      updateSetting(
                        'query',
                        'timeout',
                        Number.parseInt(e.target.value, 10) || 30000
                      )
                    }
                    min={1000}
                    max={600000}
                    step={1000}
                  />
                </div>
                <div className={styles.setting}>
                  <label>Max Rows</label>
                  <input
                    type="number"
                    value={settings.query.maxRows}
                    onChange={(e) =>
                      updateSetting(
                        'query',
                        'maxRows',
                        Number.parseInt(e.target.value, 10) || 10000
                      )
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
                  <label>Theme</label>
                  <select
                    value={settings.appearance.theme}
                    onChange={(e) =>
                      updateSetting('appearance', 'theme', e.target.value as 'dark' | 'light')
                    }
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light (Coming Soon)</option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className={styles.settingsGroup}>
                <div className={styles.setting}>
                  <label>Execute Query</label>
                  <input type="text" value={settings.shortcuts.execute} readOnly />
                </div>
                <div className={styles.setting}>
                  <label>New Query</label>
                  <input type="text" value={settings.shortcuts.newQuery} readOnly />
                </div>
                <div className={styles.setting}>
                  <label>Format SQL</label>
                  <input type="text" value={settings.shortcuts.format} readOnly />
                </div>
                <div className={styles.setting}>
                  <label>Search</label>
                  <input type="text" value={settings.shortcuts.search} readOnly />
                </div>
                <p className={styles.shortcutNote}>
                  Keyboard shortcuts cannot be customized in this version.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button onClick={handleReset} className={styles.resetButton}>
            Reset to Defaults
          </button>
          <div className={styles.actions}>
            <button onClick={onClose}>Cancel</button>
            <button onClick={handleSave} className={styles.saveButton}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
