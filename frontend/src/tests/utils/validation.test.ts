import { describe, expect, it } from 'vite-plus/test';
import type { RowChange } from '../../store/editStore';
import type { Column } from '../../types';
import { validateNullConstraints } from '../../utils/validation';

const makeColumns = (defs: { name: string; nullable: boolean }[]): Column[] =>
  defs.map((d) => ({
    name: d.name,
    type: 'varchar',
    size: 255,
    nullable: d.nullable,
    isPrimaryKey: false,
  }));

describe('validateNullConstraints', () => {
  const columns = makeColumns([
    { name: 'id', nullable: false },
    { name: 'name', nullable: false },
    { name: 'description', nullable: true },
  ]);

  describe('UPDATE (pendingChanges)', () => {
    it('NOT NULLカラムにNULL代入でエラー検出', () => {
      const pendingChanges = new Map<number, RowChange>([
        [
          0,
          {
            type: 'update',
            rowIndex: 0,
            originalData: { id: '1', name: 'old', description: 'text' },
            changes: {
              name: {
                rowIndex: 0,
                columnName: 'name',
                originalValue: 'old',
                newValue: null,
              },
            },
          },
        ],
      ]);

      const errors = validateNullConstraints(columns, pendingChanges, new Map());
      expect(errors.size).toBe(1);
      const error = errors.get('0:name');
      expect(error).toBeDefined();
      expect(error?.columnName).toBe('name');
      expect(error?.message).toContain('NULL');
    });

    it('NULLABLEカラムにNULL代入はエラーなし', () => {
      const pendingChanges = new Map<number, RowChange>([
        [
          0,
          {
            type: 'update',
            rowIndex: 0,
            originalData: { id: '1', name: 'old', description: 'text' },
            changes: {
              description: {
                rowIndex: 0,
                columnName: 'description',
                originalValue: 'text',
                newValue: null,
              },
            },
          },
        ],
      ]);

      const errors = validateNullConstraints(columns, pendingChanges, new Map());
      expect(errors.size).toBe(0);
    });

    it('値ありの変更はエラーなし', () => {
      const pendingChanges = new Map<number, RowChange>([
        [
          0,
          {
            type: 'update',
            rowIndex: 0,
            originalData: { id: '1', name: 'old', description: 'text' },
            changes: {
              name: {
                rowIndex: 0,
                columnName: 'name',
                originalValue: 'old',
                newValue: 'new',
              },
            },
          },
        ],
      ]);

      const errors = validateNullConstraints(columns, pendingChanges, new Map());
      expect(errors.size).toBe(0);
    });
  });

  describe('INSERT (insertedRows)', () => {
    it('NOT NULLカラムがNULLでエラー検出', () => {
      const insertedRows = new Map<number, Record<string, string | null>>([
        [-1, { id: null, name: null, description: null }],
      ]);

      const errors = validateNullConstraints(columns, new Map(), insertedRows);
      expect(errors.size).toBe(2);
      expect(errors.has('-1:id')).toBe(true);
      expect(errors.has('-1:name')).toBe(true);
      expect(errors.has('-1:description')).toBe(false);
    });

    it('NOT NULLカラムに値ありはエラーなし', () => {
      const insertedRows = new Map<number, Record<string, string | null>>([
        [-1, { id: '1', name: 'test', description: null }],
      ]);

      const errors = validateNullConstraints(columns, new Map(), insertedRows);
      expect(errors.size).toBe(0);
    });
  });

  describe('複合ケース', () => {
    it('複数セルに同時エラー', () => {
      const pendingChanges = new Map<number, RowChange>([
        [
          0,
          {
            type: 'update',
            rowIndex: 0,
            originalData: { id: '1', name: 'old', description: 'text' },
            changes: {
              name: {
                rowIndex: 0,
                columnName: 'name',
                originalValue: 'old',
                newValue: null,
              },
            },
          },
        ],
      ]);
      const insertedRows = new Map<number, Record<string, string | null>>([
        [-1, { id: null, name: 'test', description: null }],
      ]);

      const errors = validateNullConstraints(columns, pendingChanges, insertedRows);
      expect(errors.size).toBe(2);
      expect(errors.has('0:name')).toBe(true);
      expect(errors.has('-1:id')).toBe(true);
    });

    it('変更なしの場合はエラーなし', () => {
      const errors = validateNullConstraints(columns, new Map(), new Map());
      expect(errors.size).toBe(0);
    });
  });
});
