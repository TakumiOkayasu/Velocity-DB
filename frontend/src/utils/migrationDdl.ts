// 移行 DDL 生成 (純関数層)。
// utils/schemaDiff.ts が生成した SchemaDiff から、方言別の移行スクリプト (DDL) を生成する。
// 破壊的操作 (DROP TABLE / DROP COLUMN) は既定でコメントアウトして出力する。
// 識別子クォートは utils/sql/quoting.ts に依存。

import type { Column, DatabaseType } from '../types';
import type { ColumnChange, SchemaDiff, SchemaTable, TableDiff } from './schemaDiff';
import { isEmptyDiff, tableKey } from './schemaDiff';
import { quoteIdentifier } from './sql/quoting';

export type MigrationDialect = DatabaseType;

export interface MigrationDdlOptions {
  dialect: MigrationDialect;
  /** ヘッダーに記載する移行元の説明 (例: "dev-server/AppDb") */
  sourceLabel: string;
  /** ヘッダーに記載する移行先の説明 */
  targetLabel: string;
  /** 生成日時。省略時はプレースホルダ {{GENERATED_AT}} を出力する (純関数性維持) */
  generatedAt?: string;
}

/** サイズ表記 type(size) を付与する型ファミリー (文字列 / バイナリ系のみ)。それ以外は取得値をそのまま出力 */
const SIZED_TYPE_RE = /^(n?char|n?varchar|character(?: varying)?|varbinary|binary|varchar2)$/i;

/** カラム型の描画。型名は取得値をそのまま使い、文字列/バイナリ系のみ size を括弧付与する */
export function renderColumnType(column: Pick<Column, 'type' | 'size'>): string {
  const type = column.type.trim();
  if (type.includes('(')) return type;
  if (column.size > 0 && SIZED_TYPE_RE.test(type)) {
    return `${type}(${column.size})`;
  }
  return type;
}

function qualifyTable(schema: string, name: string, dialect: MigrationDialect): string {
  // MySQL はスキーマ = データベースのため名前のみ修飾 (utils/sql/ddl/table-ddl.ts と同方針)
  if (dialect === 'mysql' || schema === '') {
    return quoteIdentifier(name, dialect);
  }
  return `${quoteIdentifier(schema, dialect)}.${quoteIdentifier(name, dialect)}`;
}

function renderColumnDef(column: Column, dialect: MigrationDialect): string {
  const notNull = column.nullable ? '' : ' NOT NULL';
  return `${quoteIdentifier(column.name, dialect)} ${renderColumnType(column)}${notNull}`;
}

function buildCreateTable(table: SchemaTable, dialect: MigrationDialect): string[] {
  const lines: string[] = [];
  lines.push(`CREATE TABLE ${qualifyTable(table.schema, table.name, dialect)} (`);

  const defs = table.columns.map((c) => `  ${renderColumnDef(c, dialect)}`);
  const pkColumns = table.columns.filter((c) => c.isPrimaryKey);
  if (pkColumns.length > 0) {
    const pkList = pkColumns.map((c) => quoteIdentifier(c.name, dialect)).join(', ');
    defs.push(`  PRIMARY KEY (${pkList})`);
  }
  lines.push(defs.join(',\n'));
  lines.push(');');
  return lines;
}

function buildAddColumn(table: TableDiff, column: Column, dialect: MigrationDialect): string {
  const target = qualifyTable(table.schema, table.name, dialect);
  const def = renderColumnDef(column, dialect);
  const keyword = dialect === 'sqlserver' ? 'ADD' : 'ADD COLUMN';
  const statement = `ALTER TABLE ${target} ${keyword} ${def};`;
  if (!column.nullable) {
    return `-- 注意: NOT NULL カラム追加は既存行がある場合に失敗します (DEFAULT 指定を検討)\n${statement}`;
  }
  return statement;
}

function riskComments(change: ColumnChange): string[] {
  const comments: string[] = [];
  const fromType = renderColumnType(change.from);
  const toType = renderColumnType(change.to);
  if (change.changes.includes('type')) {
    comments.push(
      `-- 注意: 型変更 (${fromType} -> ${toType}) はデータ変換に失敗する可能性があります`
    );
  } else if (change.changes.includes('size') && change.to.size < change.from.size) {
    comments.push(
      `-- 注意: サイズ縮小 (${fromType} -> ${toType}) はデータ切り捨ての可能性があります`
    );
  }
  if (change.changes.includes('nullable') && !change.to.nullable) {
    comments.push('-- 注意: NOT NULL 化は NULL 値が存在する場合に失敗します');
  }
  return comments;
}

