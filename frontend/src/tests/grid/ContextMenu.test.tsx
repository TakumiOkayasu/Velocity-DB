import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { ContextMenu } from '../../components/common/ContextMenu';

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  container.style.cssText = 'contain: strict;';
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  cleanup();
});

describe('ContextMenu', () => {
  it('createPortalでdocument.bodyにレンダリングされる', () => {
    render(
      <ContextMenu
        x={100}
        y={200}
        items={[{ label: 'テスト項目', action: vi.fn() }]}
        onClose={vi.fn()}
      />,
      { container }
    );

    // container内にはメニューが存在しない（portalで外に出ているため）
    expect(container.querySelector('[class*="container"]')).toBeNull();
    // document.body直下にメニューが存在する
    expect(screen.getByText('テスト項目')).toBeTruthy();
  });
});
