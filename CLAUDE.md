# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Velocity-DB固有の指示。グローバルルール (`~/.claude/CLAUDE.md`) に従った上で、以下を適用。

## プロジェクト概要

Windows専用RDBMS管理ツール。SQL Server / PostgreSQL / MySQL対応（ODBC経由）。

- Backend: C++23 + ODBC + WebView2
- Frontend: React 19 + TypeScript 5.9 + Vite 7 + TanStack Table + Zustand 5

## ビルドコマンド

統合CLI: `uv run scripts/pdg.py` (ショートカット: `b`uild, `t`est, `l`int, `d`ev, `c`heck)

```bash
uv run scripts/pdg.py build backend              # C++ (Release)
uv run scripts/pdg.py build backend --type Debug  # C++ (Debug)
uv run scripts/pdg.py build frontend              # フロントエンド
uv run scripts/pdg.py build all                   # 全体ビルド
uv run scripts/pdg.py test backend                # C++テスト
uv run scripts/pdg.py test frontend               # フロントエンドテスト
uv run scripts/pdg.py lint                        # Frontend + C++
uv run scripts/pdg.py lint --fix                  # 自動修正
uv run scripts/pdg.py dev                         # 開発サーバー (localhost:5173)
uv run scripts/pdg.py check Release               # 全チェック (lint + test + build)
ruff check scripts/ && ruff format scripts/       # Python lint (別途)
```

## Frontendテスト (Docker必須)

hookが node/npm 直接実行をブロックするため、Docker経由で実行:

```bash
# 全テスト
docker run --rm -v "C:/prog/Velocity-DB://app" \
  --mount "type=volume,target=//app/frontend/node_modules" \
  -w "//app/frontend" node:latest \
  sh -c 'npm install && npx vitest run --reporter=verbose'

# 単一テストファイル
docker run --rm -v "C:/prog/Velocity-DB://app" \
  --mount "type=volume,target=//app/frontend/node_modules" \
  -w "//app/frontend" node:latest \
  sh -c 'npm install && npx vitest run --reporter=verbose src/tests/hooks/useColumnActions.test.ts'

# biome lint (変更ファイルのみ)
docker run --rm -v "C:/prog/Velocity-DB://app" \
  --mount "type=volume,target=//app/frontend/node_modules" \
  -w "//app/frontend" node:latest \
  sh -c 'npm install && npx biome check src/path/to/file.ts'
```

`--mount type=volume` で node_modules を隔離（Windows/Linux バイナリ非互換対策）。

## 作業完了時の必須チェック

```bash
uv run scripts/pdg.py lint
ruff check scripts/ && ruff format --check scripts/
```

## アーキテクチャ

### IPC通信フロー

```
Frontend → window.invoke(JSON) → Backend ipc_handler.cpp → providers/ → database/ → JSON応答
Frontend ← api/bridge.ts (Promiseラップ) ←────────────────────────────────────────────────┘
```

### Backend 構造 (C++23)

```
backend/
├── ipc_handler.cpp          # IPCルーティング (m_routes にルート登録)
├── interfaces/              # ISP準拠インターフェース (*able.h)
├── contexts/system_context   # DIコンテナ (全Providerを保持)
├── providers/               # IPCハンドラ実装 (*_provider.cpp)
└── database/                # DB操作
    ├── driver_interface.h   # 抽象ドライバ
    ├── sqlserver_driver.cpp + sqlserver_dialect.cpp
    ├── postgresql_driver.cpp + postgresql_dialect.cpp
    ├── driver_factory.cpp   # DriverType → 具象クラス生成
    ├── connection_registry   # 接続プール管理
    ├── async_query_executor  # 非同期クエリ実行
    ├── result_cache          # LRUキャッシュ (100MB)
    └── schema_inspector      # スキーマ情報取得
```

### Frontend 構造 (React 19)

```
frontend/src/
├── api/bridge.ts            # IPC通信 (Backend全メソッドのPromiseラッパー)
├── store/                   # Zustand stores (connectionStore, queryStore, editStore, ...)
├── components/              # UI (grid/, tree/, editor/, diagram/, dialogs/, ...)
├── hooks/                   # カスタムhooks (useColumnActions, useCopyToClipboard, ...)
├── types/                   # 型定義
└── utils/                   # ユーティリティ (sqlIdentifier, erDiagramParser, ...)
```

### 新しいIPCメソッド追加手順

1. `ipc_handler.cpp` の `m_routes` にルート登録
2. `providers/` の該当Providerにハンドラ実装
3. `frontend/src/api/bridge.ts` にメソッド追加
4. 必要に応じて `database/*_dialect.cpp` にSQL方言実装

### セッション管理

`utils/session_manager.cpp` がウィンドウ状態・タブ・接続プロファイルをJSON永続化。アプリ終了時自動保存、起動時復元。

## コーディング規約

### C++ (backend/)

- C++23: `std::expected`, `std::format`, `std::ranges`
- RAII + スマートポインタ、変数は基本 `auto`
- ODBC戻り値は必ず `SQL_SUCCESS` チェック
- clang-format 21

### TypeScript/React (frontend/)

- 非nullアサーション (`!`) 禁止 → 明示的nullチェック
- CSS Modules、Zustand、memo化 (GridToolbar, GridStatusBar, ResultGrid)
- biome: lineWidth 100, シングルクォート, セミコロンあり

### Python (scripts/)

- Ruff lint + format、Python 3.14+、型ヒント必須

## 設計参照

- [pre-omusubi architecture](https://github.com/TakumiOkayasu/pre-omusubi/blob/main/docs/architecture.md): ISP, Context Pattern, キャッシュ活用, レイヤー分離

## ドキュメント参照

| ファイル | 内容 |
|----------|------|
| `TODO.md` | 残タスク一覧（作業前に確認） |
| `docs/ARCHITECTURE.md` | アーキテクチャ、コンポーネント対応表 |
| `docs/BUILD_COMMANDS.md` | ビルドコマンド詳細 |
| `docs/CODING_STANDARDS.md` | コーディング規約 |
| `docs/TROUBLESHOOTING.md` | トラブルシューティング |

## Claude Code責任範囲

UI問題発生時: `log/frontend.log` と `log/backend.log` を確認 → エラー原因特定 → 修正。
