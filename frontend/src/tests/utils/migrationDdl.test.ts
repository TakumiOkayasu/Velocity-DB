import { describe, expect, it } from 'vite-plus/test';
import type { Column } from '../../types';
import {
  generateMigrationDdl,
  type MigrationDialect,
  renderColumnType,
} from '../../utils/migrationDdl';
import { diffSchemas, type SchemaTable } from '../../utils/schemaDiff';

function col(name: string, overrides: Partial<Column> = {}): Column {
  return {
    name,
    type: 'int',
    size: 4,
    nullable: true,
    isPrimaryKey: false,
    ...overrides,
  };
}

function table(schema: string, name: string, columns: Column[]): SchemaTable {
  return { schema, name, columns };
}

function generate(
  from: SchemaTable[],
  to: SchemaTable[],
  dialect: MigrationDialect = 'sqlserver'
): string {
  return generateMigrationDdl(diffSchemas(from, to), {
    dialect,
    sourceLabel: 'src-conn/SrcDb',
    targetLabel: 'dst-conn/DstDb',
  });
}

describe('renderColumnType', () => {
  it('文字列系は size を括弧付与する', () => {
    expect(renderColumnType({ type: 'varchar', size: 50 })).toBe('varchar(50)');
    expect(renderColumnType({ type: 'nvarchar', size: 100 })).toBe('nvarchar(100)');
    expect(renderColumnType({ type: 'char', size: 8 })).toBe('char(8)');
  });

  it('数値系などは size を付与せず型名をそのまま返す', () => {
    expect(renderColumnType({ type: 'int', size: 4 })).toBe('int');
    expect(renderColumnType({ type: 'datetime2', size: 8 })).toBe('datetime2');
  });

  it('既に括弧付きの型はそのまま返す', () => {
    expect(renderColumnType({ type: 'numeric(10,2)', size: 9 })).toBe('numeric(10,2)');
  });

  it('size が 0 以下の場合は付与しない', () => {
    expect(renderColumnType({ type: 'varchar', size: 0 })).toBe('varchar');
    expect(renderColumnType({ type: 'nvarchar', size: -1 })).toBe('nvarchar');
  });
});

describe('generateMigrationDdl: ヘッダー', () => {
  it('移行元/移行先/方言と生成日時プレースホルダを含む', () => {
    const ddl = generate([], []);
    expect(ddl).toContain('-- 移行元 (from): src-conn/SrcDb');
    expect(ddl).toContain('-- 移行先 (to):   dst-conn/DstDb');
    expect(ddl).toContain('-- 方言: sqlserver');
    expect(ddl).toContain('{{GENERATED_AT}}');
  });

  it('generatedAt 指定時はその値を出力する', () => {
    const ddl = generateMigrationDdl(diffSchemas([], []), {
      dialect: 'postgresql',
      sourceLabel: 'a',
      targetLabel: 'b',
      generatedAt: '2026-07-23T00:00:00Z',
    });
    expect(ddl).toContain('-- 生成日時: 2026-07-23T00:00:00Z');
    expect(ddl).not.toContain('{{GENERATED_AT}}');
  });

  it('差分なしの場合はその旨を出力する', () => {
    expect(generate([], [])).toContain('-- 差分はありません。');
  });
});

describe('generateMigrationDdl: CREATE TABLE', () => {
  const users = table('dbo', 'users', [
    col('id', { type: 'int', nullable: false, isPrimaryKey: true }),
    col('name', { type: 'varchar', size: 50, nullable: false }),
    col('bio', { type: 'varchar', size: 200 }),
  ]);

  it('SQL Server: [schema].[table] + NOT NULL + PRIMARY KEY を生成する', () => {
    const ddl = generate([], [users], 'sqlserver');
    expect(ddl).toContain('CREATE TABLE [dbo].[users] (');
    expect(ddl).toContain('  [id] int NOT NULL,');
    expect(ddl).toContain('  [name] varchar(50) NOT NULL,');
    expect(ddl).toContain('  [bio] varchar(200),');
    expect(ddl).toContain('  PRIMARY KEY ([id])');
    expect(ddl).toContain(');');
  });

  it('PostgreSQL: "schema"."table" 引用符で生成する', () => {
    const ddl = generate([], [users], 'postgresql');
    expect(ddl).toContain('CREATE TABLE "dbo"."users" (');
    expect(ddl).toContain('  "name" varchar(50) NOT NULL,');
    expect(ddl).toContain('  PRIMARY KEY ("id")');
  });

  it('MySQL: バッククォート引用でスキーマ修飾なし', () => {
    const ddl = generate([], [users], 'mysql');
    expect(ddl).toContain('CREATE TABLE `users` (');
    expect(ddl).not.toContain('`dbo`.');
    expect(ddl).toContain('  PRIMARY KEY (`id`)');
  });

  it('複合主キーは全 PK カラムを列挙する', () => {
    const t = table('dbo', 'm', [
      col('a', { isPrimaryKey: true, nullable: false }),
      col('b', { isPrimaryKey: true, nullable: false }),
    ]);
    expect(generate([], [t], 'sqlserver')).toContain('PRIMARY KEY ([a], [b])');
  });

  it('PK なしテーブルには PRIMARY KEY 行を出力しない', () => {
    const t = table('dbo', 'log', [col('message', { type: 'varchar', size: 100 })]);
    expect(generate([], [t], 'sqlserver')).not.toContain('PRIMARY KEY');
  });
});

