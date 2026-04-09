import type { ColumnActionState } from '../../hooks/useColumnActions';
import { validateIdentifier } from '../../hooks/useColumnActions';
import type { TableActionState } from '../../hooks/useTableActions';
import { InputDialog } from '../dialogs/InputDialog';
import { QueryConfirmDialog } from '../dialogs/QueryConfirmDialog';

interface TreeDialogsProps {
  columnAction: ColumnActionState;
  tableAction: TableActionState;
  onRenameInput: (newName: string) => void;
  onRenameConfirm: () => void;
  onDropColumnConfirm: () => void;
  onDismissColumn: () => void;
  onDropTableConfirm: () => void;
  onTruncateConfirm: () => void;
  onDismissTable: () => void;
}

export function TreeDialogs({
  columnAction,
  tableAction,
  onRenameInput,
  onRenameConfirm,
  onDropColumnConfirm,
  onDismissColumn,
  onDropTableConfirm,
  onTruncateConfirm,
  onDismissTable,
}: TreeDialogsProps) {
  return (
    <>
      <InputDialog
        isOpen={columnAction?.type === 'rename-input'}
        title="カラム名を変更"
        message={`"${columnAction?.type === 'rename-input' ? columnAction.colName : ''}" の新しい名前を入力してください`}
        defaultValue={columnAction?.type === 'rename-input' ? columnAction.colName : ''}
        placeholder="新しいカラム名"
        confirmLabel="変更"
        validate={validateIdentifier}
        onConfirm={onRenameInput}
        onCancel={onDismissColumn}
      />

      <QueryConfirmDialog
        isOpen={columnAction?.type === 'rename-confirm'}
        title="カラム名変更の確認"
        message="以下のSQLを実行します。よろしいですか？"
        details={columnAction?.type === 'rename-confirm' ? columnAction.sql : undefined}
        confirmLabel="実行"
        onConfirm={onRenameConfirm}
        onCancel={onDismissColumn}
      />

      <QueryConfirmDialog
        isOpen={columnAction?.type === 'drop-confirm'}
        title="カラム削除の確認"
        message={`カラム "${columnAction?.type === 'drop-confirm' ? columnAction.colName : ''}" を削除します。この操作は元に戻せません。`}
        details={columnAction?.type === 'drop-confirm' ? columnAction.sql : undefined}
        isDestructive
        confirmLabel="削除"
        onConfirm={onDropColumnConfirm}
        onCancel={onDismissColumn}
      />

      <QueryConfirmDialog
        isOpen={tableAction?.type === 'drop-confirm'}
        title="テーブル削除の確認"
        message={
          tableAction?.type === 'drop-confirm'
            ? `テーブル "${tableAction.tableName}" を削除します。${tableAction.hasFK ? 'FK制約が自動的に削除されます。' : ''}この操作は元に戻せません。`
            : ''
        }
        details={tableAction?.type === 'drop-confirm' ? tableAction.sqls.join(';\n') : undefined}
        isDestructive
        confirmLabel="削除"
        onConfirm={onDropTableConfirm}
        onCancel={onDismissTable}
      />

      <QueryConfirmDialog
        isOpen={tableAction?.type === 'truncate-confirm'}
        title="テーブルを空にする確認"
        message={
          tableAction?.type === 'truncate-confirm'
            ? `テーブル "${tableAction.tableName}" の全データを削除します。${tableAction.hasFK ? 'FK制約が自動的に処理されます。' : ''}`
            : ''
        }
        details={
          tableAction?.type === 'truncate-confirm' ? tableAction.sqls.join(';\n') : undefined
        }
        isDestructive
        confirmLabel="実行"
        onConfirm={onTruncateConfirm}
        onCancel={onDismissTable}
      />
    </>
  );
}
