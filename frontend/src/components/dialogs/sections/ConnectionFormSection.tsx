import type { ConnectionConfig } from '../ConnectionDialog';
import styles from '../ConnectionDialog.module.css';

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
  return (
    <>
      <div className={styles.formGroup}>
        <label>接続名</label>
        <input type="text" value={config.name} onChange={(e) => onChange('name', e.target.value)} />
      </div>

      <div className={styles.formRow}>
        <div className={styles.formGroup}>
          <label>サーバー</label>
          <input
            type="text"
            value={config.server}
            onChange={(e) => onChange('server', e.target.value)}
            placeholder="localhost またはホスト名"
          />
        </div>

        <div className={styles.formGroupSmall}>
          <label>ポート</label>
          <input
            type="number"
            value={config.port}
            onChange={(e) => onChange('port', Number.parseInt(e.target.value, 10) || 1433)}
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label>データベース</label>
        <input
          type="text"
          value={config.database}
          onChange={(e) => onChange('database', e.target.value)}
          placeholder="master"
        />
      </div>

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

      {!config.useWindowsAuth && (
        <>
          <div className={styles.formGroup}>
            <label>ユーザー名</label>
            <input
              type="text"
              value={config.username}
              onChange={(e) => onChange('username', e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label>パスワード</label>
            <input
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
