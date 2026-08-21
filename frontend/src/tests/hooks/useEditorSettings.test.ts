import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { useEditorSettings } from '../../hooks/useEditorSettings';
import { defaultSettings, SETTINGS_CHANGED_EVENT } from '../../utils/settingsUtils';

const STORAGE_KEY = 'app-settings';

describe('useEditorSettings (issue #389)', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('localStorage 未設定時は defaults のエディタ設定を返す', () => {
    const { result } = renderHook(() => useEditorSettings());
    expect(result.current).toEqual({
      fontSize: defaultSettings.editor.fontSize,
      fontFamily: defaultSettings.editor.fontFamily,
      tabSize: defaultSettings.editor.tabSize,
      wordWrap: defaultSettings.editor.wordWrap,
      minimap: defaultSettings.editor.minimap,
    });
  });

  it('localStorage 保存値を初期値として読む', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, editor: { fontSize: 20, fontFamily: 'Cascadia Code' } })
    );
    const { result } = renderHook(() => useEditorSettings());
    expect(result.current.fontSize).toBe(20);
    expect(result.current.fontFamily).toBe('Cascadia Code');
    // 欠落フィールドは defaults 補完
    expect(result.current.tabSize).toBe(defaultSettings.editor.tabSize);
  });

  it('settings-changed イベントで最新の localStorage 値へ更新される', () => {
    const { result } = renderHook(() => useEditorSettings());
    expect(result.current.fontSize).toBe(defaultSettings.editor.fontSize);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, editor: { fontSize: 22, minimap: true, wordWrap: false } })
    );
    act(() => {
      window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
    });

    expect(result.current.fontSize).toBe(22);
    expect(result.current.minimap).toBe(true);
    expect(result.current.wordWrap).toBe(false);
  });

  it('unmount 後は購読解除され更新されない', () => {
    const { result, unmount } = renderHook(() => useEditorSettings());
    unmount();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, editor: { fontSize: 30 } }));
    act(() => {
      window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
    });

    expect(result.current.fontSize).toBe(defaultSettings.editor.fontSize);
  });
});
