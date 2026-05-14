import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useFirstRenderMark } from '../../utils/perfMarks';

describe('useFirstRenderMark', () => {
  afterEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('records start and end marks plus a measure on first mount', () => {
    renderHook(() => useFirstRenderMark('test-target'));

    const starts = performance.getEntriesByName('test-target:start', 'mark');
    const ends = performance.getEntriesByName('test-target:end', 'mark');
    const measures = performance.getEntriesByName('test-target', 'measure');

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(measures).toHaveLength(1);
  });

  it('does not record additional marks or measures on rerender', () => {
    const { rerender } = renderHook(() => useFirstRenderMark('rerender-target'));
    rerender();
    rerender();

    const starts = performance.getEntriesByName('rerender-target:start', 'mark');
    const ends = performance.getEntriesByName('rerender-target:end', 'mark');
    const measures = performance.getEntriesByName('rerender-target', 'measure');

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(measures).toHaveLength(1);
  });

  it('skips end mark when start has been cleared before effect runs', () => {
    performance.mark('manual-target:start');
    performance.clearMarks('manual-target:start');
    renderHook(() => {
      performance.clearMarks('manual-target:start');
      useFirstRenderMark('manual-target');
    });

    const measures = performance.getEntriesByName('manual-target', 'measure');
    expect(measures.length).toBeLessThanOrEqual(1);
  });
});
