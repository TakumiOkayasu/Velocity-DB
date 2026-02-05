# Velocity-DB プロジェクト情報

## 概要

Windows専用の高性能RDBMS管理ツール（DataGripライクなUI/UX）。SQL Serverをプライマリターゲットとする。

## 技術スタック

| 領域 | 技術 |
| ------ | ------ |
| Backend | C++23 + ODBC + WebView2 |
| Frontend | React 18 + TypeScript + TanStack Table |
| Build (C++) | CMake + Ninja (MSVC) |
| Build (Frontend) | Vite + Bun |
| Lint | Biome (Frontend), clang-format/clang-tidy (C++), Ruff (Python) |
| Test | Vitest (Frontend), Google Test (C++) |

## プロジェクト構造

```text
Velocity-DB/
├── backend/                # C++ Backend
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
├── docs/                   # ドキュメント
└── scripts/                # Build scripts (Python + uv)
```

## キーボードショートカット

| 操作 | ショートカット |
| ------ | ---------------- |
| SQL実行 | F9, Ctrl+Enter |
| 新規クエリタブ | Ctrl+N |
| タブを閉じる | Ctrl+W |
| SQLフォーマット | Ctrl+Shift+F |
| グローバル検索 | Ctrl+Shift+P |
| 設定 | Ctrl+, |

**注**: F5はページリロード防止のため無効化

## パフォーマンス目標

| 操作 | 目標 |
| ------ | ------ |
| アプリ起動 | < 0.3s |
| SQL Server接続 | < 50ms |
| SELECT (100万行) | < 500ms |
| 結果表示開始 | < 100ms |
| 仮想スクロール | 60fps安定 |
| SQLフォーマット | < 50ms |
| CSVエクスポート (10万行) | < 2s |

## 主要インターフェース

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
