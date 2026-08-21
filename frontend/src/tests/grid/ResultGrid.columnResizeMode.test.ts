import { describe, expect, it } from 'vite-plus/test';
import { COLUMN_RESIZE_MODE } from '../../components/grid/ResultGrid';

// Issue: drag resize 応答性が非常に悪い問題。
// columnResizeMode='onChange' は drag 中毎frame setColumnSizing を呼び、
// ResultGrid 全体 (thead, colgroup, virtualized tbody) を re-render させる。
// WebView2 の software compositing 遅延と合わさり体感を著しく悪化させる。
// 'onEnd' に変更することで state 更新は mouseup 時のみになり、
// drag 中の re-render を排除できる。
//
// ソース文字列 match (?raw import) は prettier/コメント変更で壊れる fragile な
// 検証だったため、export した定数値を直接検証する形に変更した。
//
// TODO (Phase 2): drag 中の視覚フィードバック (columnSizingInfo.deltaOffset による
// overlay 縦線) 実装時に、mousedown→mousemove→mouseup の実挙動を Playwright E2E
// で検証する (frontend/e2e/column-resize-performance.spec.ts)。実挙動テストは
// TanStack Table の内部 document listener を経由するため jsdom では再現困難。
describe('ResultGrid columnResizeMode (drag resize performance)', () => {
  it("COLUMN_RESIZE_MODE は 'onEnd' を維持 (onChange への回帰禁止)", () => {
    expect(COLUMN_RESIZE_MODE).toBe('onEnd');
  });
});
