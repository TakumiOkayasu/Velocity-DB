// Settings utility functions - separated from component for Fast Refresh compatibility

// Query timeout bounds (seconds). Keep in sync with backend kQueryTimeoutMin/Max/DefaultSec
// in settings_manager.h. Frontend stores ms internally for backward compat with saved localStorage.
export const QUERY_TIMEOUT_MIN_SEC = 1;
export const QUERY_TIMEOUT_MAX_SEC = 3600;
export const QUERY_TIMEOUT_DEFAULT_SEC = 300;

export interface AppSettings {
  editor: {
    fontSize: number;
    tabSize: number;
    wordWrap: boolean;
    minimap: boolean;
  };
  query: {
    autoCommit: boolean;
    timeout: number;
    maxRows: number;
  };
  appearance: {
    theme: 'dark' | 'light';
  };
  shortcuts: {
    execute: string;
    newQuery: string;
    format: string;
    search: string;
  };
}

export const defaultSettings: AppSettings = {
  editor: {
    fontSize: 14,
    tabSize: 4,
    wordWrap: true,
    minimap: false,
  },
  query: {
    autoCommit: true,
    timeout: QUERY_TIMEOUT_DEFAULT_SEC * 1000,
    maxRows: 10000,
  },
  appearance: {
    theme: 'dark',
  },
  shortcuts: {
    execute: 'F9',
    newQuery: 'Ctrl+N',
    format: 'Ctrl+Shift+F',
    search: 'Ctrl+Shift+P',
  },
};

export function getSettings(): AppSettings {
  const saved = localStorage.getItem('app-settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return {
        ...defaultSettings,
        ...parsed,
        editor: { ...defaultSettings.editor, ...parsed.editor },
        query: { ...defaultSettings.query, ...parsed.query },
        appearance: { ...defaultSettings.appearance, ...parsed.appearance },
        shortcuts: { ...defaultSettings.shortcuts, ...parsed.shortcuts },
      };
    } catch {
      return defaultSettings;
    }
  }
  return defaultSettings;
}
