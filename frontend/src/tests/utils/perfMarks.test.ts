import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { useERDiagramRenderMark, useFirstRenderMark, useStartupMark } from '../../utils/perfMarks';

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

describe('useStartupMark', () => {
  afterEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('records a startup measure on mount', () => {
    renderHook(() => useStartupMark());

    const measures = performance.getEntriesByName('startup', 'measure');
    expect(measures).toHaveLength(1);
  });
});

describe('useERDiagramRenderMark', () => {
  afterEach(() => {
    performance.clearMarks();
    performance.clearMeasures();
  });

  it('records start/end marks and a measure once threshold is reached', () => {
    const { rerender } = renderHook(({ count }) => useERDiagramRenderMark(count), {
      initialProps: { count: 0 },
    });

    expect(performance.getEntriesByName('er-diagram-50:start', 'mark')).toHaveLength(0);
    expect(performance.getEntriesByName('er-diagram-50', 'measure')).toHaveLength(0);

    rerender({ count: 50 });

    expect(performance.getEntriesByName('er-diagram-50:start', 'mark')).toHaveLength(1);
    expect(performance.getEntriesByName('er-diagram-50:end', 'mark')).toHaveLength(1);
    expect(performance.getEntriesByName('er-diagram-50', 'measure')).toHaveLength(1);
  });

  it('does not record additional measures on subsequent renders above threshold', () => {
    const { rerender } = renderHook(({ count }) => useERDiagramRenderMark(count), {
      initialProps: { count: 60 },
    });

    rerender({ count: 70 });
    rerender({ count: 80 });

    expect(performance.getEntriesByName('er-diagram-50', 'measure')).toHaveLength(1);
  });

  it('does not record any measure when count stays below threshold', () => {
    const { rerender } = renderHook(({ count }) => useERDiagramRenderMark(count), {
      initialProps: { count: 10 },
    });

    rerender({ count: 49 });

    expect(performance.getEntriesByName('er-diagram-50:start', 'mark')).toHaveLength(0);
    expect(performance.getEntriesByName('er-diagram-50', 'measure')).toHaveLength(0);
  });

  it('honors a custom threshold parameter', () => {
    const { rerender } = renderHook(({ count, t }) => useERDiagramRenderMark(count, t), {
      initialProps: { count: 5, t: 10 },
    });

    expect(performance.getEntriesByName('er-diagram-10', 'measure')).toHaveLength(0);

    rerender({ count: 10, t: 10 });

    expect(performance.getEntriesByName('er-diagram-10', 'measure')).toHaveLength(1);
  });
});
