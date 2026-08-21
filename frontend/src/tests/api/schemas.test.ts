import { describe, expect, it } from 'vite-plus/test';
import { executeQuery } from '../../api/schemas';

describe('executeQuery schema', () => {
  it('単一結果レスポンスをパースできる', () => {
    const singleResult = {
      columns: [{ name: 'id', type: 'int' }],
      rows: [['1']],
      affectedRows: 0,
      executionTimeMs: 10,
      cached: false,
    };
    expect(() => executeQuery.parse(singleResult)).not.toThrow();
  });

  it('multipleResults レスポンスをパースできる', () => {
    const multipleResult = {
      multipleResults: true,
      results: [
        {
          statement: "UPDATE [dbo].[Users] SET [name] = 'test' WHERE [id] = 1;",
          data: {
            columns: [{ name: 'Message', type: 'VARCHAR' }],
            rows: [],
            affectedRows: 1,
            executionTimeMs: 5,
          },
        },
        {
          statement: "INSERT INTO [dbo].[Users] ([name]) VALUES ('test2');",
          data: {
            columns: [],
            rows: [],
            affectedRows: 1,
            executionTimeMs: 3,
          },
        },
      ],
    };
    expect(() => executeQuery.parse(multipleResult)).not.toThrow();
  });

  it('不正なデータを拒否する', () => {
    expect(() => executeQuery.parse({})).toThrow();
    expect(() => executeQuery.parse({ multipleResults: true })).toThrow();
  });
});
