import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';
import { ShapeNode } from '../../components/diagram/ShapeNode';
import { ERCanvasBackgroundContext } from '../../store/erDiagramStore';
import { blendWithBackground, contrastRatio, WCAG_AA } from '../../utils/colorContrast';

const data = {
  shapeType: 'rect',
  text: 'Synthetic label',
  fontColor: '#000000',
  fillAlpha: 0,
  fontSize: 12,
  width: 300,
  height: 120,
};

function renderShape(fillColor?: string, fillAlpha = 0) {
  const view = (background: string) => (
    <ERCanvasBackgroundContext.Provider value={background}>
      <ShapeNode data={{ ...data, fillColor, fillAlpha }} />
    </ERCanvasBackgroundContext.Provider>
  );
  const { rerender } = render(view('#1e1f22'));
  const shape = screen.getByText('Synthetic label').parentElement;
  if (!shape) throw new Error('Shape container missing');
  return { shape, setBackground: (color: string) => rerender(view(color)) };
}

describe('ER shape text contrast', () => {
  it('corrects black on a transparent dark canvas and restores black on a white canvas', () => {
    const { setBackground, shape } = renderShape();
    expect(screen.getByText('Synthetic label')).toHaveStyle({ backgroundColor: '#1e1f22' });
    expect(shape).toHaveStyle({ color: '#ffffff' });
    expect(shape.style.backgroundColor).toBe('transparent');
    setBackground('#ffffff');
    expect(shape).toHaveStyle({ color: '#000000' });
    expect(screen.getByText('Synthetic label')).toHaveStyle({ backgroundColor: '#ffffff' });
    expect(shape.style.backgroundColor).toBe('transparent');
  });

  it('uses the blended fill and selected canvas for semi-transparent shapes', () => {
    const { setBackground, shape } = renderShape('#000000', 128);
    setBackground('#ffffff');
    const background = blendWithBackground('#000000', 128, '#ffffff');
    expect(contrastRatio(background, '#000000')).toBeGreaterThanOrEqual(WCAG_AA);
    expect(shape).toHaveStyle({ color: '#000000' });
    setBackground('#1e1f22');
    expect(shape).toHaveStyle({ color: '#ffffff' });
  });
});
