import { useState } from 'react';
import { bridge } from '../../api/bridge';
import { useDialogKeyboard } from '../../hooks/useDialogKeyboard';
import type { DatabaseType, EnvironmentType, SshAuthType } from '../../types';
import { connectionColor } from '../../utils/colorContrast';
import styles from './ConnectionDialog.module.css';
import { useConnectionProfile } from './hooks/useConnectionProfile';
import { QueryConfirmDialog } from './QueryConfirmDialog';
import { ConnectionFormSection } from './sections/ConnectionFormSection';
import { DatabaseTypeSection } from './sections/DatabaseTypeSection';
import { EnvironmentSection } from './sections/EnvironmentSection';
import { SshTunnelSection } from './sections/SshTunnelSection';

interface ConnectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (config: ConnectionConfig) => void;
  isConnecting?: boolean;
  onCancelConnect?: () => void;
}

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
  ssh: SshConfig;
}

export function ConnectionDialog({
  isOpen,
  onClose,
  onConnect,
  isConnecting = false,
  onCancelConnect,
}: ConnectionDialogProps) {
  const {
    profiles,
    mode,
    editingProfileId,
    config,
    savePassword,
    testResult,
    setConfig,
    setSavePassword,
    setTestResult,
    handleProfileSelect,
    handleNewProfile,
    handleSaveProfile,
    handleDeleteProfile,
    confirmDeleteProfile,
    cancelDeleteProfile,
    deleteConfirmOpen,
    handleCopyProfile,
  } = useConnectionProfile(isOpen);
  useDialogKeyboard({
    isOpen,
    onEscape: deleteConfirmOpen ? undefined : onClose,
  });

  const [testing, setTesting] = useState(false);

  if (!isOpen) return null;

  const handleChange = (field: keyof ConnectionConfig, value: string | number | boolean) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  const handleSshChange = (field: keyof SshConfig, value: string | number | boolean) => {
    setConfig((prev) => ({
      ...prev,
      ssh: { ...prev.ssh, [field]: value },
    }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const response = await bridge.testConnection({
        server: config.server,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
        useWindowsAuth: config.useWindowsAuth,
        dbType: config.dbType,
        ssh: config.ssh.enabled
          ? {
              enabled: true,
              host: config.ssh.host,
              port: config.ssh.port,
              username: config.ssh.username,
              authType: config.ssh.authType,
              password: config.ssh.password,
              privateKeyPath: config.ssh.privateKeyPath,
              keyPassphrase: config.ssh.keyPassphrase,
            }
          : undefined,
      });

      if (response.success) {
        setTestResult({
          success: true,
          message: response.message || '接続成功',
        });
      } else {
        setTestResult({
          success: false,
          message: response.message || '接続失敗',
        });
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
  };

  return (
    <div className={styles.overlay}>
      <button
        type="button"
        className={styles.backdrop}
        onClick={deleteConfirmOpen ? undefined : onClose}
        tabIndex={-1}
        aria-label="ダイアログを閉じる"
      />
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2>DB接続</h2>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            {'\u00D7'}
          </button>
        </div>

        <div className={styles.body}>
          {/* Left: Saved Profiles */}
          <div className={styles.profileList}>
            <div className={styles.profileListHeader}>
              <span>保存済み接続</span>
              <button
                type="button"
                className={styles.profileAddButton}
                onClick={handleNewProfile}
                title="新規接続"
              >
                +
              </button>
            </div>
            <div className={styles.profileItems}>
              {profiles.map((profile) => {
                const connColor = connectionColor(profile.server, profile.database);
                return (
                  <button
                    type="button"
                    key={profile.id}
                    className={`${styles.profileItem} ${mode === 'edit' && editingProfileId === profile.id ? styles.selected : ''}`}
                    style={
                      {
                        '--connection-color': connColor,
                      } as React.CSSProperties
                    }
                    onClick={() => handleProfileSelect(profile.id)}
                  >
                    <span className={styles.profileIcon}>🗄️</span>
                    <div className={styles.profileInfo}>
                      <span className={styles.profileName}>{profile.name}</span>
                      <span className={styles.profileServer}>
                        {profile.server}/{profile.database}
                      </span>
                    </div>
                  </button>
                );
              })}
              {profiles.length === 0 && <div className={styles.noProfiles}>保存済み接続なし</div>}
            </div>
          </div>

          {/* Right: Connection Form */}
          <div className={styles.content}>
            <div className={styles.formModeIndicator}>
              {mode === 'new' ? '新規接続' : '接続を編集'}
            </div>

            <DatabaseTypeSection dbType={config.dbType} onChange={handleChange} />

            <ConnectionFormSection
              config={config}
              savePassword={savePassword}
              onChange={handleChange}
              onSavePasswordChange={setSavePassword}
            />

            <SshTunnelSection ssh={config.ssh} onChange={handleSshChange} />

            <EnvironmentSection
              environment={config.environment}
              isReadOnly={config.isReadOnly}
              onChange={handleChange}
            />

            {testResult && (
              <div
                className={`${styles.testResult} ${testResult.success ? styles.success : styles.error}`}
              >
                {testResult.message}
              </div>
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSaveProfile}
            title={mode === 'new' ? '新規プロファイルとして保存' : 'プロファイルを更新'}
          >
            {mode === 'new' ? '新規保存' : '保存'}
          </button>
          {mode === 'edit' && editingProfileId && (
            <>
              <button
                type="button"
                className={styles.copyButton}
                onClick={handleCopyProfile}
                title="接続プロファイルをコピー"
              >
                コピー
              </button>
              <button
                type="button"
                className={styles.deleteButton}
                onClick={handleDeleteProfile}
                title="接続プロファイルを削除"
              >
                削除
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.testButton}
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing ? 'テスト中...' : 'テスト'}
          </button>
          <div className={styles.spacer} />
          <button
            type="button"
            className={styles.cancelButton}
            onClick={() => {
              if (isConnecting) onCancelConnect?.();
              onClose();
            }}
          >
            キャンセル
          </button>
          <button
            type="button"
            className={styles.connectButton}
            onClick={isConnecting ? onCancelConnect : handleConnect}
            disabled={false}
          >
            {isConnecting ? '接続中止' : '接続'}
          </button>
        </div>
      </div>

      <QueryConfirmDialog
        isOpen={deleteConfirmOpen}
        title="接続プロファイルの削除"
        message={`「${config.name}」を削除しますか？この操作は元に戻せません。`}
        isDestructive
        confirmLabel="削除"
        cancelLabel="キャンセル"
        onConfirm={confirmDeleteProfile}
        onCancel={cancelDeleteProfile}
      />
    </div>
  );
}
