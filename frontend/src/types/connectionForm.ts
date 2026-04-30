import type { DatabaseType, EnvironmentType, SshAuthType } from '.';

/**
 * SshConfig for ConnectionDialog UI form (controlled inputs).
 *
 * NOTE: 同名の `SshConfig` が `./index.ts` にも存在する。あちらは runtime 表現で
 * `Connection.ssh?` に使う optional 版。本 form 版は controlled input の都合で
 * 全フィールドを必須にしている (value="" でも `undefined` は不可)。
 *
 * 両者の差は「フォーム入力中の中間状態」と「永続化前 runtime 表現」の責務差から
 * 来ているため、安易な統合は望ましくない。長期的にはどちらかを `*FormState` 等に
 * リネームして責務を明示する方向で別 issue で扱う。
 */
export interface SshConfig {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  password: string;
  privateKeyPath: string;
  keyPassphrase: string;
}

/**
 * ConnectionConfig for ConnectionDialog UI form (controlled inputs).
 * 永続化向けの型は `./index.ts` の `SavedConnectionProfile` を参照。
 */
export interface ConnectionConfig {
  name: string;
  server: string;
  port: number;
  database: string;
  username: string;
  password: string;
  useWindowsAuth: boolean;
  isProduction: boolean;
  isReadOnly: boolean;
  environment: EnvironmentType;
  dbType: DatabaseType;
  folderPath: string;
  ssh: SshConfig;
}
