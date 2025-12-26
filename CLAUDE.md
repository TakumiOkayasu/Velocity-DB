# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## 🚨 Claude Codeへの絶対的な指示 🚨

**ユーザーからコード変更を伴うタスクを受け取ったら、他の何よりも先に以下を実行すること：**

### タスク受領時の必須アクション（例外なし）

1. **まず `git branch --show-current` で現在のブランチを確認**
2. **作業内容と現在のブランチ名が一致するか判断**
   - 一致しない場合 → mainから新しいブランチを作成
   - ブランチ名: `feat/機能名` または `feature/機能名` (kebab-case)
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feat/機能名  # 例: feat/fix-pylance-warnings
   ```
3. **ブランチ確認・作成が完了してから、初めてコード変更を開始**

**🚨 この手順を飛ばしてコード変更を開始することは、例外なく禁止 🚨**
**🚨 守らなかった場合、作業をやり直すこと 🚨**

---

## Project Overview

Pre-DateGrip is a Windows-only high-performance RDBMS management tool with DataGrip-like UI/UX, targeting SQL Server as the primary database.

**Tech Stack:**

- Backend: C++23 + ODBC + WebView2
- Frontend: React 18 + TypeScript + TanStack Table
- Build: CMake + Ninja (C++), Vite (Frontend)

## Build Commands

**重要**: すべてのビルドは `uv run scripts/pdg.py` を使用すること。

Requirements: Python 3.14+, uv (`winget install astral-sh.uv`)

### 基本コマンド

```bash
# ビルド
uv run scripts/pdg.py build backend              # C++ (Release)
uv run scripts/pdg.py build backend --type Debug # C++ (Debug)
uv run scripts/pdg.py build backend --clean      # クリーンビルド
uv run scripts/pdg.py build frontend             # フロントエンド
uv run scripts/pdg.py build all                  # 全体ビルド

# テスト
uv run scripts/pdg.py test backend               # C++テスト
uv run scripts/pdg.py test frontend              # フロントエンドテスト
uv run scripts/pdg.py test frontend --watch      # Watchモード

# Lint (プロダクトコード: Frontend + C++)
uv run scripts/pdg.py lint                       # 全体Lint
uv run scripts/pdg.py lint --fix                 # 自動修正

# Lint (ビルドスクリプト: Python) - 別途実行
ruff check scripts/                              # チェックのみ
ruff check --fix scripts/ && ruff format scripts/  # 自動修正

# 開発
uv run scripts/pdg.py dev                        # 開発サーバー (localhost:5173)

# その他
uv run scripts/pdg.py check Release              # 全チェック (lint + test + build)
uv run scripts/pdg.py package                    # リリースパッケージ作成
uv run scripts/pdg.py --help                     # ヘルプ表示
```

### ショートカット

`build` → `b`, `test` → `t`, `lint` → `l`, `dev` → `d`, `check` → `c`, `package` → `p`

```bash
uv run scripts/pdg.py b backend --clean          # 短縮形
uv run scripts/pdg.py t frontend --watch
uv run scripts/pdg.py l --fix
```

### フロントエンド直接実行（オプション）

開発時は Bun を直接使用可能：

```bash
cd frontend
bun run dev          # 開発サーバー
bun run test         # テスト
bun run lint         # Lint
```

## 重要な指示 (Instructions for Claude)

### 必須ルール

1. **作業開始前にブランチを作成（最重要）**
   - **ブランチは必ずmainから切ること**（他のブランチから切らない）
   - 作業開始前に必ず以下を実行して確認：
     ```bash
     git checkout main
     git pull origin main
     git checkout -b feat/機能名
     ```
   - ブランチ名の形式: `feature/機能名` または `feat/機能名` (kebab-case)
   - 例: `feature/multi-statement-results`, `feat/inline-editing`
   - 作業内容が変わる場合は、必ず新しいブランチを作成してからコード変更を開始すること

2. **Pythonスクリプトは `uv run` 経由で実行**
   - 例: `uv run scripts/pdg.py build backend`

3. **git commit/push は絶対禁止**
   - コミットメッセージを考えるだけ

4. **変更時の確認事項**
   - ドキュメント (CLAUDE.md, README.md) を更新
   - CI/CD (`.github/workflows/`) の更新確認
   - 後方互換性の維持

5. **作業完了時の必須チェック**

   ```bash
   # プロダクトコード (Frontend + C++)
   uv run scripts/pdg.py lint

   # ビルドスクリプト (Python) - 別途実行
   ruff check scripts/ && ruff format --check scripts/

   # または個別に
   cd frontend && bun run lint         # フロントエンドのみ
   ```

   **重要: Pythonスクリプト変更時の必須ルール**
   - `scripts/` 内のファイルを変更した場合、**必ず** `ruff check scripts/` を実行して警告・エラーがゼロであることを確認
   - VSCodeのPylance警告も**必ず解消**すること（型ヒント不足、型の不一致など）
   - 警告・エラーが残ったままコミットメッセージを考えない

### コーディング規約

#### Python (Build Scripts)

- **Ruff** で Lint + Format (`uv pip install ruff`)
- Python 3.14+ の型ヒントを使用
- pyproject.toml で設定管理
- 行長: 100文字
- インデント: スペース4個

#### フロントエンド (TypeScript/React)

- Biome で Lint (`bun run lint`)
- 非nullアサーション (`!`) 禁止 → 明示的なnullチェック
- CSS Modules 使用
- Zustand で状態管理

#### バックエンド (C++)

- C++23 機能を使用 (std::expected, std::format, std::ranges)
- clang-format 21 で自動フォーマット
- RAII原則 (スマートポインタ)
- ODBC戻り値は必ずチェック
- 変数は基本 `auto` を使用

#### 改行コード

- CRLF (Windows) で統一
- Husky が自動変換

## Project Structure

```text
Pre-DateGrip/
├── backend/                # C++ Backend (ODBC, WebView2, IPC)
│   ├── database/           # 接続、プール、キャッシュ、非同期実行
│   ├── parsers/            # SQLフォーマッター、A5:ER
│   ├── exporters/          # CSV/JSON/Excel
│   └── utils/              # SIMD、設定、セッション、検索
├── frontend/               # React Frontend
│   └── src/
│       ├── api/            # IPC bridge
│       ├── components/     # UI (Monaco Editor, TanStack Table)
│       └── store/          # Zustand stores
├── tests/                  # Google Test (C++)
└── scripts/                # Build scripts (Python + uv)
    ├── pdg.py              # Unified CLI entry point
    └── _lib/               # Shared utilities
