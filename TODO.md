# TODO / Future Enhancements

このファイルはPre-DateGripの残タスクを管理します。

## 🚨 Claude Code向けルール 🚨

1. **作業開始前に必ずこのファイルを確認**
2. **タスク完了後は該当項目を削除または「完了済み」セクションに移動**
3. **新しいタスクが発生したらこのファイルに追記**

---

## 🔴 高優先度（UX向上に直結）

1. **SSH接続でDBにアクセス** ★★★
   - 内容: SSHトンネル経由でリモートDBに接続
   - DataGrip: SSH/SSL接続オプション

2. **テーブルデータの更新ボタン** ★
   - 内容: データビュー画面にリフレッシュボタンを設置し、最新データを再取得
   - 影響: 編集後やDB変更後に手動で最新状態を確認可能

2. **ツリーノードのコンテキストメニュー** ★★
   - 実装場所: `frontend/src/components/tree/TreeNode.tsx:151`
   - 内容: 右クリックで「SELECT文生成」「テーブル削除」「データエクスポート」など
   - 影響: DataGripライクなUX実現

3. **行の複製 (Clone Row)** ★
   - 内容: 選択行を複製して新規行として追加 (DataGripのClone Row機能)
   - ショートカット: Ctrl+D

4. **関連レコードへのジャンプ (Related Rows)** ★★★
   - 内容: FK列からリンク先テーブルの該当レコードへ移動 (F4)
   - 影響: テーブル間のデータ追跡が容易に

5. **値エディタ (Value Editor)** ★★
   - 内容: 長文やJSON等をポップアップで編集 (Shift+Enter)
   - 影響: 大きなデータの編集が容易に

## 🟡 中優先度（機能拡張）

1. **クエリ結果のソート・フィルタリング** ★★
   - 実装場所: `frontend/src/components/grid/ResultGrid.tsx`
   - 内容: カラムヘッダークリックでソート、各列にフィルタ入力欄
   - DataGrip: ローカルフィルタ + WHERE句フィルタ両対応

2. **複数SQL文の個別実行** ★★★
   - 内容: エディタ内でカーソル位置の文のみ実行（Ctrl+Enter）
   - 現状: 全体実行のみ

3. **データ比較機能** ★★★★
   - 内容: 2つのテーブルまたはクエリ結果の差分表示
   - DataGrip: テーブル比較ツール

4. **スキーマ比較・移行スクリプト生成** ★★★★★
   - 内容: 2つのスキーマを比較し、差分DDLを自動生成
   - 影響: DB移行作業の効率化

5. **コード補完の強化** ★★★★
   - 内容: テーブル名、カラム名、エイリアスの文脈依存補完
   - DataGrip: スキーマ認識のインテリセンス

6. **リファクタリング機能** ★★★★★
   - 内容: テーブル/カラム名変更時に参照箇所を追跡・一括変更
   - DataGrip: Rename refactoring

7. **データ表示モードの追加** ★★★
   - 内容: Tree表示、Transpose(行列入替)表示
   - DataGrip: Table/Tree/Text/Transpose の4モード

8. **UIを本家DataGripに近づける** ★★ ([#56](https://github.com/TakumiOkayasu/Pre-DateGrip/issues/56))
   - 内容: カラースキーム、アイコン、レイアウトの改善
   - 継続的なタスク

9. **本番環境リードオンリーモード** ★★
    - 内容: 環境設定で「本番」指定時はDML/DDLを制限
    - 影響: 誤操作によるデータ破壊を防止

11. **環境別ツリーカラー表示** ★
    - 内容: 接続環境（開発/ステージング/本番）に応じてツリーノードに色を付与
    - DataGrip: カラーマーキング機能

## 🟢 低優先度（配布・運用フェーズ）

1. **エクスポート形式の拡張** ★★
   - 現状: CSV, JSON, Excel対応
   - 追加: Markdown, HTML, SQL INSERT文

2. **インポート機能** ★★★
   - 内容: CSV, JSON等からテーブルへデータインポート
   - DataGrip: Import Data機能

3. **DDLデータソース対応** ★★★★
   - 内容: SQLファイルをデータソースとして扱い、スキーマ情報を抽出
   - DataGrip: DDL Data Source

4. **VCS統合** ★★★★★
   - 内容: Git連携でスキーマ変更履歴を管理
   - DataGrip: Version Control integration

5. **インストーラーの用意** ★★ ([#34](https://github.com/TakumiOkayasu/Pre-DateGrip/issues/34))
   - 内容: WiXまたはInno Setupでインストーラー作成

6. **自動更新機能** ★★★
   - 内容: 新バージョンのチェック・自動更新

## 📋 技術的改善（パフォーマンス・品質）

1. **クエリキャンセル機能の改善** ★★
   - 内容: 長時間実行中のクエリを途中でキャンセル、進捗表示

2. **接続プールの最適化** ★★★
   - 実装場所: `backend/database/connection_pool.cpp`
   - 改善: タイムアウト設定、ヘルスチェック、接続再利用の改善

3. **エラーハンドリングの改善** ★★
   - 内容: より詳細なエラーメッセージとリカバリー提案
   - DataGrip: Fix with AI的な修正提案

4. **変更プレビュー機能** ★★
   - 内容: INSERT/UPDATE/DELETE実行前にDML文をプレビュー
   - DataGrip: Preview pending changes

5. **フラグメント・イントロスペクション** ★★★★
   - 内容: DDL実行後に影響を受けたオブジェクトのみを再読み込み
   - DataGrip 2024.3: Fragment introspection

---

## ✅ 完了済み

- **SQLフォーマット** (Ctrl+Shift+F) - `backend/parsers/sql_formatter.cpp` で実装済み
- **SQLキーワード大文字変換** - Ctrl+Shift+Fでフォーマットと同時に実行
- **SQLキーワード外部ファイル化** - `config/sql_keywords.txt` で管理
- **複数SQL文の実行** - タブ式の結果表示で実装済み
- **インライン編集** - セル編集機能実装済み
- **履歴からのSQL実行機能** - ダブルクリックで実行 (b899ab6)
- **Ctrl+Wでタブを閉じる** - `MainLayout.tsx:233-235` で実装済み
- **クエリブックマーク機能** - クエリ保存/読み込み機能 (a579f1f)
