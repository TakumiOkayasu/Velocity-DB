import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { BooleanCell, isBooleanType } from '../../components/grid/BooleanCell';

afterEach(cleanup);

describe('BooleanCell (#719)', () => {
  it.each(['boolean', 'bool', 'BOOLEAN'])('recognizes %s metadata', (type) => {
    expect(isBooleanType(type)).toBe(true);
  });

  it.each(['text', 'bit', 'bit(1)', 'tinyint', 'boolean[]'])('leaves %s columns alone', (type) => {
    expect(isBooleanType(type)).toBe(false);
  });

  it.each([
    ['t', true],
    ['f', false],
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
  ] as const)('displays %s without changing the underlying value', (value, checked) => {
    render(<BooleanCell value={value} label="enabled" />);
    const input = screen.getByRole('checkbox') as HTMLInputElement;
    expect(input.checked).toBe(checked);
    expect(input.disabled).toBe(true);
  });

  it.each([
    ['t', 'f'],
    ['f', 't'],
    ['true', 'false'],
    ['false', 'true'],
    ['1', '0'],
    ['0', '1'],
  ] as const)('toggles %s to %s through the edit callback', (value, next) => {
    const onChange = vi.fn();
    render(<BooleanCell value={value} label="enabled" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(next);
  });

  it('distinguishes NULL from false and allows setting it to true', () => {
    const onChange = vi.fn();
    render(<BooleanCell value={null} label="enabled" onChange={onChange} />);
    const input = screen.getByRole('checkbox', { name: 'enabled: NULL' }) as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
    expect(screen.getByText('NULL')).toBeTruthy();
    fireEvent.click(input);
    expect(onChange).toHaveBeenCalledExactlyOnceWith('t');
  });

  it('keeps an unrecognized edited value visible', () => {
    render(<BooleanCell value="invalid" label="enabled" onChange={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('invalid')).toBeTruthy();
  });
});
