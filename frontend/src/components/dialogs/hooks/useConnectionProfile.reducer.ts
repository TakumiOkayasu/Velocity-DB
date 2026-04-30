import type { EnvironmentType, SavedConnectionProfile } from '../../../types';
import type { ConnectionConfig, SshConfig } from '../../../types/connectionForm';

export type ProfileMode = 'new' | 'edit';

export const DEFAULT_SSH_CONFIG: SshConfig = {
  enabled: false,
  host: '',
  port: 22,
  username: '',
  authType: 'password',
  password: '',
  privateKeyPath: '',
  keyPassphrase: '',
};

export const DEFAULT_CONFIG: ConnectionConfig = {
  name: 'New Connection',
  server: 'localhost',
  port: 1433,
  database: 'master',
  username: '',
  password: '',
  useWindowsAuth: true,
  isProduction: false,
  isReadOnly: false,
  environment: 'development',
  dbType: 'sqlserver',
  folderPath: '',
  ssh: { ...DEFAULT_SSH_CONFIG },
};

export interface ProfileFormState {
  profiles: SavedConnectionProfile[];
  mode: ProfileMode;
  editingProfileId: string | null;
  savePassword: boolean;
  config: ConnectionConfig;
  testResult: { success: boolean; message: string } | null;
  deleteConfirmOpen: boolean;
}

export const initialProfileFormState: ProfileFormState = {
  profiles: [],
  mode: 'new',
  editingProfileId: null,
  savePassword: false,
  config: { ...DEFAULT_CONFIG, ssh: { ...DEFAULT_SSH_CONFIG } },
  testResult: null,
  deleteConfirmOpen: false,
};

type SetStateValue<T> = T | ((prev: T) => T);

export type ProfileFormAction =
  | { type: 'SET_PROFILES'; payload: SavedConnectionProfile[] }
  | { type: 'REMOVE_PROFILE'; payload: string }
  | {
      type: 'PROFILE_SAVED';
      payload:
        | { profile: SavedConnectionProfile; isNew: true; message: string }
        | {
            profile: SavedConnectionProfile;
            isNew: false;
            previousId: string;
            message: string;
          };
    }
  | { type: 'SELECT_PROFILE'; payload: { profile: SavedConnectionProfile; password: string } }
  | { type: 'NEW_PROFILE' }
  | { type: 'COPY_PROFILE' }
  | { type: 'SET_CONFIG'; payload: SetStateValue<ConnectionConfig> }
  | { type: 'SET_SAVE_PASSWORD'; payload: SetStateValue<boolean> }
  | {
      type: 'SET_TEST_RESULT';
      payload: SetStateValue<{ success: boolean; message: string } | null>;
    }
  | { type: 'OPEN_DELETE_CONFIRM' }
  | { type: 'CLOSE_DELETE_CONFIRM' };

// SavedConnectionProfile.environment は optional (旧バージョン保存データには存在しない)。
// 旧データは isProduction から environment を推定して後方互換性を担保する。
function inferEnvironment(profile: SavedConnectionProfile): EnvironmentType {
  if (profile.environment) return profile.environment;
  return profile.isProduction ? 'production' : 'development';
}

function buildConfigFromProfile(
  profile: SavedConnectionProfile,
  password: string
): ConnectionConfig {
  return {
    name: profile.name,
    server: profile.server,
    port: profile.port,
    database: profile.database,
    username: profile.username,
    password,
    useWindowsAuth: profile.useWindowsAuth,
    isProduction: profile.isProduction,
    isReadOnly: profile.isReadOnly,
    environment: inferEnvironment(profile),
    dbType: profile.dbType ?? 'sqlserver',
    folderPath: profile.folderPath ?? '',
    ssh: profile.ssh
      ? {
          enabled: profile.ssh.enabled,
          host: profile.ssh.host,
          port: profile.ssh.port,
          username: profile.ssh.username,
          authType: profile.ssh.authType,
          password: '',
          privateKeyPath: profile.ssh.privateKeyPath,
          keyPassphrase: '',
        }
      : { ...DEFAULT_SSH_CONFIG },
  };
}

function resolveSetStateValue<T>(payload: SetStateValue<T>, prev: T): T {
  return typeof payload === 'function' ? (payload as (p: T) => T)(prev) : payload;
}

export function profileFormReducer(
  state: ProfileFormState,
  action: ProfileFormAction
): ProfileFormState {
  switch (action.type) {
    case 'SET_PROFILES':
      return { ...state, profiles: action.payload };

    case 'REMOVE_PROFILE':
      return {
        ...state,
        profiles: state.profiles.filter((p) => p.id !== action.payload),
      };

    case 'PROFILE_SAVED': {
      const payload = action.payload;
      const profiles = payload.isNew
        ? [...state.profiles, payload.profile]
        : state.profiles.map((p) => (p.id === payload.previousId ? payload.profile : p));
      return {
        ...state,
        profiles,
        mode: 'edit',
        editingProfileId: payload.profile.id,
        testResult: { success: true, message: payload.message },
      };
    }

    case 'SELECT_PROFILE': {
      const { profile, password } = action.payload;
      return {
        ...state,
        config: buildConfigFromProfile(profile, password),
        savePassword: profile.savePassword,
        testResult: null,
        mode: 'edit',
        editingProfileId: profile.id,
      };
    }

    case 'NEW_PROFILE':
      return {
        ...state,
        mode: 'new',
        editingProfileId: null,
        config: { ...DEFAULT_CONFIG, ssh: { ...DEFAULT_SSH_CONFIG } },
        savePassword: false,
        testResult: null,
      };

    case 'COPY_PROFILE':
      return {
        ...state,
        mode: 'new',
        editingProfileId: null,
        config: { ...state.config, name: `${state.config.name} (Copy)` },
        testResult: null,
      };

    case 'SET_CONFIG':
      return { ...state, config: resolveSetStateValue(action.payload, state.config) };

    case 'SET_SAVE_PASSWORD':
      return {
        ...state,
        savePassword: resolveSetStateValue(action.payload, state.savePassword),
      };

    case 'SET_TEST_RESULT':
      return { ...state, testResult: resolveSetStateValue(action.payload, state.testResult) };

    case 'OPEN_DELETE_CONFIRM':
      return { ...state, deleteConfirmOpen: true };

    case 'CLOSE_DELETE_CONFIRM':
      return { ...state, deleteConfirmOpen: false };
  }
}
