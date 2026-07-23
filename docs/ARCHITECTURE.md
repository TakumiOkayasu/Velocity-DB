# Velocity-DB アーキテクチャ

## 概要

バックエンド (C++) とフロントエンド (TypeScript/React) で異なる実装パターンを採用しつつ、概念的な一貫性を保つ。

## レイヤー構造

```text
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
├─────────────────────────────────────────────────────────────┤
│  UI Components  │  Zustand Stores  │  Providers (api/providers/) │
└─────────────────────────────────────────────────────────────┘
                              │ IPC (JSON)
┌─────────────────────────────────────────────────────────────┐
│                        Backend (C++)                         │
├─────────────────────────────────────────────────────────────┤
│  IPCHandler  │  Contexts  │  Services  │  Drivers (ODBC)    │
└─────────────────────────────────────────────────────────────┘
```

## コンポーネント対応表

| 責任 | Backend (C++) | Frontend (TS) |
| ------ | --------------- | --------------- |
| **接続管理** | `DatabaseContext` | `connectionStore` |
| **スキーマ取得** | `SchemaProvider` | `schemaStore` |
| **クエリ実行** | `AsyncQueryExecutor` | `queryStore` |
| **設定・セッション** | `SettingsContext` | `sessionStore` |
| **クエリ履歴** | `QueryHistory` | `historyStore` |
| **エクスポート** | `ExportContext` | `exportProvider` |
| **SQL整形** | `UtilityContext` | `queryProvider` |
| **ブックマーク** | `SettingsManager` | `bookmarkStore` |
| **ER図** | - | `erDiagramStore` |
| **編集状態** | - | `editStore` |

## 命名規則

### Backend (C++)

| 種別 | パターン | 例 |
| ------ | ---------- | ----- |
| インターフェース | `I*able` | `IQueryable`, `IExportable` |
| コンテキスト | `*Context` | `DatabaseContext` |
| サービス | `*Manager`, `*Executor` | `SettingsManager` |
| ドライバ | `*Driver` | `SQLServerDriver` |

### Frontend (TypeScript)

| 種別 | パターン | 例 |
| ------ | ---------- | ----- |
| ストア | `*Store` | `connectionStore` |
| フック | `use*` | `useConnections` |
| 型定義 | `I*`, `*Type` | `IConnection` |
| ユーティリティ | `*Utils` | `sqlParser` |

## データフロー

### 接続確立

```text
[Frontend]                              [Backend]
connectionStore.connect()
    │
    ▼
connectionProvider.connectAsync(params)  ──IPC──►  IPCHandler.openDatabaseConnection()
                                      │
                                      ▼
                                  DatabaseContext
                                      │
                                      ▼
                                  ConnectionRegistry.add()
                                      │
                                      ▼
                                  SQLServerDriver.connect()
    │
    ◄─────────── connectionId ────────┘
    │
    ▼
connectionStore.setActive(connectionId)
```

### クエリ実行

```text
[Frontend]                              [Backend]
queryStore.execute(sql)
    │
    ▼
queryProvider.executeAsyncQuery()  ──IPC──►  IPCHandler.executeSQL()
                                   │
                                   ▼
                               ConnectionRegistry.get()
                                   │
                                   ▼
                               SQLServerDriver.execute()
    │
    ◄─────────── ResultSet ────────┘
    │
    ▼
queryStore.setResult(data)
```

## ファイル構成

### Backend

```text
backend/
├── ipc_handler.h/cpp       # IPCルーティング
├── interfaces/             # *able インターフェース
│   ├── queryable.h
│   ├── connectable.h
│   ├── exportable.h
│   └── ...
├── contexts/               # 機能グループ
│   ├── database_context.h/cpp
│   ├── export_context.h/cpp
│   ├── settings_context.h/cpp
│   └── utility_context.h/cpp
├── database/               # DB操作
│   ├── driver_interface.h
│   ├── sqlserver_driver.h/cpp
│   ├── connection_registry.h/cpp
│   └── ...
└── utils/                  # ユーティリティ
```

### Frontend

```text
frontend/src/
├── api/
│   ├── ipc/                # IPC 基盤 (ipc-invoker / ipc-protocol / mock)
│   └── providers/          # IPC ファサード群 (機能別)
│       ├── connection.ts   # 接続管理
│       ├── query.ts        # クエリ実行・履歴・キャッシュ・SQL組立
│       ├── schema.ts       # スキーマ情報
│       ├── transaction.ts  # トランザクション
│       ├── export.ts       # エクスポート
│       ├── settings.ts     # 設定・接続プロファイル・セッション
│       ├── search.ts       # オブジェクト検索
│       ├── io.ts           # ファイル I/O・ブックマーク
│       └── index.ts        # 集約 export (xxxProvider)
├── store/                  # 状態管理 (Zustand, 責務別に分割)
│   ├── index.ts            # barrel export (selector hooks を公開)
│   ├── connectionStore.ts  # 接続状態 (connection/ に polling helper・interface)
│   ├── queryStore.ts       # query/ への再export (後方互換)
│   ├── query/              # クエリ状態 (slice 分割)
│   │   ├── queryStore.ts   # slice 合成 + selector hooks
│   │   ├── slices/         # queryExecute / queryManage / dataView / erDiagram / fileIO / format
│   │   ├── interfaces/     # ISP準拠インターフェース (Executable, DataViewable, ...)
│   │   └── helpers/        # asyncPolling, paginationHelper, queriesMap 等
│   ├── schemaStore.ts      # スキーマツリー状態
│   ├── editStore.ts        # グリッド編集状態 (DML生成元)
│   ├── erDiagramStore.ts   # ER図モデル
│   ├── historyStore.ts     # クエリ履歴
│   ├── bookmarkStore.ts    # ブックマーク
│   ├── sessionStore.ts     # セッション復元
│   ├── scrollPositionStore.ts # グリッドスクロール位置
│   └── toastStore.ts       # トースト通知
├── components/             # UIコンポーネント
├── hooks/                  # カスタムフック
├── types/                  # 型定義
└── utils/                  # ユーティリティ
```

## 設計原則

### 共通

1. **単一責任**: 各モジュールは1つの責任のみ
2. **疎結合**: モジュール間の依存を最小化
3. **テスト容易性**: モック/スタブ差し替え可能な設計

### Backend固有

- **Context Pattern**: DIコンテナとして機能グループを管理
- **RAII**: リソース管理にスマートポインタ使用
- **std::expected**: エラー処理の明示化

### Frontend固有

- **Zustand**: 軽量な状態管理、ボイラープレート最小
- **Selector Pattern**: 必要な状態のみ購読
- **Hooks**: ロジックの再利用
- **Store 分割境界**: 1 store = 1 責務。購読は `store/index.ts` が公開する selector hooks
  (`useQueryActions`, `useActiveQueryMeta` 等) 経由に限定し、コンポーネントから store 全体を
  購読しない (不要な再レンダリング防止)。`queryStore` は機能 slice
  (execute / manage / dataView / erDiagram / fileIO / format) に分割し、slice 間の依存は
  `query/interfaces/` の ISP インターフェースで表現する

## 拡張ガイド

### 新機能追加時

1. **Backend**: Context に機能追加 or 新Context作成
2. **Frontend**: 既存Store拡張 or 新Store作成
3. **IPC**: `IPCHandler` にルート追加、`api/providers/xxx.ts` にメソッド追加 (`api/providers/index.ts` で `xxxProvider` を公開)

### 新DBドライバ追加時

1. `IDatabaseDriver` を実装
2. `DriverFactory` に登録
3. フロントエンドは変更不要 (抽象化済み)
