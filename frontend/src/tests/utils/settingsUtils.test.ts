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
    expect(fromArray.version).toBe(1);
    expect(fromArray.editor).toEqual(defaultSettings.editor);
  });

  it('version 欠落 (v0) データを v1 形式へ migrate する', () => {
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
    expect(migrated.version).toBe(1);
    expect(migrated.editor.fontSize).toBe(16);
    expect(migrated.editor.minimap).toBe(true);
    expect(migrated.query.timeout).toBe(60000);
    expect(migrated.appearance.theme).toBe('light');
    expect(migrated.shortcuts.execute).toBe('F5');
  });

  it('部分的なデータは defaults で埋める (forward compatible)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ editor: { fontSize: 20 } }));
    const merged = getSettings();
    expect(merged.version).toBe(1);
    expect(merged.editor.fontSize).toBe(20);
    // 他は default 継承
    expect(merged.editor.tabSize).toBe(defaultSettings.editor.tabSize);
    expect(merged.query).toEqual(defaultSettings.query);
    expect(merged.shortcuts).toEqual(defaultSettings.shortcuts);
  });

  it('version 付き新形式データはそのまま読める', () => {
    const current = { ...defaultSettings, editor: { ...defaultSettings.editor, fontSize: 18 } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    const loaded = getSettings();
    expect(loaded.version).toBe(1);
    expect(loaded.editor.fontSize).toBe(18);
  });
});
