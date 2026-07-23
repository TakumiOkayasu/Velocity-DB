// Settings utility functions - separated from component for Fast Refresh compatibility

// Query timeout bounds (seconds). Keep in sync with backend kQueryTimeoutMin/Max/DefaultSec
// in settings_manager.h. Frontend stores ms internally for backward compat with saved localStorage.
export const QUERY_TIMEOUT_MIN_SEC = 1;
export const QUERY_TIMEOUT_MAX_SEC = 3600;
export const QUERY_TIMEOUT_DEFAULT_SEC = 300;

// 一般/グリッド設定の入力バウンド (UI 入力制限。backend 側は maxQueryHistory>=1 のみクランプ)
export const MAX_QUERY_HISTORY_MIN = 10;
export const MAX_QUERY_HISTORY_MAX = 10000;
export const PAGE_SIZE_MIN = 10;
export const PAGE_SIZE_MAX = 1000000;

// 設定保存時に SettingsDialog が dispatch し、useEditorSettings 等が購読する CustomEvent 名
export const SETTINGS_CHANGED_EVENT = 'settings-changed';

// 破壊的変更時にインクリメントし migrate() にケース追加
// v2: general / grid グループと editor.fontFamily を追加 (#389)
const SETTINGS_VERSION = 2;

export interface AppSettings {
  version: number;
  general: {
    autoConnect: boolean;
    confirmOnExit: boolean;
    maxQueryHistory: number;
    language: string;
  };
  editor: {
    fontSize: number;
    fontFamily: string;
    tabSize: number;
    wordWrap: boolean;
    minimap: boolean;
  };
  query: {
    autoCommit: boolean;
    timeout: number;
    maxRows: number;
  };
  grid: {
    defaultPageSize: number;
    showRowNumbers: boolean;
    nullDisplay: string;
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

// backend accessors/settings_accessor.h のデフォルト値と一致させる
export const defaultSettings: AppSettings = {
  version: SETTINGS_VERSION,
  general: {
    autoConnect: false,
    confirmOnExit: true,
    maxQueryHistory: 1000,
    language: 'en',
  },
  editor: {
    fontSize: 14,
    fontFamily: 'Consolas',
    tabSize: 4,
    wordWrap: true,
    minimap: false,
  },
  query: {
    autoCommit: true,
    timeout: QUERY_TIMEOUT_DEFAULT_SEC * 1000,
    maxRows: 10000,
  },
  grid: {
    defaultPageSize: 100000,
    showRowNumbers: true,
    nullDisplay: '(NULL)',
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
// v0/v1 → v2: general / grid グループ欠落時は defaults 補完、editor.fontFamily も同様
function migrate(parsed: unknown): AppSettings {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return defaultSettings;
  }
  const obj = parsed as Record<string, unknown>;
  return {
    version: SETTINGS_VERSION,
    general: { ...defaultSettings.general, ...pickTyped(obj.general, defaultSettings.general) },
    editor: { ...defaultSettings.editor, ...pickTyped(obj.editor, defaultSettings.editor) },
    query: { ...defaultSettings.query, ...pickTyped(obj.query, defaultSettings.query) },
    grid: { ...defaultSettings.grid, ...pickTyped(obj.grid, defaultSettings.grid) },
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
