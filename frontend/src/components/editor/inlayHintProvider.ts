import type * as Monaco from 'monaco-editor';
import { languages as MonacoLanguages } from 'monaco-editor';
import { useSchemaStore } from '../../store/schemaStore';
import { extractInsertTargets } from '../../utils/insertHintExtractor';

function emptyList(): Monaco.languages.InlayHintList {
  return { hints: [], dispose: () => {} };
}

export function createInlayHintProvider(
  connectionId: string | null
): Monaco.languages.InlayHintsProvider {
  return {
    displayName: 'sqlInsertInlayHints',

    provideInlayHints: async (
      model: Monaco.editor.ITextModel,
      _range: Monaco.Range,
      token: Monaco.CancellationToken
    ): Promise<Monaco.languages.InlayHintList> => {
      if (!connectionId) return emptyList();

      const sql = model.getValue();
      const targets = extractInsertTargets(sql);
      if (targets.length === 0) return emptyList();

      const store = useSchemaStore.getState();
      const needLoad = targets.filter(
        (t) => t.columnNames === null && !store.getTableColumns(connectionId, t.tableName)
      );
      if (needLoad.length > 0) {
        await Promise.all(needLoad.map((t) => store.loadColumns(connectionId, t.tableName)));
      }
      if (token.isCancellationRequested) return emptyList();

      const hints: Monaco.languages.InlayHint[] = [];
      for (const target of targets) {
        const names =
          target.columnNames ??
          (useSchemaStore.getState().getTableColumns(connectionId, target.tableName) ?? []).map(
            (c) => c.name
          );
        if (names.length === 0) continue;

        for (const row of target.valueRows) {
          for (let i = 0; i < row.length; i++) {
            const name = names[i];
            if (!name) continue;
            const pos = model.getPositionAt(row[i].offset);
            hints.push({
              label: `${name}:`,
              position: pos,
              kind: MonacoLanguages.InlayHintKind.Parameter,
              paddingRight: true,
            });
          }
        }
      }

      return { hints, dispose: () => {} };
    },
  };
}
