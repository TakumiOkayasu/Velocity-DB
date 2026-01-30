import { bridge } from '../../../api/bridge';
import type { SshAuthType } from '../../../types';
import type { SshConfig } from '../ConnectionDialog';
import styles from '../ConnectionDialog.module.css';

interface SshTunnelSectionProps {
  ssh: SshConfig;
  onChange: (field: keyof SshConfig, value: string | number | boolean) => void;
}

export function SshTunnelSection({ ssh, onChange }: SshTunnelSectionProps) {
  return (
    <div className={styles.productionSection}>
      <div className={styles.sectionHeader}>SSH Tunnel</div>
      <div className={styles.formGroup}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={ssh.enabled}
            onChange={(e) => onChange('enabled', e.target.checked)}
          />
          Use SSH Tunnel
        </label>
        <span className={styles.hint}>Connect via SSH port forwarding</span>
      </div>
      {ssh.enabled && (
        <>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label>SSH Host</label>
              <input
                type="text"
                value={ssh.host}
                onChange={(e) => onChange('host', e.target.value)}
                placeholder="ssh.example.com"
              />
            </div>
            <div className={styles.formGroupSmall}>
              <label>SSH Port</label>
              <input
                type="number"
                value={ssh.port}
                onChange={(e) => onChange('port', Number.parseInt(e.target.value, 10) || 22)}
              />
            </div>
          </div>
          <div className={styles.formGroup}>
            <label>SSH Username</label>
            <input
              type="text"
              value={ssh.username}
              onChange={(e) => onChange('username', e.target.value)}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Authentication</label>
            <select
              value={ssh.authType}
              onChange={(e) => onChange('authType', e.target.value as SshAuthType)}
              className={styles.selectInput}
            >
              <option value="password">Password</option>
              <option value="privateKey">Private Key</option>
            </select>
          </div>
          {ssh.authType === 'password' && (
            <div className={styles.formGroup}>
              <label>SSH Password</label>
              <input
                type="password"
                value={ssh.password}
                onChange={(e) => onChange('password', e.target.value)}
              />
            </div>
          )}
          {ssh.authType === 'privateKey' && (
            <>
              <div className={styles.formGroup}>
                <label>Private Key Path</label>
                <div className={styles.inputWithButton}>
                  <input
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
                        const result = await bridge.browseFile(
                          'Private Key Files (*.pem;*.ppk;id_*)|*.pem;*.ppk;id_*|All Files (*.*)|*.*'
                        );
                        if (result.filePath) {
                          onChange('privateKeyPath', result.filePath);
                        }
                      } catch {
                        // User cancelled dialog
                      }
                    }}
                  >
                    ...
                  </button>
                </div>
              </div>
              <div className={styles.formGroup}>
                <label>Key Passphrase (optional)</label>
                <input
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