function buildAlterColumn(
  table: TableDiff,
  change: ColumnChange,
  dialect: MigrationDialect
): string[] {
  const target = qualifyTable(table.schema, table.name, dialect);
  const col = quoteIdentifier(change.name, dialect);
  const lines: string[] = [...riskComments(change)];

  const needsDefChange =
    change.changes.includes('type') ||
    change.changes.includes('size') ||
    change.changes.includes('nullable');

  if (needsDefChange) {
    switch (dialect) {
      case 'postgresql': {
        if (change.changes.includes('type') || change.changes.includes('size')) {
          lines.push(
            `ALTER TABLE ${target} ALTER COLUMN ${col} TYPE ${renderColumnType(change.to)};`
          );
        }
        if (change.changes.includes('nullable')) {
          lines.push(
            change.to.nullable
              ? `ALTER TABLE ${target} ALTER COLUMN ${col} DROP NOT NULL;`
              : `ALTER TABLE ${target} ALTER COLUMN ${col} SET NOT NULL;`
          );
        }
        break;
      }
      case 'mysql': {
        lines.push(`ALTER TABLE ${target} MODIFY COLUMN ${renderColumnDef(change.to, dialect)};`);
        break;
      }
      default: {
        const nullability = change.to.nullable ? 'NULL' : 'NOT NULL';
        lines.push(
          `ALTER TABLE ${target} ALTER COLUMN ${col} ${renderColumnType(change.to)} ${nullability};`
        );
        break;
      }
    }
  }

  if (change.changes.includes('isPrimaryKey')) {
    lines.push(
      `-- 注意: 主キー変更 (${change.name}) は自動生成の対象外です。制約の付け替えを手動で行ってください`
    );
  }
  return lines;
}

function buildDropColumn(table: TableDiff, column: Column, dialect: MigrationDialect): string[] {
  const target = qualifyTable(table.schema, table.name, dialect);
  return [
    '-- 【破壊的操作】DROP COLUMN は既定でコメントアウトされています。実行する場合は解除してください',
    `-- ALTER TABLE ${target} DROP COLUMN ${quoteIdentifier(column.name, dialect)};`,
  ];
}

function buildDropTable(table: SchemaTable, dialect: MigrationDialect): string[] {
  return [
    '-- 【破壊的操作】DROP TABLE は既定でコメントアウトされています。実行する場合は解除してください',
    `-- DROP TABLE ${qualifyTable(table.schema, table.name, dialect)};`,
  ];
}

function buildHeader(diff: SchemaDiff, options: MigrationDdlOptions): string[] {
  return [
    '-- ============================================================',
    '-- スキーマ移行スクリプト (Velocity-DB schema compare)',
    `-- 移行元 (from): ${options.sourceLabel}`,
    `-- 移行先 (to):   ${options.targetLabel}`,
    `-- 方言: ${options.dialect}`,
    `-- 生成日時: ${options.generatedAt ?? '{{GENERATED_AT}}'}`,
    `-- 差分: 追加テーブル ${diff.addedTables.length} / 削除テーブル ${diff.removedTables.length} / 変更テーブル ${diff.changedTables.length}`,
    '-- 注意: 実行前に必ず内容を確認し、バックアップを取得してください。',
    '--       破壊的操作 (DROP TABLE / DROP COLUMN) はコメントアウトされています。',
    '-- ============================================================',
  ];
}

/**
 * SchemaDiff から移行 DDL スクリプトを生成する。
 *
 * - 「移行元スキーマを移行先スキーマの形へ変換する」DDL を出力する。
 * - セクション順: CREATE TABLE → ALTER TABLE → DROP TABLE (各テーブルキー昇順、決定的)。
 * - 破壊的操作はコメントアウト + 警告付き。
 */
export function generateMigrationDdl(diff: SchemaDiff, options: MigrationDdlOptions): string {
  const { dialect } = options;
  const sections: string[] = [buildHeader(diff, options).join('\n')];

  if (isEmptyDiff(diff)) {
    sections.push('-- 差分はありません。');
    return `${sections.join('\n\n')}\n`;
  }

  for (const table of diff.addedTables) {
    sections.push(
      [`-- [追加テーブル] ${tableKey(table)}`, ...buildCreateTable(table, dialect)].join('\n')
    );
  }

  for (const table of diff.changedTables) {
    const lines: string[] = [`-- [変更テーブル] ${tableKey(table)}`];
    for (const column of table.addedColumns) {
      lines.push(buildAddColumn(table, column, dialect));
    }
    for (const change of table.changedColumns) {
      lines.push(...buildAlterColumn(table, change, dialect));
    }
    for (const column of table.removedColumns) {
      lines.push(...buildDropColumn(table, column, dialect));
    }
    sections.push(lines.join('\n'));
  }

  for (const table of diff.removedTables) {
    sections.push(
      [`-- [削除テーブル] ${tableKey(table)}`, ...buildDropTable(table, dialect)].join('\n')
    );
  }

  return `${sections.join('\n\n')}\n`;
}
