import '@testing-library/jest-dom';

// Mock window.invoke for tests
Object.defineProperty(window, 'invoke', {
  value: undefined,
  writable: true,
});

// Mock ResizeObserver
Object.defineProperty(globalThis, 'ResizeObserver', {
  value: class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  writable: true,
});

// Mock HTMLCanvasElement.getContext('2d') for useColumnAutoSize.
// jsdom の canvas は 2d context を null で返すため measureText 依存の列幅計算を
// 再現できない。font サイズから大雑把な width を返すダミー context を返す。
//
// 制約: `width = text.length * fontSize * 0.6` は monospace では妥当だが、
// 比例フォント (system-ui 等) の文字別幅差や太字 (font-weight 600) による幅増加は
// 再現しない。ヘッダー幅計測 (HEADER_FONT) が本番で想定外に大きくなる回帰は
// このテストでは検出できないことに注意する。
const originalGetContext = HTMLCanvasElement.prototype.getContext;
function mock2dContext() {
  let font = '10px sans-serif';
  return {
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    measureText(text: string) {
      const sizeMatch = /(\d+)px/.exec(font);
      const fontSize = sizeMatch ? Number(sizeMatch[1]) : 10;
      return { width: text.length * fontSize * 0.6 };
    },
  };
}
// biome-ignore lint/suspicious/noExplicitAny: overload dispatch
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]): any {
  if (args[0] === '2d') return mock2dContext();
  // biome-ignore lint/suspicious/noExplicitAny: overload dispatch
  return (originalGetContext as any).apply(this, args);
};
