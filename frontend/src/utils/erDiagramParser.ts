import type { ERDiagramParseResult } from '../api/providers/schema';
import { DEFAULT_PAGE } from './erDiagramConstants';

// === 共通中間表現 ===

export interface ERDiagramModel {
  name: string;
  tables: ERDiagramTable[];
  relations: ERDiagramRelation[];
  shapes?: ERDiagramShape[];
}

export interface ERDiagramTable {
  name: string;
  logicalName: string;
  comment: string;
  page: string;
  posX: number;
  posY: number;
  columns: ERDiagramColumn[];
  indexes: ERDiagramIndex[];
  color?: string; // CSS #RRGGBB
  bkColor?: string; // CSS #RRGGBB
}

export interface ERDiagramColumn {
  name: string;
  logicalName: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  defaultValue: string;
  comment: string;
  color?: string; // CSS #RRGGBB
}

export interface ERDiagramIndex {
  name: string;
  isUnique: boolean;
  columns: string[];
}

export interface ERDiagramRelation {
  name: string;
  sourceTable: string;
  targetTable: string;
  sourceColumn: string;
  targetColumn: string;
  cardinality: '1:1' | '1:N' | 'N:M';
}

export interface ERDiagramShape {
  shapeType: string;
  text: string;
  fillColor?: string;
  fontColor?: string;
  fillAlpha: number;
  fontSize: number;
  left: number;
  top: number;
  width: number;
  height: number;
  page: string;
}

// === パーサーインターフェース ===

export interface ERDiagramParser {
  /** このパーサーが対応するファイル拡張子 */
  readonly extensions: string[];
  /** ファイル内容がこのパーサーで処理可能か判定 */
  canParse(content: string): boolean;
  /** パース実行 */
  parse(content: string, name?: string): ERDiagramModel;
}

// === パーサーレジストリ ===

const parsers: ERDiagramParser[] = [];

export function registerERDiagramParser(parser: ERDiagramParser): void {
  parsers.push(parser);
}

export function parseERDiagram(content: string, filename?: string): ERDiagramModel {
  // 1. filenameの拡張子でパーサー候補を絞る
  if (filename) {
    const rawExt = filename.split('.').pop()?.toLowerCase();
    if (rawExt) {
      const ext = `.${rawExt}`;
      for (const parser of parsers) {
        if (parser.extensions.includes(ext) && parser.canParse(content)) {
          return parser.parse(content, filename);
        }
      }
    }
  }

  // 2. 全パーサーでcanParse()判定
  for (const parser of parsers) {
    if (parser.canParse(content)) {
      return parser.parse(content, filename);
    }
  }

  throw new Error('対応するER図パーサーが見つかりません');
}

// === IPC レスポンス → ERDiagramModel 変換 ===

type Cardinality = '1:1' | '1:N' | 'N:M';

function toCardinality(value: string): Cardinality {
  if (value === '1:1' || value === '1:N' || value === 'N:M') return value;
  return '1:N';
}

/** ERDiagramParseResult → ERDiagramModel 変換 */
export function toERDiagramModel(
  result: ERDiagramParseResult,
  fallbackName?: string
): ERDiagramModel {
  return {
    name: result.name || fallbackName || '',
    tables: result.tables.map((t) => ({
      name: t.name,
      logicalName: t.logicalName,
      comment: t.comment,
      page: t.page || DEFAULT_PAGE,
      posX: t.posX,
      posY: t.posY,
      color: t.color || undefined,
      bkColor: t.bkColor || undefined,
      columns: t.columns.map((c) => ({
        name: c.name,
        logicalName: c.logicalName,
        type: c.type,
        nullable: c.nullable,
        isPrimaryKey: c.isPrimaryKey,
        defaultValue: c.defaultValue,
        comment: c.comment,
        color: c.color || undefined,
      })),
      indexes: t.indexes.map((idx) => ({
        name: idx.name,
        isUnique: idx.isUnique,
        columns: idx.columns,
      })),
    })),
    relations: result.relations.map((r) => ({
      name: r.name,
      sourceTable: r.parentTable,
      targetTable: r.childTable,
      sourceColumn: r.parentColumn,
      targetColumn: r.childColumn,
      cardinality: toCardinality(r.cardinality),
    })),
    shapes: result.shapes.map((s) => ({
      shapeType: s.shapeType,
      text: s.text,
      fillColor: s.fillColor || undefined,
      fontColor: s.fontColor || undefined,
      fillAlpha: s.fillAlpha,
      fontSize: s.fontSize,
      left: s.left,
      top: s.top,
      width: s.width,
      height: s.height,
      page: s.page || DEFAULT_PAGE,
    })),
  };
}
