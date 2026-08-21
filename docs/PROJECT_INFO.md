# Velocity-DB プロジェクト情報

## 概要

Windows専用の高性能RDBMS管理ツール（DataGripライクなUI/UX）。SQL Server / PostgreSQL / MySQLに対応（ODBC経由）。

## 技術スタック

| 領域 | 技術 |
| ------ | ------ |
| Backend | C++23 + ODBC + WebView2 |
| Frontend | React + TypeScript + TanStack Table |
| Build (C++) | CMake + Ninja (MSVC) |
| Build (Frontend) | Vite+ |
| Lint/Format | Vite+ (Oxlint/Oxfmt, Frontend), clang-format (C++), Ruff (Python) |
| Test | Vitest (Frontend unit), Playwright (Frontend E2E), Google Test (C++) |

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

### グリッド操作

| 操作 | 動作 |
| ------ | ------ |
| ヘッダークリック | 1列全行選択 |
| ヘッダー Shift+クリック | 列範囲全行選択 |
| セルクリック | 1セル選択 |
| セル Shift+クリック (同一列) | 同一列内の行範囲セル選択 |
| セル Shift+クリック (異なる列) | 単一セル選択にフォールバック |
| 行番号クリック | 行toggle、列選択解除 |
| 行番号 Shift+クリック | 行範囲選択、列選択解除 |
| Ctrl+C | 選択コピー (1列=値リスト、複数列=TSV) |
| Ctrl+Shift+C | SQL INSERTコピー |
| F2 | セル編集開始 (1セル選択時) |
| F4 | 関連行ナビゲート (1セル選択時) |
| Shift+Enter | 値エディタ (1セル選択時) |
| Delete | 行削除 (編集モード) |
| Ctrl+D | 行クローン (編集モード) |
| Insert | 行挿入 (編集モード) |
| Ctrl+S | 変更保存 |
| Ctrl+Shift+N | NULL設定 (1セル選択時) |

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
// SchemaProvider (IPC handler; SQL は dialect 経由で生成して driver で実行)
std::string getTables(std::string_view params);
std::string getColumns(std::string_view params);

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
