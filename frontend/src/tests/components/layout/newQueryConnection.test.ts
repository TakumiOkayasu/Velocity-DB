import { describe, expect, it } from 'vite-plus/test';
import { resolveNewQueryConnectionId } from '../../../components/layout/newQueryConnection';

describe('resolveNewQueryConnectionId', () => {
  it('uses active query tab connection when present', () => {
    expect(resolveNewQueryConnectionId('tab-conn', 'store-conn')).toBe('tab-conn');
  });

  it('falls back to connection store active id when tab connection is null', () => {
    expect(resolveNewQueryConnectionId(null, 'store-conn')).toBe('store-conn');
  });

  it('falls back to connection store active id when tab connection is undefined', () => {
    expect(resolveNewQueryConnectionId(undefined, 'store-conn')).toBe('store-conn');
  });

  it('returns null when both are null', () => {
    expect(resolveNewQueryConnectionId(null, null)).toBeNull();
  });

  it('returns null when both are undefined', () => {
    expect(resolveNewQueryConnectionId(undefined, undefined)).toBeNull();
  });

  it('prefers tab connection even when store has different active id', () => {
    expect(resolveNewQueryConnectionId('tab-conn', 'different-conn')).toBe('tab-conn');
  });
});
