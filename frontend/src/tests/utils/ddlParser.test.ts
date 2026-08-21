import { describe, expect, it } from 'vite-plus/test';
import { parseDdl } from '../../utils/ddlParser';

/** 先頭テーブルの指定カラムを取得するヘルパー */
function columnOf(sql: string, columnName: string) {
  const tables = parseDdl(sql);
  expect(tables.length).toBeGreaterThan(0);
  const column = tables[0].columns.find((c) => c.name === columnName);
  expect(column).toBeDefined();
  if (!column) throw new Error(`column not found: ${columnName}`);
  return column;
}

describe('parseDdl', () => {
  describe('基本', () => {
    it('単純な CREATE TABLE をパースする', () => {
      const tables = parseDdl('CREATE TABLE users (id int, name varchar(50));');
      expect(tables).toHaveLength(1);
      expect(tables[0].name).toBe('users');
      expect(tables[0].columns).toEqual([
        { name: 'id', type: 'int', size: 0, nullable: true, isPrimaryKey: false },
        { name: 'name', type: 'varchar', size: 50, nullable: true, isPrimaryKey: false },
      ]);
    });

    it('schema プレフィックスなしは schema が空文字になる', () => {
      const tables = parseDdl('CREATE TABLE users (id int);');
      expect(tables[0].schema).toBe('');
    });

    it('db.schema.table の 3 階層修飾は末尾 2 要素を schema.name とする', () => {
      const tables = parseDdl('CREATE TABLE mydb.dbo.Users (Id int);');
      expect(tables[0].schema).toBe('dbo');
      expect(tables[0].name).toBe('Users');
    });

    it('空入力は空配列を返す', () => {
      expect(parseDdl('')).toEqual([]);
    });

    it('CREATE TABLE を含まない SQL は空配列を返す', () => {
      expect(
        parseDdl('SELECT * FROM users; UPDATE t SET x = 1; CREATE INDEX ix ON t (x);')
      ).toEqual([]);
    });

    it('複数テーブルと GO 区切りをパースする', () => {
      const sql = `
        CREATE TABLE a (id int);
        GO
        CREATE TABLE b (id int);
        GO
      `;
      const tables = parseDdl(sql);
      expect(tables.map((t) => t.name)).toEqual(['a', 'b']);
    });

    it('同名テーブルが重複した場合は後の定義が勝つ', () => {
      const sql = `
        CREATE TABLE users (id int);
        CREATE TABLE users (id int, name varchar(10));
      `;
      const tables = parseDdl(sql);
      expect(tables).toHaveLength(1);
      expect(tables[0].columns).toHaveLength(2);
    });
  });

  describe('方言クォート', () => {
    it('SQL Server の [dbo].[Users] をパースする', () => {
      const sql = 'CREATE TABLE [dbo].[Users] ([Id] INT NOT NULL, [Name] NVARCHAR(100) NULL);';
      const tables = parseDdl(sql);
      expect(tables[0].schema).toBe('dbo');
      expect(tables[0].name).toBe('Users');
      expect(tables[0].columns[0]).toEqual({
        name: 'Id',
        type: 'int',
        size: 0,
        nullable: false,
        isPrimaryKey: false,
      });
      expect(tables[0].columns[1]).toEqual({
        name: 'Name',
        type: 'nvarchar',
        size: 100,
        nullable: true,
        isPrimaryKey: false,
      });
    });

    it('PostgreSQL の "public"."users" をパースする ("" エスケープ対応)', () => {
      const sql = 'CREATE TABLE "public"."users" ("id" integer, "say""hi" text);';
      const tables = parseDdl(sql);
      expect(tables[0].schema).toBe('public');
      expect(tables[0].name).toBe('users');
      expect(tables[0].columns.map((c) => c.name)).toEqual(['id', 'say"hi']);
    });

    it('MySQL のバッククォートと ENGINE オプションをパースする', () => {
      const sql =
        'CREATE TABLE `mydb`.`users` (`id` int NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;';
      const tables = parseDdl(sql);
      expect(tables[0].schema).toBe('mydb');
      expect(tables[0].name).toBe('users');
      expect(tables[0].columns.map((c) => c.name)).toEqual(['id']);
    });

    it('空白や ]] エスケープを含むブラケット識別子をパースする', () => {
      const sql = 'CREATE TABLE [User Table] ([User Name] varchar(10), [a]]b] int);';
      const tables = parseDdl(sql);
      expect(tables[0].name).toBe('User Table');
      expect(tables[0].columns.map((c) => c.name)).toEqual(['User Name', 'a]b']);
    });
  });

  describe('型', () => {
    it('varchar(50) は type と size に分離する', () => {
      expect(columnOf('CREATE TABLE t (c varchar(50));', 'c')).toMatchObject({
        type: 'varchar',
        size: 50,
      });
    });

    it('nvarchar / varbinary も size を分離する', () => {
      const tables = parseDdl('CREATE TABLE t (a nvarchar(100), b varbinary(16));');
      expect(tables[0].columns[0]).toMatchObject({ type: 'nvarchar', size: 100 });
      expect(tables[0].columns[1]).toMatchObject({ type: 'varbinary', size: 16 });
    });

    it('decimal(10,2) は型名に括弧ごと保持する', () => {
      expect(columnOf('CREATE TABLE t (c decimal(10,2));', 'c')).toMatchObject({
        type: 'decimal(10,2)',
        size: 0,
      });
    });

    it('varchar(max) は型名に括弧ごと保持する', () => {
      expect(columnOf('CREATE TABLE t (c varchar(MAX));', 'c')).toMatchObject({
        type: 'varchar(max)',
        size: 0,
      });
    });

    it('character varying(50) は size を分離する', () => {
      expect(columnOf('CREATE TABLE t (c character varying(50));', 'c')).toMatchObject({
        type: 'character varying',
        size: 50,
      });
    });

    it('double precision / timestamp with time zone の複数語型をパースする', () => {
      const tables = parseDdl('CREATE TABLE t (a double precision, b timestamp with time zone);');
      expect(tables[0].columns[0].type).toBe('double precision');
      expect(tables[0].columns[1].type).toBe('timestamp with time zone');
    });

    it('MySQL の整数表示幅 int(11) は無視して int に正規化する', () => {
      expect(columnOf('CREATE TABLE t (c int(11));', 'c')).toMatchObject({ type: 'int', size: 0 });
    });

    it('int unsigned / bigint(20) unsigned をパースする', () => {
      const tables = parseDdl('CREATE TABLE t (a int unsigned NOT NULL, b bigint(20) unsigned);');
      expect(tables[0].columns[0]).toMatchObject({ type: 'int unsigned', nullable: false });
      expect(tables[0].columns[1]).toMatchObject({ type: 'bigint unsigned', size: 0 });
    });

    it('型名は小文字に正規化する', () => {
      expect(columnOf('CREATE TABLE t (c DATETIME2);', 'c').type).toBe('datetime2');
    });

    it('PostgreSQL の配列型 text[] をパースする', () => {
      expect(columnOf('CREATE TABLE t (c text[]);', 'c').type).toBe('text[]');
    });
  });

  describe('NULL / PRIMARY KEY', () => {
    it('NOT NULL / NULL / 省略時のデフォルト (nullable) を判定する', () => {
      const tables = parseDdl('CREATE TABLE t (a int NOT NULL, b int NULL, c int);');
      expect(tables[0].columns.map((c) => c.nullable)).toEqual([false, true, true]);
    });

    it('列内 PRIMARY KEY は isPrimaryKey と nullable=false になる', () => {
      expect(columnOf('CREATE TABLE t (id int PRIMARY KEY, x int);', 'id')).toMatchObject({
        isPrimaryKey: true,
        nullable: false,
      });
    });

    it('テーブル制約 PRIMARY KEY (a, b) で複合キーを判定する', () => {
      const tables = parseDdl('CREATE TABLE t (a int, b int, c int, PRIMARY KEY (a, b));');
      expect(tables[0].columns.map((c) => c.isPrimaryKey)).toEqual([true, true, false]);
      expect(tables[0].columns.map((c) => c.nullable)).toEqual([false, false, true]);
    });

    it('CONSTRAINT ... PRIMARY KEY CLUSTERED ([Id] ASC) を判定する', () => {
      const sql = `CREATE TABLE [dbo].[T] (
        [Id] int NOT NULL,
        [X] int NULL,
        CONSTRAINT [PK_T] PRIMARY KEY CLUSTERED ([Id] ASC)
      );`;
      const tables = parseDdl(sql);
      expect(tables[0].columns[0]).toMatchObject({ name: 'Id', isPrimaryKey: true });
      expect(tables[0].columns[1]).toMatchObject({ name: 'X', isPrimaryKey: false });
    });

    it('DEFAULT NULL は nullable 判定に影響しない', () => {
      expect(columnOf('CREATE TABLE t (c datetime DEFAULT NULL);', 'c').nullable).toBe(true);
    });

    it("DEFAULT 'value' の後の NOT NULL を正しく判定する", () => {
      expect(columnOf("CREATE TABLE t (c varchar(10) DEFAULT 'x' NOT NULL);", 'c')).toMatchObject({
        type: 'varchar',
        size: 10,
        nullable: false,
      });
    });
  });

  describe('堅牢性', () => {
    it('行コメント内の CREATE TABLE は無視する', () => {
      const sql = `
        -- CREATE TABLE commented_out (id int);
        CREATE TABLE real_table (id int);
      `;
      expect(parseDdl(sql).map((t) => t.name)).toEqual(['real_table']);
    });

    it('ネストしたブロックコメント内の CREATE TABLE は無視する', () => {
      const sql = `
        /* outer /* nested CREATE TABLE fake (x int); */ still comment */
        CREATE TABLE real_table (id int);
      `;
      expect(parseDdl(sql).map((t) => t.name)).toEqual(['real_table']);
    });

    it("文字列リテラル内の CREATE TABLE は無視する ('' エスケープ対応)", () => {
      const sql = `
        INSERT INTO log (msg) VALUES ('it''s a CREATE TABLE fake (x int)');
        CREATE TABLE real_table (id int);
      `;
      expect(parseDdl(sql).map((t) => t.name)).toEqual(['real_table']);
    });

    it('PostgreSQL のドル引用符内の CREATE TABLE は無視する', () => {
      const sql = `
        CREATE FUNCTION f() RETURNS void AS $$
          CREATE TABLE fake (x int);
        $$ LANGUAGE sql;
        CREATE TABLE real_table (id int);
      `;
      expect(parseDdl(sql).map((t) => t.name)).toEqual(['real_table']);
    });

    it('IF NOT EXISTS をスキップしてテーブル名を取得する', () => {
      const tables = parseDdl('CREATE TABLE IF NOT EXISTS users (id int);');
      expect(tables[0].name).toBe('users');
    });

    it('CREATE TABLE ... AS SELECT はスキップし後続のテーブルはパースする', () => {
      const sql = `
        CREATE TABLE backup_users AS SELECT * FROM users;
        CREATE TABLE t2 (id int);
      `;
      expect(parseDdl(sql).map((t) => t.name)).toEqual(['t2']);
    });

    it('FOREIGN KEY / UNIQUE / CHECK / KEY / INDEX 行は無視する (MySQL ダンプ風)', () => {
      const sql = `CREATE TABLE orders (
        id int NOT NULL,
        user_id int NOT NULL,
        code varchar(20),
        amount decimal(10,2) CHECK (amount >= 0),
        PRIMARY KEY (id),
        UNIQUE KEY uq_code (code),
        KEY idx_user (user_id),
        INDEX idx_amount (amount),
        FULLTEXT KEY ft_code (code),
        CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        CHECK (id > 0)
      );`;
      const tables = parseDdl(sql);
      expect(tables[0].columns.map((c) => c.name)).toEqual(['id', 'user_id', 'code', 'amount']);
      expect(tables[0].columns[0].isPrimaryKey).toBe(true);
      expect(tables[0].columns[1].isPrimaryKey).toBe(false);
    });

    it('IDENTITY(1,1) / AUTO_INCREMENT / インライン REFERENCES を無視する', () => {
      const sql = `CREATE TABLE t (
        id int IDENTITY(1,1) NOT NULL,
        seq bigint AUTO_INCREMENT,
        user_id int REFERENCES users (id)
      );`;
      const tables = parseDdl(sql);
      expect(tables[0].columns).toHaveLength(3);
      expect(tables[0].columns[0]).toMatchObject({ name: 'id', type: 'int', nullable: false });
      expect(tables[0].columns[2]).toMatchObject({ name: 'user_id', type: 'int' });
    });

    it('末尾カンマなど多少崩れた定義でも残りをパースする', () => {
      const tables = parseDdl('CREATE TABLE t (id int, );');
      expect(tables[0].columns.map((c) => c.name)).toEqual(['id']);
    });

    it('カラム 0 件のテーブルは結果に含めない', () => {
      expect(parseDdl('CREATE TABLE empty_t (); CREATE TABLE t (id int);')).toHaveLength(1);
    });

    it('クォート付きの PK 制約カラム名を解決する', () => {
      const sql = 'CREATE TABLE t ("id" int, PRIMARY KEY ("id"));';
      const tables = parseDdl(sql);
      expect(tables[0].columns[0]).toMatchObject({ isPrimaryKey: true, nullable: false });
    });
  });
});
