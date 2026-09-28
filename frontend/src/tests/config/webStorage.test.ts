import { afterEach, describe, expect, it } from 'vite-plus/test';

const key = 'velocitydb-web-storage-regression';

describe('jsdom Web Storage on the pinned Node runtime', () => {
  afterEach(() => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  });

  it.each(['localStorage', 'sessionStorage'] as const)(
    '%s uses the browser Storage implementation',
    (name) => {
      const storage = globalThis[name];
      expect(storage).toBe(window[name]);
      expect(storage).toBeInstanceOf(window.Storage);
      expect(storage.getItem(key)).toBeNull();
      storage.setItem(key, 'saved');
      expect(window[name].getItem(key)).toBe('saved');
      storage.removeItem(key);
      expect(storage.getItem(key)).toBeNull();
    }
  );

  it('keeps local and session storage separate', () => {
    localStorage.setItem(key, 'local');
    sessionStorage.setItem(key, 'session');
    expect(localStorage.getItem(key)).toBe('local');
    expect(sessionStorage.getItem(key)).toBe('session');
  });
});
