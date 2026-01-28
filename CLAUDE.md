# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Velocity-DB固有の指示。グローバルルール (`~/.claude/CLAUDE.md`) に従った上で、以下を適用。

## プロジェクト概要

Windows専用RDBMS管理ツール（DataGripライクUI）。SQL Server対象。

- Backend: C++23 + ODBC + WebView2
- Frontend: React 18 + TypeScript + TanStack Table

## アーキテクチャ（Big Picture）

### IPC通信フロー
1. Frontend → `window.ipc(method, params)` でメッセージ送信
2. Backend → `ipc_handler.cpp` でルーティング・JSON解析
3. Backend → 各機能モジュール（`database/`, `parsers/`, `exporters/`）で処理
4. Backend → JSON形式で結果を返却
5. Frontend → `api/bridge.ts` でPromiseラップしてReactで利用

### データベース層の仕組み
- **ConnectionPool**: 最大10接続を維持、非アクティブ接続を自動切断
- **AsyncQueryExecutor**: 別スレッドでクエリ実行、メインスレッドをブロックしない
- **ResultCache**: LRUキャッシュ（100MB）、同一クエリの高速化
- **TransactionManager**: BEGIN/COMMIT/ROLLBACK管理（C++実装済み、UI未実装）

### セッション管理
- `utils/session_manager.cpp` がウィンドウ状態・開いているタブ・接続プロファイルをJSONで永続化
- アプリ終了時に自動保存、起動時に復元

## ビルドコマンド

```bash
# 開発時によく使うコマンド
uv run scripts/pdg.py build backend              # C++ (Release)
uv run scripts/pdg.py build backend --type Debug # C++ (Debug)
uv run scripts/pdg.py build backend --clean      # クリーンビルド
uv run scripts/pdg.py build frontend             # フロントエンド
uv run scripts/pdg.py build all                  # 全体ビルド

# テスト
uv run scripts/pdg.py test backend               # C++テスト
uv run scripts/pdg.py test frontend              # フロントエンドテスト
uv run scripts/pdg.py test frontend --watch      # Watchモード

# Lint
uv run scripts/pdg.py lint                       # Frontend + C++
uv run scripts/pdg.py lint --fix                 # 自動修正
ruff check scripts/ && ruff format scripts/      # Python

# 開発サーバー
uv run scripts/pdg.py dev                        # localhost:5173

# ショートカット: build → b, test → t, lint → l, dev → d
uv run scripts/pdg.py b backend --clean
uv run scripts/pdg.py t frontend --watch
uv run scripts/pdg.py l --fix
```

詳細: `docs/BUILD_COMMANDS.md`

## 作業完了時の必須チェック

```bash
uv run scripts/pdg.py lint                        # Frontend + C++
ruff check scripts/ && ruff format --check scripts/  # Python
```

## コーディング規約（重要ポイント）

### C++ (backend/)
- **C++23機能を使用**: `std::expected`, `std::format`, `std::ranges`
- **RAII原則**: スマートポインタ、リソース管理
- **ODBC戻り値は必ずチェック**: `SQL_SUCCESS`の確認必須
- **変数は基本`auto`**: 型推論を活用
- **clang-format 21**: 自動フォーマット

### TypeScript/React (frontend/)
- **非nullアサーション (`!`) 禁止**: 明示的なnullチェックを使用
- **CSS Modules**: スタイル衝突を防止
- **Zustand**: 状態管理

### Python (scripts/)
- **Ruff**: Lint + Format
- **型ヒント必須**: Python 3.14+の型システムを活用

詳細: `docs/CODING_STANDARDS.md`

## ドキュメント参照

必要に応じて以下を読み込んで情報を提供:

| ファイル | 内容 |
|----------|------|
| `TODO.md` | 残タスク一覧（作業前に確認） |
| `docs/PROJECT_INFO.md` | 技術スタック、構造、ショートカット |
| `docs/BUILD_COMMANDS.md` | ビルドコマンド詳細 |
| `docs/CODING_STANDARDS.md` | コーディング規約 |
| `docs/TROUBLESHOOTING.md` | トラブルシューティング |

## Claude Code責任範囲

### UI問題発生時

1. `log/frontend.log` と `log/backend.log` を確認
2. エラー原因を特定して修正
3. ユーザーは問題を報告するだけでOK
