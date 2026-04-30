import { describe, expect, it } from 'vitest';
import type { ConnectionConfig } from '../../components/dialogs/ConnectionDialog';
import {
  initialProfileFormState,
  type ProfileFormState,
  profileFormReducer,
} from '../../components/dialogs/hooks/useConnectionProfile.reducer';
import type { SavedConnectionProfile } from '../../types';

function makeProfile(overrides: Partial<SavedConnectionProfile> = {}): SavedConnectionProfile {
  return {
    id: 'p1',
    name: 'Profile 1',
    server: 'host.example.com',
    port: 1433,
    database: 'TestDb',
    username: 'user1',
    useWindowsAuth: false,
    savePassword: false,
    isProduction: false,
    isReadOnly: false,
    environment: 'development',
    dbType: 'sqlserver',
    folderPath: '',
    ssh: undefined,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    name: 'C',
    server: 's',
    port: 1433,
    database: 'd',
    username: 'u',
    password: 'p',
    useWindowsAuth: false,
    isProduction: false,
    isReadOnly: false,
    environment: 'development',
    dbType: 'sqlserver',
    folderPath: '',
    ssh: {
      enabled: false,
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      privateKeyPath: '',
      keyPassphrase: '',
    },
    ...overrides,
  };
}

function stateWith(overrides: Partial<ProfileFormState> = {}): ProfileFormState {
  return { ...initialProfileFormState, ...overrides };
}