```

## Technology Stack

### Build Scripts (Python 3.14+)

- Runtime: uv
- Lint/Format: Ruff
- Config: pyproject.toml

### Backend (C++23)

- Build: CMake + Ninja (MSVC)
- WebView: webview/webview (WebView2)
- Database: ODBC Native API (SQL Server)
- JSON: simdjson
- XML: pugixml (A5:ER)
- SIMD: AVX2
- Lint: clang-format, clang-tidy

### Frontend (React + TypeScript)

- Runtime: Bun
- Build: Vite
- UI: React 18
- Editor: Monaco Editor
- Table: TanStack Table (Virtual Scrolling)
- State: Zustand
- ER Diagram: React Flow
- Lint: Biome 2.3.8
- Test: Vitest

### CI/CD

- GitHub Actions (LLVM 21, Bun, Biome, Ruff)
- Google Test (C++), Vitest (Frontend)

## Development Guidelines

1. **TDD**: テストを先に書く
2. **CI-first**: すべてのコミットはCIを通す
3. **UI/UX**: DataGripのUI/UXを忠実に再現
4. **エラー処理**: ODBCの戻り値を必ずチェック
5. **メモリ管理**: RAII原則に従う
6. **パフォーマンス**: Virtual Scrolling、SIMD、非同期処理

## Performance Targets

| 操作 | 目標 |
|------|------|
| アプリ起動 | < 0.3s |
| SQL Server接続 | < 50ms |
| SELECT (100万行) | < 500ms |
| 結果表示開始 | < 100ms |
| 仮想スクロール | 60fps安定 |
| SQLフォーマット | < 50ms |
| CSVエクスポート (10万行) | < 2s |

## Troubleshooting

### ビルドエラー

**Ninja Permission Error**:

- `ninja: error: failed recompaction: Permission denied`
- 自動回復機能あり（最大3回リトライ）
- VSCode/Visual Studio を閉じる、PreDateGrip.exe を終了

**MSVC Not Found**:

- Developer Command Prompt for VS 2022 から実行
- または `uv run scripts/pdg.py build backend` を使用

### フロントエンドのデバッグ

**UI問題が発生したら**:

- Claude が `log/frontend.log` と `log/backend.log` を自動解析
- ユーザーは問題を報告するだけでOK

**フロントエンドの変更が反映されない**:

```bash
uv run scripts/pdg.py build frontend --clean
```

WebView2キャッシュは自動削除される。

**ログファイル**:

- `log/frontend.log` - フロントエンドログ
- `log/backend.log` - バックエンドログ
- アプリ起動時に自動削除される

## Issue Workflow

**自動セキュリティスキャン**: 毎日 JST 00:00 実行

**対応手順**:

1. `gh issue list --state open` で確認
2. 優先度順に対応 (`priority:critical` > `high` > `medium` > `low`)
3. 修正後、コミットメッセージにまとめる
4. `gh issue close <number>` でクローズ

**Semgrep警告の抑制**:

```python
# nosemgrep: python.lang.security.audit.subprocess-shell-true
result = subprocess.run(cmd, shell=True)  # Safe: hardcoded paths only
```

## Key Interfaces (Reference)

### Backend (C++)

```cpp
// SchemaInspector
std::vector<TableInfo> getTables(const std::string& database);
std::vector<ColumnInfo> getColumns(const std::string& table);

