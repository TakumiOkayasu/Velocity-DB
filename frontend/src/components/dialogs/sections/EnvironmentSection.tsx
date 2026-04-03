import { type EnvironmentType, isEnvironmentType } from '../../../types';
import type { ConnectionConfig } from '../ConnectionDialog';
import styles from '../ConnectionDialog.module.css';

interface EnvironmentSectionProps {
  environment: EnvironmentType;
  isReadOnly: boolean;
  onChange: (field: keyof ConnectionConfig, value: EnvironmentType | boolean) => void;
}

const ENVIRONMENT_OPTIONS: { value: EnvironmentType; label: string; description: string }[] = [
  { value: 'development', label: '開発', description: '開発環境' },
  { value: 'staging', label: 'ステージング', description: 'テスト・検証環境' },
  { value: 'production', label: '本番', description: '本番環境（警告表示有効）' },
];

export function EnvironmentSection({ environment, isReadOnly, onChange }: EnvironmentSectionProps) {
  const isProduction = environment === 'production';

  return (
    <div className={styles.productionSection}>
      <div className={styles.sectionHeader}>環境設定</div>
      <div className={styles.formGroup}>
        <div className={styles.environmentRadioGroup}>
          {ENVIRONMENT_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`${styles.environmentRadio} ${environment === option.value ? styles.selected : ''} ${styles[`env-${option.value}`]}`}
            >
              <input
                type="radio"
                name="environment"
                value={option.value}
                checked={environment === option.value}
                onChange={(e) => {
                  if (!isEnvironmentType(e.target.value)) return;
                  onChange('environment', e.target.value);
                  onChange('isProduction', e.target.value === 'production');
                }}
              />
              <span className={styles.environmentLabel}>{option.label}</span>
              <span className={styles.environmentDescription}>{option.description}</span>
            </label>
          ))}
        </div>
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
