# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

Velocity-DB固有の指示。グローバルルール (`~/.Codex/AGENTS.md`) に従った上で、以下を適用。

## プロジェクト概要

Windows専用RDBMS管理ツール（DataGripライクなUI/UX）。SQL Server / PostgreSQL / MySQL対応（ODBC経由）。

- Backend: C++ + ODBC + WebView2
- Frontend: React + TypeScript + Vite+ + TanStack Table + Zustand
- Build Scripts: Python + uv
- Lint/Format: Vite+ (Oxlint/Oxfmt, Frontend), clang-format (C++), Ruff (Python)
- Test: Vitest (Frontend unit), Playwright (Frontend E2E), Google Test (C++)

## ビルド環境

VS 2026 Stable (18.x) とC++ x64ツールを使用する。VS 2022互換は対象外。
ローカル・CIとも`vswhere`による共通検出を使用し、固定インストール先を列挙しない。

## ビルドコマンド

統合CLI: `uv run scripts/pdg.py` (ショートカット: `b`uild, `t`est, `l`int, `d`ev, `c`heck)

> **注**: 初回 `build backend` で project-local vcpkg が `<repo>/vcpkg/` に自動 clone される (約 50MB、`.gitignore` 済)。CMake 4.x と VS 同梱 vcpkg-tool の世代非互換を回避するため必須。

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

## Frontendテスト

Node/Bun/LLVMはmise、プロジェクト内Vite+はfrontendのpackage.json/bun.lockで管理する。
Dockerやグローバルvpは不要。シェルactivationを前提にせず、統合CLIが固定版の実行環境を選択する。

```powershell
mise trust
mise install --locked node bun github:llvm/llvm-project
uv run --locked scripts/pdg.py lint frontend
uv run --locked scripts/pdg.py test frontend
uv run --locked scripts/pdg.py test e2e
uv run --locked scripts/pdg.py build frontend
```

ツール更新時はmise.toml/mise.lock、依存更新時はfrontend/package.json/frontend/bun.lockを更新する。
CIと同じmise版でWindows/Linuxのlockを生成する。未導入・版不一致時の自動インストールや
システムNode/Bunへのフォールバックは追加しない。

## CI の実装規約

全CIで、YAMLはトリガー・依存関係・権限・パラメータ・コマンド呼び出しを定義する。
判定・データ加工・API操作などの処理本体はテスト可能なスクリプトに置き、YAML内へ直接実装しない。
新規追加・変更時は既存のCLI/検証スクリプトを再利用し、正常系・失敗系を検証する。

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
- Oxfmt: lineWidth 100, シングルクォート, セミコロンあり
- イベントハンドラ名に `handle` 接頭辞禁止（`deleteRow` ✅ / `handleDeleteRow` ❌）
- **`utils/logger.ts` は最下層ユーティリティ**: `api/bridge` や `api/providers/*` 等の facade / 上位層を import 禁止。backend への書き出しは `window.invoke` 直叩きで行う (#556: 循環参照解消)。各 Bridge 抽出 (#521-#527) でも同原則を維持する

### Python (scripts/)

- Ruff lint + format、型ヒント必須

## ドキュメント参照

| ファイル | 内容 |
| ---------- | ------ |
| `docs/ARCHITECTURE.md` | レイヤー構造、コンポーネント対応表 |
| `docs/TROUBLESHOOTING.md` | トラブルシューティング |
| `docs/VISUAL_STUDIO_SETUP.md` | VS2026 でのデバッグ手順 |

## Codex責任範囲

UI問題発生時: `log/frontend.log` と `log/backend.log` を確認 → エラー原因特定 → 修正。
