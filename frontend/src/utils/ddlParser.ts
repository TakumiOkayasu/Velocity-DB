// DDL パーサ (純関数層)。
// SQL テキスト (DDL ダンプ) から CREATE TABLE 文を抽出し、スキーマ比較 (utils/schemaDiff.ts)
// が受け取る SchemaTable[] へ変換する。SQL を実行せずファイルだけをスキーマ情報の
// ソースとして扱う「DDL データソース」(#261) の中核。
//
// 対応方言: SQL Server ([quoted]) / PostgreSQL・標準 SQL ("quoted") / MySQL (`quoted`)。
// コメント (-- / ネスト対応 block comment)・文字列リテラル・PostgreSQL のドル引用符を
// スキップし、FOREIGN KEY / UNIQUE / CHECK / INDEX 等の制約行と
// CREATE TABLE ... AS SELECT は無視する。型名は小文字へ正規化する
// (ODBC 経由の getColumns が返す型名表記に合わせるため)。

import type { Column } from '../types';
import { type SchemaTable, tableKey } from './schemaDiff';

interface Token {
  /** word: 生の単語 / number: 数値 / ident: クォート解除済み識別子 / string: 文字列 / punct: 記号 1 文字 */
  kind: 'word' | 'number' | 'ident' | 'string' | 'punct';
  text: string;
}

/**
 * コメントと文字列リテラルの中身を空白へ置換する前処理。
 * - `--` 行コメント / `/* *​/` ブロックコメント (ネスト対応) は全体を空白化
 * - `'...'` 文字列は中身のみ空白化 (両端のクォートは残しトークン境界を保持)。
 *   `''` の二重化と `\'` (MySQL) のエスケープに対応
 * - PostgreSQL のドル引用符 (`$$...$$` / `$tag$...$tag$`) は全体を空白化
 * - クォート識別子 (`"x"` / `` `x` `` / `[x]`) は原文のまま保持
 */
