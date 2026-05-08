import type { DatabaseType } from '../../../types';
import type { ConnectionConfig } from '../../../types/connectionForm';
import styles from '../ConnectionDialog.module.css';

const DB_PLACEHOLDER: Record<DatabaseType, string> = {
  sqlserver: 'master',
  postgresql: 'postgres',
  mysql: '',
};

const DB_DEFAULT_PORT: Record<DatabaseType, number> = {
  sqlserver: 1433,
  postgresql: 5432,
  mysql: 3306,
};

interface ConnectionFormSectionProps {
  config: ConnectionConfig;
  savePassword: boolean;
  onChange: (field: keyof ConnectionConfig, value: string | number | boolean) => void;
  onSavePasswordChange: (checked: boolean) => void;
}

export function ConnectionFormSection({
  config,
  savePassword,
  onChange,
  onSavePasswordChange,
}: ConnectionFormSectionProps) {
  const dbType = config.dbType;

  return (
    <>
      <div className={styles.formGroup}>
        <label htmlFor="conn-name">接続名</label>
        <input
          id="conn-name"
          type="text"
          value={config.name}
          onChange={(e) => onChange('name', e.target.value)}
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="conn-folder">フォルダ (任意)</label>
        <input
          id="conn-folder"
          type="text"
          value={config.folderPath}
          onChange={(e) => onChange('folderPath', e.target.value)}
          placeholder="例: Work / Personal (空欄でルート)"
        />
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label htmlFor="conn-server">サーバー</label>
          <input
            id="conn-server"
            type="text"
            value={config.server}
            onChange={(e) => onChange('server', e.target.value)}
            placeholder="localhost またはホスト名"
          />
        </div>

        <div className={styles.formGroupSmall}>
          <label htmlFor="conn-port">ポート</label>
          <input
            id="conn-port"
            type="number"
            value={config.port}
            onChange={(e) =>
              onChange('port', Number.parseInt(e.target.value, 10) || DB_DEFAULT_PORT[dbType])
            }
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="conn-database">データベース</label>
        <input
          id="conn-database"
          type="text"
          value={config.database}
          onChange={(e) => onChange('database', e.target.value)}
          placeholder={DB_PLACEHOLDER[dbType] ?? ''}
        />
      </div>

      {dbType === 'sqlserver' && (
        <div className={styles.formGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={config.useWindowsAuth}
              onChange={(e) => onChange('useWindowsAuth', e.target.checked)}
            />
            Windows認証を使用
          </label>
        </div>
      )}

      {!(dbType === 'sqlserver' && config.useWindowsAuth) && (
        <>
          <div className={styles.formGroup}>
            <label htmlFor="conn-username">ユーザー名</label>
            <input
              id="conn-username"
              type="text"
              value={config.username}
              onChange={(e) => onChange('username', e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="conn-password">パスワード</label>
            <input
              id="conn-password"
              type="password"
              value={config.password}
              onChange={(e) => onChange('password', e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={savePassword}
                onChange={(e) => onSavePasswordChange(e.target.checked)}
              />
              パスワードを保存（暗号化）
            </label>
          </div>
        </>
      )}
    </>
  );
}
