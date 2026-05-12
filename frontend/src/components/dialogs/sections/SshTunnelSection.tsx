import { ioProvider } from '../../../api/providers';
import { isSshAuthType } from '../../../types';
import type { SshConfig } from '../../../types/connectionForm';
import styles from '../ConnectionDialog.module.css';

interface SshTunnelSectionProps {
  ssh: SshConfig;
  onChange: (field: keyof SshConfig, value: string | number | boolean) => void;
}

export function SshTunnelSection({ ssh, onChange }: SshTunnelSectionProps) {
  return (
    <div className={styles.productionSection}>
      <div className={styles.sectionHeader}>SSHトンネル</div>
      <div className={styles.formGroup}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={ssh.enabled}
            onChange={(e) => onChange('enabled', e.target.checked)}
          />
          SSHトンネルを使用
        </label>
        <span className={styles.hint}>SSHポート転送経由で接続</span>
      </div>
      {ssh.enabled && (
        <>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="ssh-host">SSHホスト</label>
              <input
                id="ssh-host"
                type="text"
                value={ssh.host}
                onChange={(e) => onChange('host', e.target.value)}
                placeholder="ssh.example.com"
              />
            </div>
            <div className={styles.formGroupSmall}>
              <label htmlFor="ssh-port">SSHポート</label>
              <input
                id="ssh-port"
                type="number"
                value={ssh.port}
                onChange={(e) => onChange('port', Number.parseInt(e.target.value, 10) || 22)}
              />
            </div>
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="ssh-username">SSHユーザー名</label>
            <input
              id="ssh-username"
              type="text"
              value={ssh.username}
              onChange={(e) => onChange('username', e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor="ssh-auth-type">認証方式</label>
            <select
              id="ssh-auth-type"
              value={ssh.authType}
              onChange={(e) => {
                if (isSshAuthType(e.target.value)) onChange('authType', e.target.value);
              }}
              className={styles.selectInput}
            >
              <option value="password">パスワード</option>
              <option value="privateKey">秘密鍵</option>
            </select>
          </div>
          {ssh.authType === 'password' && (
            <div className={styles.formGroup}>
              <label htmlFor="ssh-password">SSHパスワード</label>
              <input
                id="ssh-password"
                type="password"
                value={ssh.password}
                onChange={(e) => onChange('password', e.target.value)}
              />
            </div>
          )}
          {ssh.authType === 'privateKey' && (
            <>
              <div className={styles.formGroup}>
                <label htmlFor="ssh-private-key-path">秘密鍵のパス</label>
                <div className={styles.inputWithButton}>
                  <input
                    id="ssh-private-key-path"
                    type="text"
                    value={ssh.privateKeyPath}
                    onChange={(e) => onChange('privateKeyPath', e.target.value)}
                    placeholder="C:\Users\...\.ssh\id_rsa"
                  />
                  <button
                    type="button"
                    className={styles.browseButton}
                    onClick={async () => {
                      try {
                        const result = await ioProvider.browseFile(
                          '秘密鍵ファイル (*.pem;*.ppk;id_*)|*.pem;*.ppk;id_*|すべてのファイル (*.*)|*.*'
                        );
                        if (result.filePath) {
                          onChange('privateKeyPath', result.filePath);
                        }
                      } catch {
                        // ユーザーがダイアログをキャンセル
                      }
                    }}
                  >
                    ...
                  </button>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="ssh-key-passphrase">パスフレーズ（任意）</label>
                <input
                  id="ssh-key-passphrase"
                  type="password"
                  value={ssh.keyPassphrase}
                  onChange={(e) => onChange('keyPassphrase', e.target.value)}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
