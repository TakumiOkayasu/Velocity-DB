import type * as Monaco from 'monaco-editor';
import { languages as MonacoLanguages } from 'monaco-editor';
import { useSchemaStore } from '../../store/schemaStore';
import { extractInsertTargets } from '../../utils/insertHintExtractor';
import { extractUpdateTargets } from '../../utils/updateHintExtractor';

function emptyList(): Monaco.languages.InlayHintList {
  return { hints: [], dispose: () => {} };
}

function makeHint(
  model: Monaco.editor.ITextModel,
  offset: number,
  label: string
): Monaco.languages.InlayHint {
  return {
    label: `${label}:`,
    position: model.getPositionAt(offset),
    kind: MonacoLanguages.InlayHintKind.Parameter,
    paddingRight: true,
  };
}

export function createInlayHintProvider(
  connectionId: string | null
): Monaco.languages.InlayHintsProvider {
  return {
    displayName: 'sqlDmlInlayHints',

    provideInlayHints: async (
      model: Monaco.editor.ITextModel,
      _range: Monaco.Range,
      token: Monaco.CancellationToken
    ): Promise<Monaco.languages.InlayHintList> => {
      if (!connectionId) return emptyList();

      const sql = model.getValue();
      const insertTargets = extractInsertTargets(sql);
      const updateTargets = extractUpdateTargets(sql);
      if (insertTargets.length === 0 && updateTargets.length === 0) return emptyList();

      const store = useSchemaStore.getState();
      const needLoad = insertTargets.filter(
        (t) => t.columnNames === null && !store.getTableColumns(connectionId, t.tableName)
      );
      if (needLoad.length > 0) {
        await Promise.all(needLoad.map((t) => store.loadColumns(connectionId, t.tableName)));
      }
      if (token.isCancellationRequested) return emptyList();

      const hints: Monaco.languages.InlayHint[] = [];

      for (const target of insertTargets) {
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
            hints.push(makeHint(model, row[i].offset, name));
          }
        }
      }

      for (const target of updateTargets) {
        for (const a of target.assignments) {
          hints.push(makeHint(model, a.value.offset, a.columnName));
        }
      }

      return { hints, dispose: () => {} };
    },
  };
}