// TransactionManager
void begin();
void commit();
void rollback();
```

### Frontend (TypeScript)

```typescript
// Zustand Stores
interface ConnectionStore {
    connections: Connection[];
    activeConnectionId: string | null;
    addConnection: (conn: Connection) => void;
}

interface QueryStore {
    queries: Query[];
    executeQuery: (id: string) => Promise<void>;
}
```

---

## Keyboard Shortcuts

Pre-DateGripは以下のキーボードショートカットをサポートしています：

### SQL実行
- **F9** - SQL実行（1キー、推奨）
- **Ctrl+Enter** - SQL実行（2キー）

### クエリ管理
- **Ctrl+N** - 新規クエリタブを作成

### SQL編集
- **Ctrl+Shift+F** - SQLフォーマット（整形）

### ナビゲーション
- **Ctrl+Shift+P** - グローバル検索を開く
- **Ctrl+,** - 設定を開く

### その他
- **F5** - 無効化（ページリロード防止）

**注**: F5キーはブラウザのリロードと競合するため、SQL実行には使用できません。代わりにF9キーを使用してください。

---

## TODO / Future Enhancements

### 🔴 高優先度（UX向上に直結）

1. **履歴からのSQL実行機能**
   - 実装場所: `frontend/src/components/history/HistoryItem.tsx:44`
   - 内容: 履歴アイテムをダブルクリックしたときにSQLを自動実行
   - 影響: ユーザーが過去のクエリを素早く再実行できる
   - 想定工数: 1時間

2. **Ctrl+Wでタブを閉じる**
   - 実装場所: `frontend/src/components/tabs/`
   - 内容: 一般的なブラウザ/エディタと同じショートカットでタブを閉じる
   - 影響: 直感的なタブ操作
   - 想定工数: 1時間

3. **ツリーノードのコンテキストメニュー**
   - 実装場所: `frontend/src/components/tree/TreeNode.tsx:151`
   - 内容: 右クリックで「SELECT文生成」「テーブル削除」「データエクスポート」など
   - 影響: DataGripライクなUX実現
   - 想定工数: 1-2日

### 🟡 中優先度（機能拡張）

4. **UIを本家DataGripに近づける** ([#56](https://github.com/okayasunet/Pre-DateGrip/issues/56))
   - 内容: カラースキーム、アイコン、レイアウトの改善
   - 継続的なタスク

5. **クエリ結果のソート・フィルタリング**
   - 実装場所: `frontend/src/components/results/ResultsTable.tsx`
   - 内容: カラムヘッダークリックでソート、フィルタ入力欄
   - 想定工数: 1-2日

6. **複数SQL文の個別実行**
   - 内容: エディタ内でカーソル位置の文のみ実行（Ctrl+Enter）
   - 現状: 全体実行のみ
   - 想定工数: 2-3日

7. **クエリブックマーク機能**
   - 内容: よく使うクエリを保存・管理（履歴とは別の永続的な保存）
   - 想定工数: 2-3日

### 🟢 低優先度（配布・運用フェーズ）

8. **インストーラーの用意** ([#34](https://github.com/okayasunet/Pre-DateGrip/issues/34))
   - 内容: WiXまたはInno Setupでインストーラー作成
   - 想定工数: 3-5日

9. **自動更新機能**
   - 内容: 新バージョンのチェック・自動更新
   - 想定工数: 2-3日

10. **エクスポート形式の拡張**
    - 現状: CSV, JSON, Excel対応
    - 追加: Markdown, HTML, SQL INSERT文
    - 想定工数: 1-2日

### 📋 技術的改善（パフォーマンス・品質）

11. **クエリキャンセル機能**
    - 内容: 長時間実行中のクエリを途中でキャンセル
    - 想定工数: 2-3日

12. **接続プールの最適化**
    - 実装場所: `backend/database/connection_pool.cpp`
    - 改善: タイムアウト設定、ヘルスチェック、接続再利用の改善
    - 想定工数: 1-2日

13. **エラーハンドリングの改善**
    - 内容: より詳細なエラーメッセージとリカバリー提案
    - 想定工数: 継続的なタスク

### ✅ 完了済み

- **SQLフォーマット** (Ctrl+Shift+F) - `backend/parsers/sql_formatter.cpp` で実装済み
- **SQLキーワード大文字変換** - Ctrl+Shift+Fでフォーマットと同時に実行
- **SQLキーワード外部ファイル化** - `config/sql_keywords.txt` で管理
- **複数SQL文の実行** - タブ式の結果表示で実装済み
- **インライン編集** - セル編集機能実装済み

---

**詳細なトラブルシューティング、API仕様は必要に応じて追記。基本的な開発フローは上記で完結。**
