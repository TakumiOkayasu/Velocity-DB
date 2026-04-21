import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('monaco-editor', () => ({
  languages: {
    InlayHintKind: { Type: 1, Parameter: 2 },
  },
}));

vi.mock('../../../api/bridge', () => ({
  bridge: {
    getColumns: vi.fn(),
    getTables: vi.fn(),
  },
}));

import type * as Monaco from 'monaco-editor';
import { bridge } from '../../../api/bridge';
import { createInlayHintProvider } from '../../../components/editor/inlayHintProvider';
import { useSchemaStore } from '../../../store/schemaStore';
import type { Column } from '../../../types';

type MockModel = {
  getValue: () => string;
  getPositionAt: (offset: number) => Monaco.IPosition;
};

function makeModel(sql: string): Monaco.editor.ITextModel {
  const model: MockModel = {
    getValue: () => sql,
    getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
  };
  return model as unknown as Monaco.editor.ITextModel;
}

function makeToken(cancelled = false): Monaco.CancellationToken {
  return { isCancellationRequested: cancelled } as unknown as Monaco.CancellationToken;
}

const FAKE_RANGE = {} as Monaco.Range;

function seedTable(connectionId: string, tableName: string, columns?: Column[]) {
  useSchemaStore.setState({
    schemas: new Map([
      [
        connectionId,
        {
          tables: [
            {
              name: tableName,
              schema: 'dbo',
              type: 'TABLE' as const,
              columns,
              columnsLoaded: columns !== undefined,
            },
          ],
          tablesLoaded: true,
          loadingTables: false,
          loadingColumns: new Set<string>(),
        },
      ],
    ]),
  });
}

function seedTables(connectionId: string, tables: Array<{ name: string; columns?: Column[] }>) {
  useSchemaStore.setState({
    schemas: new Map([
      [
        connectionId,
        {
          tables: tables.map((t) => ({
            name: t.name,
            schema: 'dbo',
            type: 'TABLE' as const,
            columns: t.columns,
            columnsLoaded: t.columns !== undefined,
          })),
          tablesLoaded: true,
          loadingTables: false,
          loadingColumns: new Set<string>(),
        },
      ],
    ]),
  });
}

function col(name: string, type = 'int'): Column {
  return { name, type, size: 0, nullable: true, isPrimaryKey: false };
}

describe('createInlayHintProvider', () => {
  beforeEach(() => {
    useSchemaStore.setState({ schemas: new Map() });
    vi.mocked(bridge.getColumns).mockReset();
  });

  describe('connectionId null', () => {
    it('空リストを返す', async () => {
      const provider = createInlayHintProvider(null);
      const model = makeModel('INSERT INTO users VALUES (1, 2)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints).toEqual([]);
    });
  });

  describe('明示カラムリスト', () => {
    it('VALUES の各値に columnNames 順のラベルを付与', async () => {
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO users (id, name, age) VALUES (1, 2, 3)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      const hints = result?.hints ?? [];
      expect(hints).toHaveLength(3);
      expect(hints[0].label).toBe('id:');
      expect(hints[1].label).toBe('name:');
      expect(hints[2].label).toBe('age:');
    });

    it('kind が InlayHintKind.Parameter (=2)', async () => {
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO t (a) VALUES (1)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints[0].kind).toBe(2);
      expect(result?.hints[0].paddingRight).toBe(true);
    });

    it('値数 > カラム数: 余剰値にはヒント生成しない', async () => {
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO t (a, b) VALUES (1, 2, 3, 4)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints).toHaveLength(2);
      expect(result?.hints.map((h) => h.label)).toEqual(['a:', 'b:']);
    });

    it('カラム数 > 値数: 値数分のみ生成', async () => {
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO t (a, b, c, d) VALUES (1, 2)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints).toHaveLength(2);
      expect(result?.hints.map((h) => h.label)).toEqual(['a:', 'b:']);
    });

    it('複数行 VALUES: 全行にヒント生成', async () => {
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO t (a, b) VALUES (1, 2), (3, 4), (5, 6)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints).toHaveLength(6);
      expect(result?.hints.map((h) => h.label)).toEqual(['a:', 'b:', 'a:', 'b:', 'a:', 'b:']);
    });
  });

  describe('暗黙カラムリスト (schemaStore 連携)', () => {
    it('キャッシュ済みテーブル: カラム順でラベル生成', async () => {
      seedTable('conn_1', 'users', [col('id'), col('name'), col('age')]);
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO users VALUES (1, 2, 3)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints.map((h) => h.label)).toEqual(['id:', 'name:', 'age:']);
      expect(vi.mocked(bridge.getColumns)).not.toHaveBeenCalled();
    });

    it('未ロード時: loadColumns を経由してヒント生成', async () => {
      seedTable('conn_1', 'orders');
      vi.mocked(bridge.getColumns).mockResolvedValue([col('order_id'), col('qty')]);

      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO orders VALUES (1, 2)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());

      expect(vi.mocked(bridge.getColumns)).toHaveBeenCalledWith('conn_1', 'orders');
      expect(result?.hints.map((h) => h.label)).toEqual(['order_id:', 'qty:']);
    });

    it('schemaStore に該当テーブルなし: ヒント0件', async () => {
      seedTable('conn_1', 'other_table', [col('id')]);
      vi.mocked(bridge.getColumns).mockResolvedValue([]);
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO missing VALUES (1, 2)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints).toEqual([]);
    });
  });

  describe('position 計算', () => {
    it('各ヒントの position.column が値のoffset+1 (1-based)', async () => {
      const provider = createInlayHintProvider('conn_1');
      const sql = 'INSERT INTO t (a, b, c) VALUES (1, 2, 3)';
      const model = makeModel(sql);
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      const hints = result?.hints ?? [];
      expect(hints[0].position.column).toBe(sql.indexOf('1') + 1);
      expect(hints[1].position.column).toBe(sql.indexOf('2') + 1);
      expect(hints[2].position.column).toBe(sql.indexOf('3') + 1);
    });
  });

  describe('cancellation', () => {
    it('loadColumns 完了後に cancellation 検出で空返却', async () => {
      seedTable('conn_1', 't');
      vi.mocked(bridge.getColumns).mockResolvedValue([col('a')]);

      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('INSERT INTO t VALUES (1)');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken(true));
      expect(result?.hints).toEqual([]);
    });
  });

  describe('INSERT なし', () => {
    it('SELECT文のみ: 空リスト', async () => {
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel('SELECT * FROM users');
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints).toEqual([]);
    });
  });

  describe('複数 INSERT 文', () => {
    it('異なるテーブルへのINSERT: 各々のカラム名で生成', async () => {
      seedTables('conn_1', [
        { name: 'users', columns: [col('uid'), col('uname')] },
        { name: 'orders', columns: [col('oid'), col('uid_fk')] },
      ]);
      const provider = createInlayHintProvider('conn_1');
      const model = makeModel(
        'INSERT INTO users VALUES (1, 2); INSERT INTO orders VALUES (10, 20);'
      );
      const result = await provider.provideInlayHints(model, FAKE_RANGE, makeToken());
      expect(result?.hints.map((h) => h.label)).toEqual(['uid:', 'uname:', 'oid:', 'uid_fk:']);
    });
  });
});
