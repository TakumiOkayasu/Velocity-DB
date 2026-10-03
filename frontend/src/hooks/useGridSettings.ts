import { useEffect, useState } from 'react';
import { getSettings, SETTINGS_CHANGED_EVENT } from '../utils/settingsUtils';

export function useGridSettings() {
  const [settings, setSettings] = useState(() => getSettings().grid);
  useEffect(() => {
    const update = () => setSettings(getSettings().grid);
    window.addEventListener(SETTINGS_CHANGED_EVENT, update);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, update);
  }, []);
  return settings;
}
