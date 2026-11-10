import { memo, useContext } from 'react';
import { ERCanvasBackgroundContext } from '../../store/erDiagramStore';
import { blendWithBackground, hexToRgba, readableColor } from '../../utils/colorContrast';
import styles from './ShapeNode.module.css';

interface ShapeNodeData {
  shapeType: string;
  text: string;
  fillColor?: string;
  fontColor?: string;
  fillAlpha: number;
  fontSize: number;
  width: number;
  height: number;
}

interface ShapeNodeProps {
  data: ShapeNodeData;
}

export const ShapeNode = memo(function ShapeNode({ data }: ShapeNodeProps) {
  const { shapeType, text, fillColor, fontColor, fillAlpha, fontSize, width, height } = data;
  const canvasBackground = useContext(ERCanvasBackgroundContext);
  const isRound = shapeType === 'roundrect';

  const backgroundColor = fillColor ? hexToRgba(fillColor, fillAlpha) : 'transparent';

  // Preserve imported text colors when they remain readable on the rendered background.
  const effectiveBackground = fillColor
    ? blendWithBackground(fillColor, fillAlpha, canvasBackground)
    : canvasBackground;
  const textColor = readableColor(effectiveBackground, fontColor);

  return (
    <div
      className={styles.container}
      style={{
        width: width || undefined,
        height: height || undefined,
        backgroundColor,
        borderRadius: isRound ? 8 : 0,
        color: textColor,
        fontSize: fontSize || 9,
      }}
    >
      {text && (
        <span className={styles.text} style={{ backgroundColor: effectiveBackground }}>
          {text}
        </span>
      )}
    </div>
  );
});
