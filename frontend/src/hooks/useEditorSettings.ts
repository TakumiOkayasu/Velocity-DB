import { useEffect, useState } from 'react';
import { getSettings, SETTINGS_CHANGED_EVENT } from '../utils/settingsUtils';

/** Monaco へ反映するエディタ設定のサブセット (#389) */
export interface EditorSettings {
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  wordWrap: boolean;
  minimap: boolean;
}

function readEditorSettings(): EditorSettings {
  const { editor } = getSettings();
  return {
    fontSize: editor.fontSize,
    fontFamily: editor.fontFamily,
    tabSize: editor.tabSize,
    wordWrap: editor.wordWrap,
    minimap: editor.minimap,
  };
}

/**
 * エディタ設定を localStorage キャッシュから読み、SettingsDialog 保存時の
 * settings-changed CustomEvent を購読して最新値へ追従する。
 * (保存時は localStorage 書込 → dispatch の順のため、イベント時点で最新値が読める)
 */
export function useEditorSettings(): EditorSettings {
  const [settings, setSettings] = useState<EditorSettings>(readEditorSettings);

  useEffect(() => {
    const applyLatest = () => {
      setSettings(readEditorSettings());
    };
    window.addEventListener(SETTINGS_CHANGED_EVENT, applyLatest);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, applyLatest);
    };
  }, []);

  return settings;
}
