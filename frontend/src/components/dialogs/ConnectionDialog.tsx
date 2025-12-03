import { useState } from 'react';
import { bridge } from '../../api/bridge';
import styles from './ConnectionDialog.module.css';

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => void;
}

export interface ConnectionConfig {
  name: string;
  server: string;
  port: number;
  database: string;
  username: string;
  password: string;
  useWindowsAuth: boolean;
}

export function ConnectionDialog({ isOpen, onClose, onConnect }: ConnectionDialogProps) {
  const [config, setConfig] = useState<ConnectionConfig>({
    name: 'New Connection',
    server: 'localhost',
    port: 1433,
    database: 'master',
    username: '',
    password: '',
    useWindowsAuth: true,
  });

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  if (!isOpen) return null;

  const handleChange = (field: keyof ConnectionConfig, value: string | number | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await bridge.testConnection({
        server: `${config.server},${config.port}`,
        database: config.database,
        username: config.username,
        password: config.password,
        useWindowsAuth: config.useWindowsAuth,
      });

      if (response.success) {
        setTestResult({ success: true, message: response.message || 'Connection successful!' });
      } else {
        setTestResult({ success: false, message: response.message || 'Connection failed' });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  const handleConnect = () => {
    onConnect(config);
    onClose();
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2>New Connection</h2>
          <button className={styles.closeButton} onClick={onClose}>
            &times;
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.formGroup}>
            <label>Connection Name</label>
            <input
              type="text"
              value={config.name}
              onChange={(e) => handleChange('name', e.target.value)}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Server</label>
            <input
              type="text"
              value={config.server}
              onChange={(e) => handleChange('server', e.target.value)}
              placeholder="localhost or hostname"
            />
          </div>

          <div className={styles.formGroup}>
            <label>Port</label>
            <input
              type="number"
              value={config.port}
              onChange={(e) => handleChange('port', Number.parseInt(e.target.value) || 1433)}
            />
          </div>

          <div className={styles.formGroup}>
            <label>Database</label>
            <input
              type="text"
              value={config.database}
              onChange={(e) => handleChange('database', e.target.value)}
              placeholder="master"
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={config.useWindowsAuth}
                onChange={(e) => handleChange('useWindowsAuth', e.target.checked)}
              />
              Use Windows Authentication
            </label>
          </div>

          {!config.useWindowsAuth && (
            <>
              <div className={styles.formGroup}>
                <label>Username</label>
                <input
                  type="text"
                  value={config.username}
                  onChange={(e) => handleChange('username', e.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label>Password</label>
                <input
                  type="password"
                  value={config.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                />
              </div>
            </>
          )}

          {testResult && (
            <div
              className={`${styles.testResult} ${testResult.success ? styles.success : styles.error}`}
            >
              {testResult.message}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.testButton} onClick={handleTestConnection} disabled={testing}>
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <div className={styles.spacer} />
          <button className={styles.cancelButton} onClick={onClose}>
            Cancel
          </button>
          <button className={styles.connectButton} onClick={handleConnect}>
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
