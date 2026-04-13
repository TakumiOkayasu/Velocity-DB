import type * as Monaco from 'monaco-editor';
import { useSchemaStore } from '../../store/schemaStore';
import { log } from '../../utils/logger';
import { parseAliases } from './parseAliases';

// SQLキーワード（基本的なもののみ）
const SQL_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'JOIN',
  'LEFT',
  'RIGHT',
  'INNER',
  'OUTER',
  'ON',
  'AND',
  'OR',
  'NOT',
  'IN',
  'LIKE',
  'BETWEEN',
  'IS',
  'NULL',
  'ORDER',
  'BY',
  'GROUP',
  'HAVING',
  'INSERT',
  'INTO',
  'VALUES',
  'UPDATE',
  'SET',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'TABLE',
  'INDEX',
  'VIEW',
  'AS',
  'DISTINCT',
  'TOP',
  'LIMIT',
  'OFFSET',
  'UNION',
  'ALL',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COALESCE',
  'ISNULL',
  'CAST',
  'CONVERT',
];

// カーソル位置の文脈を判断
type ContextType = 'table' | 'column' | 'alias_column' | 'keyword' | 'unknown';

interface CompletionContext {
  type: ContextType;
  aliasOrTable?: string;
}

export function detectContextFromText(textBeforeCursor: string): CompletionContext {
  // ドット直後: エイリアス.カラム または [テーブル].カラム
  const dotMatch = textBeforeCursor.match(/\[?(\w+)\]?\.$/);
  if (dotMatch) {
    return { type: 'alias_column', aliasOrTable: dotMatch[1] };
  }

  // 現在タイピング中の単語を除いた前文脈。これにより `SELECT n` のように部分入力中でも
  // 直前キーワードで文脈判定できる。
  const textWithoutCurrentWord = textBeforeCursor.replace(/\w*$/, '');

  if (/(?:FROM|JOIN)\s+$/i.test(textWithoutCurrentWord)) {
    return { type: 'table' };
  }
  if (/(?:SELECT|WHERE|ON|SET|AND|OR|,)\s+$/i.test(textWithoutCurrentWord)) {
    return { type: 'column' };
  }
  return { type: 'keyword' };
}

function getCompletionContext(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): CompletionContext {
  const textBeforeCursor = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  return detectContextFromText(textBeforeCursor);
}

export function createCompletionProvider(
  connectionId: string | null
): Monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters: ['.', ' '],

    provideCompletionItems: async (
      model: Monaco.editor.ITextModel,
      position: Monaco.Position
    ): Promise<Monaco.languages.CompletionList> => {
      const suggestions: Monaco.languages.CompletionItem[] = [];
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const context = getCompletionContext(model, position);
      const fullText = model.getValue();
      const aliases = parseAliases(fullText);

      log.debug(`[CompletionProvider] Context: ${context.type}, ConnectionId: ${connectionId}`);

      if (context.type === 'alias_column' && context.aliasOrTable) {
        // エイリアス.カラム補完
        const aliasInfo = aliases.find((a) => a.alias === context.aliasOrTable?.toLowerCase());
        const tableName = aliasInfo?.tableName ?? context.aliasOrTable;

        if (connectionId) {
          const columns = await useSchemaStore.getState().loadColumns(connectionId, tableName);
          for (const col of columns) {
            suggestions.push({
              label: col.name,
              kind: 5, // Field
              detail: `${col.type}${col.nullable ? ' (nullable)' : ''}`,
              insertText: col.name,
              range,
            });
          }
        }
      } else if (context.type === 'table') {
        // テーブル名補完
        if (connectionId) {
          await useSchemaStore.getState().loadTables(connectionId);
          const tables = useSchemaStore.getState().getTables(connectionId);
          for (const table of tables) {
            const displayName =
              table.schema !== 'dbo' ? `${table.schema}.${table.name}` : table.name;
            suggestions.push({
              label: displayName,
              kind: table.type === 'VIEW' ? 1 : 6, // Class for VIEW, Struct for TABLE
              detail: table.type,
              insertText: displayName.includes('.')
                ? `[${table.schema}].[${table.name}]`
                : table.name,
              range,
            });
          }
        }
      } else if (context.type === 'column') {
        // カラム名補完（FROM句のテーブルから）
        if (connectionId) {
          // 未ロードのテーブルは遅延ロード
          await Promise.all(
            aliases.map((alias) => {
              const cached = useSchemaStore
                .getState()
                .getTableColumns(connectionId, alias.tableName);
              return cached
                ? Promise.resolve(cached)
                : useSchemaStore.getState().loadColumns(connectionId, alias.tableName);
            })
          );

          for (const alias of aliases) {
            const columns = useSchemaStore
              .getState()
              .getTableColumns(connectionId, alias.tableName);
            if (!columns) continue;

            const emitBare = alias.alias === alias.tableName.toLowerCase();
            for (const col of columns) {
              // alias.column 形式(エイリアス有り時の典型入力)
              suggestions.push({
                label: `${alias.alias}.${col.name}`,
                kind: 5, // Field
                detail: `${alias.tableName}.${col.name} (${col.type})`,
                insertText: `${alias.alias}.${col.name}`,
                range,
                sortText: `a${col.name}`,
              });
              // bare column 形式(エイリアス未指定時のみ。重複ノイズ抑制)
              if (emitBare) {
                suggestions.push({
                  label: col.name,
                  kind: 5, // Field
                  detail: `${alias.tableName}.${col.name} (${col.type})`,
                  insertText: col.name,
                  range,
                  sortText: `a${col.name}`,
                });
              }
            }
          }
        }
      }

      // キーワード補完は常に追加（優先度低め）
      for (const keyword of SQL_KEYWORDS) {
        if (keyword.toLowerCase().startsWith(word.word.toLowerCase())) {
          suggestions.push({
            label: keyword,
            kind: 14, // Keyword
            insertText: keyword,
            range,
            sortText: `z${keyword}`, // キーワードは後に
          });
        }
      }

      return { suggestions };
    },
  };
}
