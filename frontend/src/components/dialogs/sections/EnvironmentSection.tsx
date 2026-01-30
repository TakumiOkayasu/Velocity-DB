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
      <div className={styles.sectionHeader}>Environment Settings</div>
      <div className={styles.formGroup}>
        <label className={`${styles.checkboxLabel} ${styles.productionCheckbox}`}>
          <input
            type="checkbox"
            checked={isProduction}
            onChange={(e) => onChange('isProduction', e.target.checked)}
          />
          Production Environment
        </label>
        <span className={styles.hint}>Enables safety warnings and visual indicators</span>
      </div>
      {isProduction && (
        <div className={styles.formGroup}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={isReadOnly}
              onChange={(e) => onChange('isReadOnly', e.target.checked)}
            />
            Read-Only Mode
          </label>
          <span className={styles.hint}>Prevents data modifications (INSERT, UPDATE, DELETE)</span>
        </div>
      )}
    </div>
  );
}
