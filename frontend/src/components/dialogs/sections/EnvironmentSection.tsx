import type { ConnectionConfig } from '../ConnectionDialog';
import styles from '../ConnectionDialog.module.css';

interface EnvironmentSectionProps {
  isProduction: boolean;
  isReadOnly: boolean;
  onChange: (field: keyof ConnectionConfig, value: boolean) => void;
}

export function EnvironmentSection({
  isProduction,
  isReadOnly,
  onChange,
}: EnvironmentSectionProps) {
  return (
    <div className={styles.productionSection}>
      <div className={styles.sectionHeader}>環境設定</div>
      <div className={styles.formGroup}>
        <label className={`${styles.checkboxLabel} ${styles.productionCheckbox}`}>
          <input
            type="checkbox"
            checked={isProduction}
            onChange={(e) => onChange('isProduction', e.target.checked)}
          />
          本番環境
        </label>
        <span className={styles.hint}>安全警告と視覚的インジケーターを有効化</span>
      </div>
      {isProduction && (
        <div className={styles.formGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={isReadOnly}
              onChange={(e) => onChange('isReadOnly', e.target.checked)}
            />
            読み取り専用モード
          </label>
          <span className={styles.hint}>データ変更を禁止（INSERT, UPDATE, DELETE）</span>
        </div>
      )}
    </div>
  );
}