function sanitize(sql: string): string {
  const out = sql.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  };
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const ch = sql[i];
    const next = i + 1 < n ? sql[i + 1] : '';
    if (ch === '-' && next === '-') {
      const lineEnd = sql.indexOf('\n', i);
      const stop = lineEnd === -1 ? n : lineEnd;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (ch === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth += 1;
          j += 2;
        } else if (sql[j] === '*' && sql[j + 1] === '/') {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === '\\') {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (j + 1 < n && sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      blank(i + 1, j);
      i = closed ? j + 1 : n;
      continue;
    }
    if (ch === '$' && !/[A-Za-z0-9_$]/.test(i > 0 ? sql[i - 1] : '')) {
      const m = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const j = close === -1 ? n : close + tag.length;
        blank(i, j);
        i = j;
        continue;
      }
    }
    if (ch === '"' || ch === '`') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === ch) {
          if (j + 1 < n && sql[j + 1] === ch) {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      i = closed ? j + 1 : n;
      continue;
    }
    if (ch === '[') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === ']') {
          if (j + 1 < n && sql[j + 1] === ']') {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      i = closed ? j + 1 : n;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

const WORD_RE = /[A-Za-z_#@\u0080-\uFFFF][A-Za-z0-9_#@$\u0080-\uFFFF]*/y;
const NUMBER_RE = /\d+(?:\.\d+)?/y;

function unescapeQuoted(inner: string, quote: string): string {
  return inner.split(quote + quote).join(quote);
}

/** sanitize 済みテキストをトークン列に変換する */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '"' || ch === '`') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (text[j] === ch) {
          if (j + 1 < n && text[j + 1] === ch) {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      tokens.push({ kind: 'ident', text: unescapeQuoted(text.slice(i + 1, j), ch) });
      i = closed ? j + 1 : n;
      continue;
    }
    if (ch === '[') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (text[j] === ']') {
          if (j + 1 < n && text[j + 1] === ']') {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      tokens.push({
        kind: 'ident',
        text: text
          .slice(i + 1, j)
          .split(']]')
          .join(']'),
      });
      i = closed ? j + 1 : n;
      continue;
    }
    if (ch === "'") {
      // sanitize 済みのため中身は空白のみ。閉じクォートまで読み飛ばす
      let j = i + 1;
      while (j < n && text[j] !== "'") j += 1;
      tokens.push({ kind: 'string', text: '' });
      i = j < n ? j + 1 : n;
      continue;
    }
    WORD_RE.lastIndex = i;
    const wordMatch = WORD_RE.exec(text);
    if (wordMatch) {
      tokens.push({ kind: 'word', text: wordMatch[0] });
      i += wordMatch[0].length;
      continue;
    }
    NUMBER_RE.lastIndex = i;
    const numberMatch = NUMBER_RE.exec(text);
    if (numberMatch) {
      tokens.push({ kind: 'number', text: numberMatch[0] });
      i += numberMatch[0].length;
      continue;
    }
    tokens.push({ kind: 'punct', text: ch });
    i += 1;
  }
  return tokens;
}

function isWord(tokens: Token[], index: number, word: string): boolean {
  const t = tokens[index];
  return t !== undefined && t.kind === 'word' && t.text.toLowerCase() === word;
}

function isWordSeq(tokens: Token[], start: number, words: string[]): boolean {
  return words.every((w, k) => isWord(tokens, start + k, w));
}

function isPunct(tokens: Token[], index: number, punct: string): boolean {
  const t = tokens[index];
  return t !== undefined && t.kind === 'punct' && t.text === punct;
}

/** openIndex の '(' に対応する ')' の位置を返す (見つからなければ tokens.length) */
function findMatchingParen(tokens: Token[], openIndex: number): number {
  let depth = 0;
  for (let k = openIndex; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind !== 'punct') continue;
    if (t.text === '(') depth += 1;
    else if (t.text === ')') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return tokens.length;
}

/** トップレベル (括弧深度 0) のカンマで分割する */
function splitTopLevel(tokens: Token[]): Token[][] {
  const items: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (t.kind === 'punct') {
      if (t.text === '(') depth += 1;
      else if (t.text === ')') depth = Math.max(0, depth - 1);
      else if (t.text === ',' && depth === 0) {
        if (current.length > 0) items.push(current);
        current = [];
        continue;
      }
    }
    current.push(t);
  }
  if (current.length > 0) items.push(current);
  return items;
}

/** CREATE と TABLE の間に置ける修飾キーワード */
const CREATE_MODIFIERS = new Set([
  'or',
  'replace',
  'global',
  'local',
  'temp',
  'temporary',
  'unlogged',
]);

/** テーブル制約・インデックス定義として無視 (または PK 抽出) する行の先頭キーワード */
const CONSTRAINT_STARTERS = new Set([
  'constraint',
  'primary',
  'foreign',
  'unique',
  'check',
  'key',
  'index',
  'fulltext',
  'spatial',
  'exclude',
  'period',
  'like',
]);

/** size を分離して type(size) 表記にする型ファミリー (utils/migrationDdl.ts と同方針) */
const SIZED_TYPE_RE =
  /^(n?char|n?varchar|character(?: varying)?|national (?:char|character|varchar)(?: varying)?|varbinary|binary|varchar2|nvarchar2)$/i;

/** MySQL の整数表示幅 (int(11) 等) を無視する型ファミリー */
const INT_DISPLAY_WIDTH_RE = /^(?:tiny|small|medium|big)?int(?:eger)?$/i;

/** 直前の型語に続けて複数語型を構成できるキーワード */
const TYPE_CONTINUATIONS = new Set([
  'varying',
  'precision',
  'with',
  'without',
  'time',
  'zone',
  'unsigned',
  'zerofill',
]);

/** 'national' の直後にのみ続けられる型キーワード */
const NATIONAL_CONTINUATIONS = new Set(['char', 'character', 'varchar', 'nchar', 'nvarchar']);

/** カラム定義 1 件をパースする。列定義と解釈できない場合は null */
function parseColumnDef(item: Token[]): Column | null {
  if (item.length < 2) return null;
  const nameToken = item[0];
  if (nameToken.kind !== 'word' && nameToken.kind !== 'ident') return null;
  const name = nameToken.text;

  if (item[1].kind !== 'word') return null;
  const typeWords: string[] = [item[1].text];
  let args: string | null = null;
  let i = 2;
  while (i < item.length) {
    const t = item[i];
    if (t.kind === 'punct' && t.text === '(' && args === null) {
      const end = findMatchingParen(item, i);
      args = item
        .slice(i + 1, end)
        .map((x) => x.text)
        .join('');
      i = end + 1;
      continue;
    }
    if (t.kind === 'word') {
      const lower = t.text.toLowerCase();
      const prev = typeWords[typeWords.length - 1].toLowerCase();
      if (
        TYPE_CONTINUATIONS.has(lower) ||
        (prev === 'national' && NATIONAL_CONTINUATIONS.has(lower))
      ) {
        typeWords.push(t.text);
        i += 1;
        continue;
      }
      break;
    }
    if (t.kind === 'ident' && t.text === '') {
      // PostgreSQL の配列型 (text[] 等): sanitize 後は空のブラケット識別子となる
      typeWords[typeWords.length - 1] += '[]';
      i += 1;
      continue;
    }
    break;
  }

  const base = typeWords.join(' ').toLowerCase();
  let type = base;
  let size = 0;
  if (args !== null) {
    const argsText = args.toLowerCase();
    if (/^\d+$/.test(argsText) && SIZED_TYPE_RE.test(base)) {
      size = Number(argsText);
    } else if (/^\d+$/.test(argsText) && INT_DISPLAY_WIDTH_RE.test(typeWords[0])) {
      // MySQL の整数表示幅は型情報として扱わない (int(11) → int)
    } else {
      type = `${base}(${argsText})`;
    }
  }

  let nullable = true;
  let isPrimaryKey = false;
  while (i < item.length) {
    const t = item[i];
    if (t.kind === 'punct' && t.text === '(') {
      i = findMatchingParen(item, i) + 1;
      continue;
    }
    if (t.kind === 'word') {
      const lower = t.text.toLowerCase();
      if (lower === 'not' && isWord(item, i + 1, 'null')) {
        nullable = false;
        i += 2;
        continue;
      }
      if (lower === 'primary' && isWord(item, i + 1, 'key')) {
        isPrimaryKey = true;
        i += 2;
        continue;
      }
      if (lower === 'default') {
        // DEFAULT 直後の値 (NULL リテラル・式・文字列) は nullable 判定に影響させない
        i += 1;
        if (isPunct(item, i, '(')) i = findMatchingParen(item, i) + 1;
        else if (i < item.length) i += 1;
        continue;
      }
    }
    i += 1;
  }
  if (isPrimaryKey) nullable = false;

  return { name, type, size, nullable, isPrimaryKey };
}

/**
 * テーブル制約行から PRIMARY KEY の対象カラム名を抽出する。
 * `CONSTRAINT <name> PRIMARY KEY [CLUSTERED|USING ...] (col [ASC|DESC], ...)` 形式に対応。
 * PRIMARY KEY 以外の制約 (FOREIGN KEY / UNIQUE / CHECK / INDEX 等) は空配列を返す。
 */
function extractPrimaryKeyColumns(item: Token[]): string[] {
  let i = 0;
  if (isWord(item, i, 'constraint')) {
    i += 1;
    const nameToken = item[i];
    if (nameToken !== undefined && (nameToken.kind === 'word' || nameToken.kind === 'ident')) {
      i += 1;
    }
  }
  if (!isWordSeq(item, i, ['primary', 'key'])) return [];
  i += 2;
  while (i < item.length && item[i].kind === 'word') i += 1; // CLUSTERED / USING BTREE 等
  if (!isPunct(item, i, '(')) return [];
  const end = findMatchingParen(item, i);
  const names: string[] = [];
  for (const group of splitTopLevel(item.slice(i + 1, end))) {
    const head = group[0];
    if (head !== undefined && (head.kind === 'word' || head.kind === 'ident')) {
      names.push(head.text);
    }
  }
  return names;
}

/** CREATE TABLE 本体 (括弧内) をパースする */
function parseTableBody(nameParts: string[], body: Token[]): SchemaTable {
  const name = nameParts[nameParts.length - 1];
  const schema = nameParts.length >= 2 ? nameParts[nameParts.length - 2] : '';
  const columns: Column[] = [];
  const pkNames: string[] = [];
  for (const item of splitTopLevel(body)) {
    const first = item[0];
    if (first.kind === 'word' && CONSTRAINT_STARTERS.has(first.text.toLowerCase())) {
      pkNames.push(...extractPrimaryKeyColumns(item));
      continue;
    }
    const column = parseColumnDef(item);
    if (column) columns.push(column);
  }
  for (const pkName of pkNames) {
    const column =
      columns.find((c) => c.name === pkName) ??
      columns.find((c) => c.name.toLowerCase() === pkName.toLowerCase());
    if (column) {
      column.isPrimaryKey = true;
      column.nullable = false;
    }
  }
  return { schema, name, columns };
}

/**
 * DDL ソースと DB ソース (ODBC getColumns) を比較する前の正規化。
 * - 型名を小文字へ揃える
 * - 文字列/バイナリ系以外の size は取得元によって意味が揃わない (ODBC は int に 4 等を
 *   返すが DDL には現れない) ため 0 に揃え、無意味な size 差分を抑止する
 */
export function normalizeTablesForDdlComparison(tables: SchemaTable[]): SchemaTable[] {
  return tables.map((table) => ({
    ...table,
    columns: table.columns.map((column) => ({
      ...column,
      type: column.type.toLowerCase(),
      size: SIZED_TYPE_RE.test(column.type.trim()) ? column.size : 0,
    })),
  }));
}

/**
 * SQL テキストから CREATE TABLE 文を抽出し SchemaTable[] を返す。
 *
 * - スキーマプレフィックス (`dbo.Users` / `db.schema.Users`) は末尾 2 要素を schema.name とする
 * - PRIMARY KEY カラムは nullable=false に正規化する (DB 側の getColumns と揃える)
 * - 同一キーのテーブルが複数回定義された場合は後勝ち
 * - CREATE TABLE が 1 件も見つからない場合は空配列 (例外は投げない)
 */
export function parseDdl(sql: string): SchemaTable[] {
  const tokens = tokenize(sanitize(sql));
  const byKey = new Map<string, SchemaTable>();
  let i = 0;
  while (i < tokens.length) {
    if (!isWord(tokens, i, 'create')) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (
      j < tokens.length &&
      tokens[j].kind === 'word' &&
      CREATE_MODIFIERS.has(tokens[j].text.toLowerCase())
    ) {
      j += 1;
    }
    if (!isWord(tokens, j, 'table')) {
      i = j;
      continue;
    }
    j += 1;
    if (isWordSeq(tokens, j, ['if', 'not', 'exists'])) j += 3;

    const nameParts: string[] = [];
    while (j < tokens.length && (tokens[j].kind === 'word' || tokens[j].kind === 'ident')) {
      nameParts.push(tokens[j].text);
      j += 1;
      if (isPunct(tokens, j, '.')) {
        j += 1;
        continue;
      }
      break;
    }
    if (nameParts.length === 0 || !isPunct(tokens, j, '(')) {
      // CREATE TABLE ... AS SELECT (CTAS) や名前なしはスキップ
      i = j;
      continue;
    }

    const bodyEnd = findMatchingParen(tokens, j);
    const table = parseTableBody(nameParts, tokens.slice(j + 1, bodyEnd));
    if (table.columns.length > 0) byKey.set(tableKey(table), table);
    i = bodyEnd + 1;
  }
  return [...byKey.values()];
}