describe('generateMigrationDdl: ALTER TABLE', () => {
  const base = table('dbo', 't', [col('id', { nullable: false, isPrimaryKey: true })]);

  it('カラム追加: SQL Server は ADD、PostgreSQL/MySQL は ADD COLUMN', () => {
    const to = table('dbo', 't', [...base.columns, col('email', { type: 'varchar', size: 255 })]);
    expect(generate([base], [to], 'sqlserver')).toContain(
      'ALTER TABLE [dbo].[t] ADD [email] varchar(255);'
    );
    expect(generate([base], [to], 'postgresql')).toContain(
      'ALTER TABLE "dbo"."t" ADD COLUMN "email" varchar(255);'
    );
    expect(generate([base], [to], 'mysql')).toContain(
      'ALTER TABLE `t` ADD COLUMN `email` varchar(255);'
    );
  });

  it('NOT NULL カラム追加には警告コメントを付与する', () => {
    const to = table('dbo', 't', [
      ...base.columns,
      col('code', { type: 'varchar', size: 10, nullable: false }),
    ]);
    const ddl = generate([base], [to], 'sqlserver');
    expect(ddl).toContain('-- 注意: NOT NULL カラム追加は既存行がある場合に失敗します');
    expect(ddl).toContain('ALTER TABLE [dbo].[t] ADD [code] varchar(10) NOT NULL;');
  });

  it('型変更: SQL Server は ALTER COLUMN + NULL 指定', () => {
    const from = table('dbo', 't', [col('id', { nullable: false }), col('v', { type: 'int' })]);
    const to = table('dbo', 't', [
      col('id', { nullable: false }),
      col('v', { type: 'bigint', size: 8 }),
    ]);
    const ddl = generate([from], [to], 'sqlserver');
    expect(ddl).toContain('ALTER TABLE [dbo].[t] ALTER COLUMN [v] bigint NULL;');
    expect(ddl).toContain('-- 注意: 型変更 (int -> bigint) はデータ変換に失敗する可能性があります');
  });

  it('型変更: PostgreSQL は ALTER COLUMN ... TYPE', () => {
    const from = table('public', 't', [col('v', { type: 'integer' })]);
    const to = table('public', 't', [col('v', { type: 'bigint', size: 8 })]);
    expect(generate([from], [to], 'postgresql')).toContain(
      'ALTER TABLE "public"."t" ALTER COLUMN "v" TYPE bigint;'
    );
  });

  it('型変更: MySQL は MODIFY COLUMN', () => {
    const from = table('', 't', [col('v', { type: 'int' })]);
    const to = table('', 't', [col('v', { type: 'bigint', size: 8, nullable: false })]);
    expect(generate([from], [to], 'mysql')).toContain(
      'ALTER TABLE `t` MODIFY COLUMN `v` bigint NOT NULL;'
    );
  });

  it('NULL 制約変更: PostgreSQL は SET / DROP NOT NULL を使い分ける', () => {
    const from = table('public', 't', [
      col('a', { nullable: true }),
      col('b', { nullable: false }),
    ]);
    const to = table('public', 't', [col('a', { nullable: false }), col('b', { nullable: true })]);
    const ddl = generate([from], [to], 'postgresql');
    expect(ddl).toContain('ALTER TABLE "public"."t" ALTER COLUMN "a" SET NOT NULL;');
    expect(ddl).toContain('ALTER TABLE "public"."t" ALTER COLUMN "b" DROP NOT NULL;');
    expect(ddl).toContain('-- 注意: NOT NULL 化は NULL 値が存在する場合に失敗します');
  });

  it('サイズ縮小には切り捨て警告コメントを付与する', () => {
    const from = table('dbo', 't', [col('v', { type: 'varchar', size: 100 })]);
    const to = table('dbo', 't', [col('v', { type: 'varchar', size: 50 })]);
    const ddl = generate([from], [to], 'sqlserver');
    expect(ddl).toContain(
      '-- 注意: サイズ縮小 (varchar(100) -> varchar(50)) はデータ切り捨ての可能性があります'
    );
    expect(ddl).toContain('ALTER TABLE [dbo].[t] ALTER COLUMN [v] varchar(50) NULL;');
  });

  it('主キー変更は自動生成対象外の注意コメントのみ出力する', () => {
    const from = table('dbo', 't', [col('id', { isPrimaryKey: false, nullable: false })]);
    const to = table('dbo', 't', [col('id', { isPrimaryKey: true, nullable: false })]);
    const ddl = generate([from], [to], 'sqlserver');
    expect(ddl).toContain('-- 注意: 主キー変更 (id) は自動生成の対象外です');
    expect(ddl).not.toContain('ALTER TABLE [dbo].[t] ALTER COLUMN [id]');
  });
});

