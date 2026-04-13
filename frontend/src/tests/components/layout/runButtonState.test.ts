import { describe, expect, it } from 'vitest';
import { isRunButtonDisabled } from '../../../components/layout/runButtonState';
import type { Query } from '../../../types';

const baseQuery: Query = {
  id: 'q1',
  name: 'tab',
  content: 'SELECT 1',
  connectionId: 'c1',
  isDirty: false,
};

describe('isRunButtonDisabled', () => {
  it('enables when editor tab has content and connection', () => {
    expect(isRunButtonDisabled(baseQuery, 'c1')).toBe(false);
  });

  it('disables when no active query', () => {
    expect(isRunButtonDisabled(null, 'c1')).toBe(true);
  });

  it('disables when no connection', () => {
    expect(isRunButtonDisabled(baseQuery, null)).toBe(true);
  });

  it('disables on data view tab', () => {
    expect(isRunButtonDisabled({ ...baseQuery, isDataView: true }, 'c1')).toBe(true);
  });

  it('disables on ER diagram tab', () => {
    expect(isRunButtonDisabled({ ...baseQuery, isERDiagram: true }, 'c1')).toBe(true);
  });

  it('disables when content is empty', () => {
    expect(isRunButtonDisabled({ ...baseQuery, content: '' }, 'c1')).toBe(true);
  });

  it('disables when content is whitespace only', () => {
    expect(isRunButtonDisabled({ ...baseQuery, content: '   \n\t  ' }, 'c1')).toBe(true);
  });
});
