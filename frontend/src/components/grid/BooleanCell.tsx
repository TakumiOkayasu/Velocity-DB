import styles from './BooleanCell.module.css';

export function isBooleanType(type: string): boolean {
  return /^(boolean|bool)$/i.test(type.trim());
}

interface BooleanCellProps {
  value: string | null;
  label: string;
  onChange?: (value: string) => void;
}

export function BooleanCell({ value, label, onChange }: BooleanCellProps) {
  const normalized = value?.toLowerCase();
  const checked = normalized === 't' || normalized === 'true' || normalized === '1';
  const isFalse = normalized === 'f' || normalized === 'false' || normalized === '0';
  if (value !== null && !checked && !isFalse) return <>{value}</>;

  const state = value === null ? 'NULL' : checked ? 'TRUE' : 'FALSE';
  return (
    <span className={styles.cell}>
      <input
        type="checkbox"
        aria-label={`${label}: ${state}`}
        title={`${label}: ${state}`}
        checked={checked}
        disabled={!onChange}
        ref={(input) => {
          if (input) input.indeterminate = value === null;
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const next = event.target.checked;
          let encoded = next ? 't' : 'f';
          if (normalized === '1' || normalized === '0') encoded = next ? '1' : '0';
          if (normalized === 'true' || normalized === 'false') encoded = next ? 'true' : 'false';
          onChange?.(encoded);
        }}
      />
      {value === null && <span>NULL</span>}
    </span>
  );
}
