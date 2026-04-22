import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bridge } from '../../api/bridge';
import { SettingsDialog } from '../../components/dialogs/SettingsDialog';

vi.mock('../../api/bridge', () => ({
  bridge: {
    updateSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('SettingsDialog', () => {
  const defaultProps = {
    isOpen: true as boolean,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(bridge.updateSettings).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getTimeoutInput(): HTMLInputElement {
    return screen.getByLabelText('クエリタイムアウト (秒)') as HTMLInputElement;
  }

  it('isOpen=false時に非表示', () => {
    const { container } = render(<SettingsDialog {...defaultProps} isOpen={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('isOpen=true時に表示', () => {
    render(<SettingsDialog {...defaultProps} />);
    expect(screen.getByText('設定')).toBeInTheDocument();
  });

  it('Escapeキーでダイアログが閉じる', () => {
    const onClose = vi.fn();
    render(<SettingsDialog {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('isOpen=false時にEscapeキーでonCloseが発火しない', () => {
    const onClose = vi.fn();
    render(<SettingsDialog {...defaultProps} isOpen={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('overlayクリックでonCloseが発火', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsDialog {...defaultProps} onClose={onClose} />);
    if (!(container.firstChild instanceof Element)) throw new Error('overlay not found');
    fireEvent.click(container.firstChild);
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe('クエリタイムアウト (issue #373)', () => {
    it('デフォルト300秒が秒単位で表示される (defaultSettings.timeout=300000ms)', () => {
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('クエリ'));

      const input = getTimeoutInput();
      expect(input.value).toBe('300');
      expect(input.min).toBe('1');
      expect(input.max).toBe('3600');
    });

    it('入力値変更で内部状態がms単位で保持される (秒→ms変換)', () => {
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('クエリ'));

      const input = getTimeoutInput();
      fireEvent.change(input, { target: { value: '600' } });
      expect(input.value).toBe('600');

      fireEvent.click(screen.getByText('保存'));
      // 保存時は秒単位で Backend へ同期される (Backend の clamp 1-3600 と整合)
      expect(bridge.updateSettings).toHaveBeenCalledWith({
        query: { timeoutSeconds: 600 },
      });
    });

    it('localStorage に保存された旧値 (30000ms) は秒単位で30と表示される (後方互換)', () => {
      localStorage.setItem(
        'app-settings',
        JSON.stringify({ query: { autoCommit: true, timeout: 30000, maxRows: 10000 } })
      );

      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('クエリ'));

      const input = getTimeoutInput();
      expect(input.value).toBe('30');
    });

    it('上限値3600を入力した場合も保存できる (Backend clamp 上限と整合)', () => {
      render(<SettingsDialog {...defaultProps} />);
      fireEvent.click(screen.getByText('クエリ'));

      const input = getTimeoutInput();
      fireEvent.change(input, { target: { value: '3600' } });
      fireEvent.click(screen.getByText('保存'));
      expect(bridge.updateSettings).toHaveBeenCalledWith({
        query: { timeoutSeconds: 3600 },
      });
    });
  });
});
