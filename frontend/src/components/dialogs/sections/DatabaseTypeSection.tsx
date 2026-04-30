import type { DatabaseType } from '../../../types';
import type { ConnectionConfig } from '../../../types/connectionForm';
import styles from '../ConnectionDialog.module.css';

interface DatabaseTypeSectionProps {
  dbType: DatabaseType;
  onChange: (field: keyof ConnectionConfig, value: DatabaseType | number) => void;
}

const DB_TYPE_OPTIONS: { value: DatabaseType; label: string; defaultPort: number }[] = [
  { value: 'sqlserver', label: 'SQL Server', defaultPort: 1433 },
  { value: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
];

export function DatabaseTypeSection({ dbType, onChange }: DatabaseTypeSectionProps) {
  const handleDbTypeChange = (newDbType: DatabaseType) => {
    onChange('dbType', newDbType);
    // デフォルトポートを設定
    const option = DB_TYPE_OPTIONS.find((o) => o.value === newDbType);
    if (option) {
      onChange('port', option.defaultPort);
    }
  };

  return (
    <div className={styles.formGroup}>
      <div className={styles.sectionHeader}>データベース種別</div>
      <div className={styles.dbTypeRadioGroup}>
        {DB_TYPE_OPTIONS.map((option) => (
          <label
            key={option.value}
            className={`${styles.dbTypeRadio} ${dbType === option.value ? styles.selected : ''}`}
          >
            <input
              type="radio"
              name="dbType"
              value={option.value}
              checked={dbType === option.value}
              onChange={() => handleDbTypeChange(option.value)}
            />
            <span className={styles.dbTypeLabel}>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
