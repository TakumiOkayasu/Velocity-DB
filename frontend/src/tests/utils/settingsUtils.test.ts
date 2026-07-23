import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings, getSettings } from '../../utils/settingsUtils';

const STORAGE_KEY = 'app-settings';

describe('settingsUtils.getSettings (schema migration)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('localStorage 未設定時は defaults を返す', () => {
    expect(getSettings()).toEqual(defaultSettings);
  });

  it('壊れた JSON はスキップして defaults を返す', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(getSettings()).toEqual(defaultSettings);
  });

  it('null/配列など object でない JSON も defaults を返す', () => {
    localStorage.setItem(STORAGE_KEY, 'null');
    expect(getSettings()).toEqual(defaultSettings);
    localStorage.setItem(STORAGE_KEY, '[]');
    // 配列は Object.assign で spread 可能なので editor 等は defaults 由来となる
    const fromArray = getSettings();
    expect(fromArray.version).toBe(2);
    expect(fromArray.editor).toEqual(defaultSettings.editor);
  });

  it('version 欠落 (v0) データを現行形式へ migrate する', () => {
    const legacy = {
      editor: { fontSize: 16, tabSize: 2, wordWrap: false, minimap: true },
      query: { autoCommit: false, timeout: 60000, maxRows: 500 },
      appearance: { theme: 'light' },
      shortcuts: {
        execute: 'F5',
        newQuery: 'Ctrl+T',
        format: 'Ctrl+F',
        search: 'Ctrl+P',
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
    const migrated = getSettings();
    expect(migrated.version).toBe(2);
    expect(migrated.editor.fontSize).toBe(16);
    expect(migrated.editor.minimap).toBe(true);
    expect(migrated.query.timeout).toBe(60000);
    expect(migrated.appearance.theme).toBe('light');
    expect(migrated.shortcuts.execute).toBe('F5');
  });

  it('v1 データ (general/grid/fontFamily 欠落) を v2 へ migrate し defaults で補完する (#389)', () => {
    const v1 = {
      version: 1,
      editor: { fontSize: 18, tabSize: 2, wordWrap: false, minimap: true },
      query: { autoCommit: false, timeout: 120000, maxRows: 200 },
      appearance: { theme: 'dark' },
      shortcuts: {
        execute: 'F9',
        newQuery: 'Ctrl+N',
        format: 'Ctrl+Shift+F',
        search: 'Ctrl+Shift+P',
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v1));
    const migrated = getSettings();
    expect(migrated.version).toBe(2);
    // 既存値は保持
    expect(migrated.editor.fontSize).toBe(18);
    expect(migrated.query.timeout).toBe(120000);
    // 新グループ / 新フィールドは defaults 補完
    expect(migrated.general).toEqual(defaultSettings.general);
    expect(migrated.grid).toEqual(defaultSettings.grid);
    expect(migrated.editor.fontFamily).toBe(defaultSettings.editor.fontFamily);
  });

  it('部分的なデータは defaults で埋める (forward compatible)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ editor: { fontSize: 20 } }));
    const merged = getSettings();
    expect(merged.version).toBe(2);
    expect(merged.editor.fontSize).toBe(20);
    // 他は default 継承
    expect(merged.editor.tabSize).toBe(defaultSettings.editor.tabSize);
    expect(merged.query).toEqual(defaultSettings.query);
    expect(merged.general).toEqual(defaultSettings.general);
    expect(merged.grid).toEqual(defaultSettings.grid);
    expect(merged.shortcuts).toEqual(defaultSettings.shortcuts);
  });

  it('version 付き新形式データはそのまま読める', () => {
    const current = {
      ...defaultSettings,
      editor: { ...defaultSettings.editor, fontSize: 18 },
      general: { ...defaultSettings.general, maxQueryHistory: 500 },
      grid: { ...defaultSettings.grid, nullDisplay: 'NULL' },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    const loaded = getSettings();
    expect(loaded.version).toBe(2);
    expect(loaded.editor.fontSize).toBe(18);
    expect(loaded.general.maxQueryHistory).toBe(500);
    expect(loaded.grid.nullDisplay).toBe('NULL');
  });
});