describe('profileFormReducer', () => {
  describe('initialProfileFormState', () => {
    it('初期値は空配列・new モード・editingProfileId null', () => {
      expect(initialProfileFormState.profiles).toEqual([]);
      expect(initialProfileFormState.mode).toBe('new');
      expect(initialProfileFormState.editingProfileId).toBeNull();
      expect(initialProfileFormState.savePassword).toBe(false);
      expect(initialProfileFormState.testResult).toBeNull();
      expect(initialProfileFormState.deleteConfirmOpen).toBe(false);
      expect(initialProfileFormState.config.name).toBe('New Connection');
      expect(initialProfileFormState.config.dbType).toBe('sqlserver');
      expect(initialProfileFormState.config.ssh.enabled).toBe(false);
    });
  });

  describe('SET_PROFILES', () => {
    it('profiles を payload で完全置換し、他フィールドは不変', () => {
      const prev = stateWith({ mode: 'edit', editingProfileId: 'old' });
      const profiles = [makeProfile({ id: 'a' }), makeProfile({ id: 'b' })];
      const next = profileFormReducer(prev, { type: 'SET_PROFILES', payload: profiles });
      expect(next.profiles).toEqual(profiles);
      expect(next.mode).toBe('edit');
      expect(next.editingProfileId).toBe('old');
    });
  });

  describe('REMOVE_PROFILE', () => {
    it('id 一致の要素のみ削除', () => {
      const prev = stateWith({
        profiles: [makeProfile({ id: 'a' }), makeProfile({ id: 'b' }), makeProfile({ id: 'c' })],
      });
      const next = profileFormReducer(prev, { type: 'REMOVE_PROFILE', payload: 'b' });
      expect(next.profiles.map((p) => p.id)).toEqual(['a', 'c']);
    });
  });

  describe('PROFILE_SAVED', () => {
    it('isNew=true なら profiles 末尾に追加し mode=edit / editingProfileId=profile.id / testResult に payload.message が反映', () => {
      const prev = stateWith({
        profiles: [makeProfile({ id: 'a' })],
        mode: 'new',
        editingProfileId: null,
      });
      const saved = makeProfile({ id: 'b', name: 'New Saved' });
      const next = profileFormReducer(prev, {
        type: 'PROFILE_SAVED',
        payload: { profile: saved, isNew: true, message: 'Profile saved' },
      });
      expect(next.profiles.map((p) => p.id)).toEqual(['a', 'b']);
      expect(next.mode).toBe('edit');
      expect(next.editingProfileId).toBe('b');
      expect(next.testResult).toEqual({ success: true, message: 'Profile saved' });
    });

    it('isNew=false なら previousId 一致を置換し mode=edit / editingProfileId=profile.id を維持', () => {
      const prev = stateWith({
        profiles: [makeProfile({ id: 'a', name: 'A' }), makeProfile({ id: 'b', name: 'B' })],
        mode: 'edit',
        editingProfileId: 'b',
      });
      const updated = makeProfile({ id: 'b', name: 'B-saved' });
      const next = profileFormReducer(prev, {
        type: 'PROFILE_SAVED',
        payload: { profile: updated, isNew: false, previousId: 'b', message: 'Updated' },
      });
      expect(next.profiles[1].name).toBe('B-saved');
      expect(next.mode).toBe('edit');
      expect(next.editingProfileId).toBe('b');
      expect(next.testResult).toEqual({ success: true, message: 'Updated' });
    });

    it('config は変更されない (UI 入力中の値を保持)', () => {
      const userInput = makeConfig({ name: 'Editing in progress', server: 'typed-host' });
      const prev = stateWith({ config: userInput, mode: 'new', editingProfileId: null });
      const saved = makeProfile({ id: 'x' });
      const next = profileFormReducer(prev, {
        type: 'PROFILE_SAVED',
        payload: { profile: saved, isNew: true, message: 'Saved' },
      });
      expect(next.config).toBe(userInput);
    });
  });

  describe('SELECT_PROFILE', () => {
    it('mode=edit / editingProfileId=profile.id / testResult=null に遷移', () => {
      const prev = stateWith({
        mode: 'new',
        editingProfileId: null,
        testResult: { success: true, message: 'x' },
      });
      const profile = makeProfile({ id: 'p1', savePassword: true });
      const next = profileFormReducer(prev, {
        type: 'SELECT_PROFILE',
        payload: { profile, password: 'secret' },
      });
      expect(next.mode).toBe('edit');
      expect(next.editingProfileId).toBe('p1');
      expect(next.testResult).toBeNull();
    });

    it('config に profile + password が反映される', () => {
      const profile = makeProfile({
        id: 'p1',
        name: 'My Profile',
        server: 'srv',
        port: 5432,
        database: 'mydb',
        username: 'me',
        useWindowsAuth: true,
        isProduction: true,
        isReadOnly: true,
        environment: 'production',
        dbType: 'postgresql',
        folderPath: '/tmp/x',
      });
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SELECT_PROFILE',
        payload: { profile, password: 'pw' },
      });
      expect(next.config.name).toBe('My Profile');
      expect(next.config.server).toBe('srv');
      expect(next.config.port).toBe(5432);
      expect(next.config.database).toBe('mydb');
      expect(next.config.username).toBe('me');
      expect(next.config.password).toBe('pw');
      expect(next.config.useWindowsAuth).toBe(true);
      expect(next.config.isProduction).toBe(true);
      expect(next.config.isReadOnly).toBe(true);
      expect(next.config.environment).toBe('production');
      expect(next.config.dbType).toBe('postgresql');
      expect(next.config.folderPath).toBe('/tmp/x');
    });

    it('savePassword は profile.savePassword を反映', () => {
      const profile = makeProfile({ savePassword: true });
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SELECT_PROFILE',
        payload: { profile, password: 'pw' },
      });
      expect(next.savePassword).toBe(true);
    });

    it('environment 未指定 + isProduction=true なら production に推定', () => {
      const profile = makeProfile({ isProduction: true });
      // environment を未指定にする (型上は optional)
      profile.environment = undefined;
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SELECT_PROFILE',
        payload: { profile, password: '' },
      });
      expect(next.config.environment).toBe('production');
    });

    it('environment 未指定 + isProduction=false なら development に推定', () => {
      const profile = makeProfile({ isProduction: false });
      profile.environment = undefined;
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SELECT_PROFILE',
        payload: { profile, password: '' },
      });
      expect(next.config.environment).toBe('development');
    });

    it('dbType 未指定なら sqlserver にフォールバック', () => {
      const profile = makeProfile();
      profile.dbType = undefined;
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SELECT_PROFILE',
        payload: { profile, password: '' },
      });
      expect(next.config.dbType).toBe('sqlserver');
    });

    it('ssh 未設定なら DEFAULT_SSH_CONFIG を使用', () => {
      const profile = makeProfile({ ssh: undefined });
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SELECT_PROFILE',
        payload: { profile, password: '' },
      });
      expect(next.config.ssh.enabled).toBe(false);
      expect(next.config.ssh.host).toBe('');
      expect(next.config.ssh.port).toBe(22);
      expect(next.config.ssh.authType).toBe('password');
    });

    it('ssh 設定ありなら profile.ssh を反映 (password / keyPassphrase は空)', () => {
      const profile = makeProfile({
        ssh: {
          enabled: true,
          host: 'jump.example',
          port: 2222,
          username: 'sshuser',
          authType: 'privateKey',
          privateKeyPath: '/keys/id',
          savePassword: false,
        },
      });
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SELECT_PROFILE',
        payload: { profile, password: '' },
      });
      expect(next.config.ssh.enabled).toBe(true);
      expect(next.config.ssh.host).toBe('jump.example');
      expect(next.config.ssh.port).toBe(2222);
      expect(next.config.ssh.username).toBe('sshuser');
      expect(next.config.ssh.authType).toBe('privateKey');
      expect(next.config.ssh.privateKeyPath).toBe('/keys/id');
      expect(next.config.ssh.password).toBe('');
      expect(next.config.ssh.keyPassphrase).toBe('');
    });
  });

  describe('NEW_PROFILE', () => {
    it('mode=new / editingProfileId=null / savePassword=false / testResult=null にリセット、config は DEFAULT', () => {
      const prev = stateWith({
        mode: 'edit',
        editingProfileId: 'p1',
        savePassword: true,
        testResult: { success: false, message: 'x' },
        config: makeConfig({ name: 'changed' }),
      });
      const next = profileFormReducer(prev, { type: 'NEW_PROFILE' });
      expect(next.mode).toBe('new');
      expect(next.editingProfileId).toBeNull();
      expect(next.savePassword).toBe(false);
      expect(next.testResult).toBeNull();
      expect(next.config.name).toBe('New Connection');
      expect(next.config.server).toBe('localhost');
      expect(next.config.dbType).toBe('sqlserver');
    });
  });

  describe('COPY_PROFILE', () => {
    it('mode=new / editingProfileId=null / config.name に " (Copy)" 付加 / testResult=null', () => {
      const prev = stateWith({
        mode: 'edit',
        editingProfileId: 'p1',
        config: makeConfig({ name: 'My DB', server: 'host' }),
        testResult: { success: true, message: 'ok' },
      });
      const next = profileFormReducer(prev, { type: 'COPY_PROFILE' });
      expect(next.mode).toBe('new');
      expect(next.editingProfileId).toBeNull();
      expect(next.config.name).toBe('My DB (Copy)');
      expect(next.config.server).toBe('host');
      expect(next.testResult).toBeNull();
    });

    it('savePassword は維持される (リセットしない)', () => {
      const prev = stateWith({ savePassword: true, mode: 'edit', editingProfileId: 'p1' });
      const next = profileFormReducer(prev, { type: 'COPY_PROFILE' });
      expect(next.savePassword).toBe(true);
    });
  });

  describe('SET_CONFIG', () => {
    it('値を直接渡すと config がその値になる', () => {
      const newCfg = makeConfig({ name: 'Direct', port: 9999 });
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SET_CONFIG',
        payload: newCfg,
      });
      expect(next.config).toEqual(newCfg);
    });

    it('関数を渡すと prev config を引数に呼ばれた戻り値が config になる (functional updater)', () => {
      const prev = stateWith({ config: makeConfig({ name: 'Old', port: 1433 }) });
      const next = profileFormReducer(prev, {
        type: 'SET_CONFIG',
        payload: (current) => ({ ...current, name: `${current.name}-new`, port: current.port + 1 }),
      });
      expect(next.config.name).toBe('Old-new');
      expect(next.config.port).toBe(1434);
    });
  });

  describe('SET_SAVE_PASSWORD', () => {
    it('値を直接渡すと savePassword がその値になる', () => {
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SET_SAVE_PASSWORD',
        payload: true,
      });
      expect(next.savePassword).toBe(true);
    });

    it('関数を渡すと prev を引数に呼ばれた戻り値が savePassword になる', () => {
      const prev = stateWith({ savePassword: false });
      const next = profileFormReducer(prev, {
        type: 'SET_SAVE_PASSWORD',
        payload: (current) => !current,
      });
      expect(next.savePassword).toBe(true);
    });
  });

  describe('SET_TEST_RESULT', () => {
    it('成功結果を設定できる', () => {
      const next = profileFormReducer(initialProfileFormState, {
        type: 'SET_TEST_RESULT',
        payload: { success: true, message: 'ok' },
      });
      expect(next.testResult).toEqual({ success: true, message: 'ok' });
    });

    it('null でクリアできる', () => {
      const prev = stateWith({ testResult: { success: false, message: 'err' } });
      const next = profileFormReducer(prev, { type: 'SET_TEST_RESULT', payload: null });
      expect(next.testResult).toBeNull();
    });

    it('関数を渡すと prev を引数に呼ばれた戻り値が testResult になる (functional updater)', () => {
      const prev = stateWith({ testResult: { success: true, message: 'ok' } });
      const next = profileFormReducer(prev, {
        type: 'SET_TEST_RESULT',
        payload: (current) => (current ? { ...current, message: `${current.message}!` } : null),
      });
      expect(next.testResult).toEqual({ success: true, message: 'ok!' });
    });
  });

  describe('OPEN_DELETE_CONFIRM / CLOSE_DELETE_CONFIRM', () => {
    it('OPEN で deleteConfirmOpen=true', () => {
      const next = profileFormReducer(initialProfileFormState, { type: 'OPEN_DELETE_CONFIRM' });
      expect(next.deleteConfirmOpen).toBe(true);
    });

    it('CLOSE で deleteConfirmOpen=false', () => {
      const prev = stateWith({ deleteConfirmOpen: true });
      const next = profileFormReducer(prev, { type: 'CLOSE_DELETE_CONFIRM' });
      expect(next.deleteConfirmOpen).toBe(false);
    });
  });

  describe('参照不変性', () => {
    it('action 適用後は新しい state オブジェクトを返す (state !== prev)', () => {
      const prev = stateWith();
      const next = profileFormReducer(prev, { type: 'NEW_PROFILE' });
      expect(next).not.toBe(prev);
    });
  });
});
