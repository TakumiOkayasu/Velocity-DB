// Settings utility functions - separated from component for Fast Refresh compatibility

// Query timeout bounds (seconds). Keep in sync with backend kQueryTimeoutMin/Max/DefaultSec
// in settings_manager.h. Frontend stores ms internally for backward compat with saved localStorage.
export const QUERY_TIMEOUT_MIN_SEC = 1;
export const QUERY_TIMEOUT_MAX_SEC = 3600;
export const QUERY_TIMEOUT_DEFAULT_SEC = 300;

// 破壊的変更時にインクリメントし migrate() にケース追加
const SETTINGS_VERSION = 1;

export interface AppSettings {
  version: number;
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
  version: SETTINGS_VERSION,
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

// 各サブオブジェクトを型検証し、フィールド単位で defaults fallback
// (zod 4 の dynamic import が vitest 環境で解決困難なため手書き validator)
function pickTyped<T extends object>(source: unknown, template: T): Partial<T> {
  if (typeof source !== 'object' || source === null) return {};
  const src = source as Record<string, unknown>;
  const out: Partial<T> = {};
  for (const key of Object.keys(template) as (keyof T)[]) {
    const v = src[key as string];
    const expected = typeof template[key];
    if (typeof v === expected) (out as Record<string, unknown>)[key as string] = v;
  }
  return out;
}

// 旧形式 (version 欠落 or 古いバージョン) を現行形式へ正規化
function migrate(parsed: unknown): AppSettings {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return defaultSettings;
  }
  const obj = parsed as Record<string, unknown>;
  return {
    version: SETTINGS_VERSION,
    editor: { ...defaultSettings.editor, ...pickTyped(obj.editor, defaultSettings.editor) },
    query: { ...defaultSettings.query, ...pickTyped(obj.query, defaultSettings.query) },
    appearance: {
      ...defaultSettings.appearance,
      ...pickTyped(obj.appearance, defaultSettings.appearance),
    },
    shortcuts: {
      ...defaultSettings.shortcuts,
      ...pickTyped(obj.shortcuts, defaultSettings.shortcuts),
    },
  };
}

export function getSettings(): AppSettings {
  const saved = localStorage.getItem('app-settings');
  if (!saved) return defaultSettings;
  try {
    return migrate(JSON.parse(saved));
  } catch {
    return defaultSettings;
  }
}