describe('generateMigrationDdl: 破壊的操作', () => {
  it('DROP TABLE はコメントアウト + 警告付きで出力する', () => {
    const ddl = generate([table('dbo', 'legacy', [col('id')])], [], 'sqlserver');
    expect(ddl).toContain('-- DROP TABLE [dbo].[legacy];');
    expect(ddl).not.toContain('\nDROP TABLE');
    expect(ddl).toContain('【破壊的操作】DROP TABLE は既定でコメントアウトされています');
  });

  it('DROP COLUMN はコメントアウト + 警告付きで出力する', () => {
    const from = table('dbo', 't', [col('id'), col('legacy')]);
    const to = table('dbo', 't', [col('id')]);
    const ddl = generate([from], [to], 'sqlserver');
    expect(ddl).toContain('-- ALTER TABLE [dbo].[t] DROP COLUMN [legacy];');
    expect(ddl).not.toContain('\nALTER TABLE [dbo].[t] DROP COLUMN');
    expect(ddl).toContain('【破壊的操作】DROP COLUMN は既定でコメントアウトされています');
  });
});

describe('generateMigrationDdl: 決定的な出力順', () => {
  it('CREATE → ALTER → DROP のセクション順で、テーブルはキー昇順に出力する', () => {
    const from = [
      table('dbo', 'removed_z', [col('id')]),
      table('dbo', 'removed_a', [col('id')]),
      table('dbo', 'changed', [col('id')]),
    ];
    const to = [
      table('dbo', 'added_z', [col('id')]),
      table('dbo', 'added_a', [col('id')]),
      table('dbo', 'changed', [col('id'), col('extra')]),
    ];
    const ddl = generate(from, to, 'sqlserver');

    const positions = [
      ddl.indexOf('CREATE TABLE [dbo].[added_a]'),
      ddl.indexOf('CREATE TABLE [dbo].[added_z]'),
      ddl.indexOf('ALTER TABLE [dbo].[changed] ADD [extra]'),
      ddl.indexOf('-- DROP TABLE [dbo].[removed_a];'),
      ddl.indexOf('-- DROP TABLE [dbo].[removed_z];'),
    ];
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('同一入力からは常に同一の出力を生成する', () => {
    const from = [table('dbo', 'a', [col('id')])];
    const to = [table('dbo', 'b', [col('id')])];
    expect(generate(from, to)).toBe(generate(from, to));
  });
});

describe('generateMigrationDdl: 識別子エスケープ', () => {
  it('特殊文字を含む識別子を方言ごとにエスケープする', () => {
    const t = table('dbo', 'we]ird', [col('col"1'), col('col`2')]);
    expect(generate([], [t], 'sqlserver')).toContain('CREATE TABLE [dbo].[we]]ird] (');
    expect(generate([], [t], 'postgresql')).toContain('"col""1"');
    expect(generate([], [t], 'mysql')).toContain('`col``2`');
  });
});
