// Settings utility functions - separated from component for Fast Refresh compatibility

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
    timeout: 30000,
    maxRows: 10000,
  },
  appearance: {
    theme: 'dark',
  },
  shortcuts: {
    execute: 'Ctrl+Enter',
    newQuery: 'Ctrl+N',
    format: 'Ctrl+Shift+F',
    search: 'Ctrl+Shift+P',
  },
};

export function getSettings(): AppSettings {
  const saved = localStorage.getItem('app-settings');
  if (saved) {
    try {
      return { ...defaultSettings, ...JSON.parse(saved) };
    } catch {
      return defaultSettings;
    }
  }
  return defaultSettings;
}
