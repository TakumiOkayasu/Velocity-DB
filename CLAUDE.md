# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Velocity-DB固有の指示。グローバルルール (`~/.claude/CLAUDE.md`) に従った上で、以下を適用。

## プロジェクト概要

Windows専用RDBMS管理ツール（DataGripライクなUI/UX）。SQL Server / PostgreSQL / MySQL対応（ODBC経由）。

- Backend: C++ + ODBC + WebView2
- Frontend: React + TypeScript + Vite + TanStack Table + Zustand
- Build Scripts: Python + uv
- Lint: Biome (Frontend), clang-format (C++), Ruff (Python)
- Test: Vitest (Frontend unit), Playwright (Frontend E2E), Google Test (C++)

## ビルドコマンド

統合CLI: `uv run scripts/pdg.py` (ショートカット: `b`uild, `t`est, `l`int, `d`ev, `c`heck)

```bash
uv run scripts/pdg.py build backend              # C++ (Release)
uv run scripts/pdg.py build backend --type Debug  # C++ (Debug)
uv run scripts/pdg.py build frontend              # フロントエンド
uv run scripts/pdg.py build all                   # 全体ビルド
uv run scripts/pdg.py test backend                # C++テスト (Google Test)
uv run scripts/pdg.py test frontend               # フロントエンドテスト (Vitest)
uv run scripts/pdg.py test e2e                    # E2Eテスト (Playwright)
uv run scripts/pdg.py lint                        # Frontend + C++
uv run scripts/pdg.py lint --fix                  # 自動修正
uv run scripts/pdg.py dev                         # 開発サーバー (localhost:5173)
uv run scripts/pdg.py check Release               # 全チェック (lint + test + build)
ruff check scripts/ && ruff format scripts/       # Python lint (別途)
```

## Frontendテスト (Docker必須)

hookが node/npm 直接実行をブロックするため、Docker経由で実行:

```bash
# 全テスト (Vitest)
docker run --rm -v "C:/prog/Velocity-DB://app" \
  --mount "type=volume,target=//app/frontend/node_modules" \
  -w "//app/frontend" oven/bun:latest \
  sh -c 'bun install && bunx vitest run --reporter=verbose'

# 単一テストファイル
docker run --rm -v "C:/prog/Velocity-DB://app" \
  --mount "type=volume,target=//app/frontend/node_modules" \
  -w "//app/frontend" oven/bun:latest \
  sh -c 'bun install && bunx vitest run --reporter=verbose src/tests/hooks/useColumnActions.test.ts'

# biome lint (変更ファイルのみ)
docker run --rm -v "C:/prog/Velocity-DB://app" \
  --mount "type=volume,target=//app/frontend/node_modules" \
  -w "//app/frontend" oven/bun:latest \
  sh -c 'bun install && bunx biome check src/path/to/file.ts'

# E2Eテスト (Playwright)
docker run --rm -v "C:/prog/Velocity-DB://app" \
  --mount "type=volume,target=//app/frontend/node_modules" \
  -w "//app/frontend" oven/bun:latest \
  sh -c 'bun install && bunx playwright install --with-deps chromium && bunx playwright test'
```

`--mount type=volume` で node_modules を隔離（Windows/Linux バイナリ非互換対策）。

## 作業完了時の必須チェック

```bash
uv run scripts/pdg.py lint
ruff check scripts/ && ruff format --check scripts/
```

## アーキテクチャ

### IPC通信フロー

```text
Frontend → window.invoke(JSON) → Backend ipc_handler.cpp → providers/ → database/ → JSON応答
Frontend ← api/bridge.ts (Promiseラップ) ←────────────────────────────────────────────────┘
```

### Backend 構造 (C++)

```text
backend/
├── ipc_handler.cpp           # IPCルーティング (m_routes にルート登録)
├── interfaces/               # ISP準拠インターフェース (*able.h)
├── contexts/system_context   # DIコンテナ (全Providerを保持)
├── providers/                # IPCハンドラ実装
│   ├── connection_provider   # 接続管理
│   ├── query_provider        # クエリ実行 (最大モジュール)
│   ├── schema_provider       # スキーマ情報
│   ├── settings_provider     # 設定管理
│   ├── export_provider       # データエクスポート
│   └── ...                   # transaction, search, io, utility
└── database/                 # DB操作
    ├── driver_interface.h    # 抽象ドライバ
    ├── sqlserver_driver/dialect
    ├── postgresql_driver/dialect
    ├── driver_factory.cpp    # DriverType → 具象クラス生成
    ├── connection_registry   # 接続プール管理
    ├── async_query_executor  # 非同期クエリ実行
    ├── result_cache          # LRUキャッシュ (100MB)
    └── schema_inspector      # スキーマ情報取得
```

### Frontend 構造 (React)

```text
frontend/
├── src/
│   ├── api/bridge.ts         # IPC通信 (Backend全メソッドのPromiseラッパー)
│   ├── store/                # Zustand stores (connection, query, edit, schema, session, ...)
│   ├── components/           # UI (grid/, tree/, editor/, diagram/, dialogs/, export/, ...)
│   ├── hooks/                # カスタムhooks (useDialogKeyboard, useKeyboardHandler, ...)
│   ├── types/                # 型定義
│   └── utils/                # ユーティリティ
├── e2e/                      # Playwright E2Eテスト
└── src/tests/                # Vitest ユニットテスト
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

- モダンC++: `std::expected`, `std::format`, `std::ranges`
- RAII + スマートポインタ、変数は基本 `auto`
- ODBC戻り値は必ず `SQL_SUCCESS` チェック
- clang-format

### TypeScript/React (frontend/)

- 非nullアサーション (`!`) 禁止 → 明示的nullチェック
- CSS Modules、Zustand、memo化 (GridToolbar, GridStatusBar, ResultGrid)
- biome: lineWidth 100, シングルクォート, セミコロンあり
- イベントハンドラ名に `handle` 接頭辞禁止（`deleteRow` ✅ / `handleDeleteRow` ❌）
- **`utils/logger.ts` は最下層ユーティリティ**: `api/bridge` や `api/providers/*` 等の facade / 上位層を import 禁止。backend への書き出しは `window.invoke` 直叩きで行う (#556: 循環参照解消)。各 Bridge 抽出 (#521-#527) でも同原則を維持する

### Python (scripts/)

- Ruff lint + format、型ヒント必須

## ドキュメント参照

| ファイル | 内容 |
| ---------- | ------ |
| `docs/ARCHITECTURE.md` | レイヤー構造、コンポーネント対応表 |
| `docs/TROUBLESHOOTING.md` | トラブルシューティング |
| `docs/VISUAL_STUDIO_SETUP.md` | VS2022 でのデバッグ手順 |

## Claude Code責任範囲

UI問題発生時: `log/frontend.log` と `log/backend.log` を確認 → エラー原因特定 → 修正。
