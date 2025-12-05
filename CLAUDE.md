# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pre-DateGrip is a Windows-only high-performance RDBMS management tool with DataGrip-like UI/UX, targeting SQL Server as the primary database.

## Build Commands

All build scripts are Python-based (requires Python 3.14+) and auto-detect MSVC environment.
Scripts use [uv](https://docs.astral.sh/uv/) for execution (install: `winget install astral-sh.uv`).

```bash
# Backend (C++ with CMake)
uv run scripts/build.py Debug       # Debug build
uv run scripts/build.py Release     # Release build

# Run tests
uv run scripts/test.py Debug
uv run scripts/test.py Release

# Frontend (React) - uses Bun
cd frontend
bun install                   # Install dependencies
bun run dev                   # Development server (localhost:5173)
bun run build                 # Production build
bun run test                  # Run tests
bun run lint                  # Lint code (Biome)
bun run lint:fix              # Auto-fix lint issues

# Full project checks
uv run scripts/check_all.py Release   # All checks (EOL, format, lint, build)
uv run scripts/run_lint.py            # Lint only (frontend + C++)
uv run scripts/cpp_check.py all       # C++ only (format, lint, build)
uv run scripts/cpp_check.py format    # C++ format only
uv run scripts/cpp_check.py lint      # C++ lint only
uv run scripts/cpp_check.py build     # C++ build only

# EOL conversion
uv run scripts/convert_eol.py lf frontend/src   # Convert frontend to LF
uv run scripts/convert_eol.py crlf src          # Convert C++ to CRLF

# Package for distribution
uv run scripts/package.py
```

## Current Status

All phases (0-7) are complete. The project includes:

### Backend (C++)
- ODBC SQL Server driver with connection pooling
- IPC handler with 40+ API routes
- Result caching (LRU) and async query execution
- SIMD-optimized filtering (AVX2)
- A5:ER file parser
- SQL formatter
- CSV/JSON/Excel exporters
- Settings and session persistence
- Global database object search

### Frontend (React/TypeScript)
- Monaco Editor integration
- AG Grid with virtual scrolling
- Zustand state management
- ER diagram with React Flow
- Complete API bridge to backend

### Infrastructure
- GitHub Actions CI/CD (LLVM 21, Bun, Biome 2.3.8)
- Google Test for C++, Vitest for frontend
- Python build scripts with uv

## Technology Stack

### Backend (C++23)
- **Build**: CMake + Ninja (MSVC)
- **WebView**: webview/webview (OS WebView2)
- **Database**: ODBC Native API (SQL Server)
- **JSON**: simdjson
- **SQL Parser**: Custom implementation using modern C++23 patterns
- **Optimization**: SIMD (AVX2), Memory-Mapped Files
- **XML Parser**: pugixml (for A5:ER support)
- **Linter/Formatter**: clang-format, clang-tidy

### Frontend (React + TypeScript)
- **Runtime**: Bun (install: `powershell -c "irm bun.sh/install.ps1 | iex"`)
- **Build**: Vite
- **UI**: React 18
- **Editor**: Monaco Editor
- **Table**: AG Grid (Virtual Scrolling)
- **Styling**: CSS Modules + DataGrip dark theme
- **State**: Zustand
- **ER Diagram**: React Flow
- **Linter/Formatter**: Biome 2.3.8 (`winget install biomejs.biome`)

### Testing
- **C++**: Google Test
- **Frontend**: Vitest

### Development Tools
- **Git Hooks**: Husky (pre-commit)
- **EOL Normalization**: convert_eol.py (CRLF for Windows)

## Project Structure

```
Pre-DateGrip/
├── src/                               # C++ Backend
│   ├── main.cpp
│   ├── webview_app.h/cpp
│   ├── ipc_handler.h/cpp
│   ├── database/
│   │   ├── sqlserver_driver.h/cpp
│   │   ├── connection_pool.h/cpp
│   │   ├── result_cache.h/cpp
│   │   ├── async_query_executor.h/cpp
│   │   ├── schema_inspector.h/cpp
│   │   ├── query_history.h/cpp
│   │   └── transaction_manager.h/cpp
│   ├── parsers/
│   │   ├── a5er_parser.h/cpp
│   │   └── sql_formatter.h/cpp
│   ├── exporters/
│   │   ├── csv_exporter.h/cpp
│   │   ├── json_exporter.h/cpp
│   │   └── excel_exporter.h/cpp
│   └── utils/
│       ├── json_utils.h/cpp
│       ├── simd_filter.h/cpp
│       ├── file_utils.h/cpp
│       ├── settings_manager.h/cpp
│       ├── session_manager.h/cpp
│       └── global_search.h/cpp
├── tests/                             # C++ Tests
├── frontend/                          # React Frontend
│   ├── src/
│   │   ├── api/bridge.ts              # IPC bridge to C++ backend
│   │   ├── store/                     # Zustand stores
│   │   ├── components/
│   │   │   ├── layout/                # MainLayout, LeftPanel, CenterPanel, BottomPanel
│   │   │   ├── editor/                # SqlEditor, EditorTabs, EditorToolbar
│   │   │   ├── grid/                  # ResultGrid, CellEditor
│   │   │   ├── tree/                  # ObjectTree, TreeNode, ContextMenu
│   │   │   ├── history/               # QueryHistory, HistoryItem
│   │   │   └── diagram/               # ERDiagram, TableNode
│   │   ├── hooks/
│   │   └── types/
│   └── tests/
└── third_party/                       # webview.h, simdjson.h, pugixml.hpp, xlsxwriter.h
```

## Implementation Phases (All Complete)

- **Phase 0** ✓: CI/CD foundation (GitHub Actions, build scripts, test infrastructure)
- **Phase 1** ✓: Basic SQL execution (connection, queries, transactions, result display)
- **Phase 2** ✓: DataGrip-like UI (3-pane layout, Object Explorer, Monaco Editor, tabs)
- **Phase 3** ✓: Data editing (inline cell editing, row CRUD operations)
- **Phase 4** ✓: Advanced features (SQL formatter, export CSV/JSON/Excel, query history, execution plans)
- **Phase 5** ✓: A5:ER integration (import .a5er files, ER diagram with React Flow)
- **Phase 6** ✓: Performance optimization (SIMD filtering, result cache, async queries)
- **Phase 7** ✓: Additional features (global search, settings, session persistence)

## Development Guidelines

1. **TDD**: Write tests before implementation
2. **CI-first**: All commits must pass CI
3. **Phase order**: Implement Phase 1→7 sequentially
4. **UI/UX priority**: Faithfully reproduce DataGrip's UI/UX
5. **Error handling**: Check return values for all ODBC calls
6. **Memory management**: Follow RAII principles (use smart pointers)
7. **Performance**: Use Virtual Scrolling, SIMD, async processing

## Performance Targets

| Operation | Target |
|-----------|--------|
| App startup | < 0.3s |
| SQL Server connection | < 50ms |
| SELECT (1M rows) | < 500ms |
| Result display start | < 100ms |
| Virtual scroll | 60fps stable |
| SQL format | < 50ms |
| CSV export (100K rows) | < 2s |
| A5:ER load (100 tables) | < 1s |
| ER diagram render (50 tables) | < 500ms |
| Query history search (10K items) | < 100ms |

## Key Interfaces

### SchemaInspector (C++)
```cpp
class SchemaInspector {
public:
    std::vector<TableInfo> getTables(const std::string& database);
    std::vector<ColumnInfo> getColumns(const std::string& table);
    std::vector<IndexInfo> getIndexes(const std::string& table);
    std::vector<ForeignKeyInfo> getForeignKeys(const std::string& table);
    std::string generateDDL(const std::string& table);
};
```

### TransactionManager (C++)
```cpp
class TransactionManager {
public:
    void begin();
    void commit();
    void rollback();
    bool isInTransaction() const;
    TransactionState getState() const;
};
```

### Zustand Stores (TypeScript)
```typescript
interface ConnectionStore {
    connections: Connection[];
    activeConnectionId: string | null;
    addConnection: (conn: Connection) => void;
    removeConnection: (id: string) => void;
    setActive: (id: string) => void;
}

interface QueryStore {
    queries: Query[];
    activeQueryId: string | null;
    executeQuery: (id: string) => Promise<void>;
}

interface HistoryStore {
    history: HistoryItem[];
    addHistory: (item: HistoryItem) => void;
    searchHistory: (keyword: string) => HistoryItem[];
}
```

### ER Diagram Types (TypeScript)
```typescript
interface TableNode {
    id: string;
    type: 'table';
    data: { tableName: string; columns: Column[]; };
    position: { x: number; y: number };
}

interface RelationEdge {
    id: string;
    source: string;
    target: string;
    type: 'relation';
    data: { cardinality: '1:1' | '1:N' | 'N:M'; sourceColumn: string; targetColumn: string; };
}
```
## 重要な指示 (Instructions for Claude)

### Python実行について
- **Pythonスクリプトは必ず `uv run` 経由で実行すること**
- 例: `uv run scripts/build.py Debug`（`python scripts/build.py Debug` は使わない）
- uvがPython環境とインラインスクリプト依存を自動管理する

### 禁止事項
- **git commit, git push は絶対禁止**。コミットメッセージを考えるだけにすること。

### 作業完了時の必須チェック（コミット前に必ず実行）
作業が終わったら、以下のLinter/Formatterでエラーが出ないか**必ずチェック**すること：

```bash
# フロントエンド (Biome)
cd frontend && bun run lint

# C++ (clang-format) - 全ファイルをチェック
uv run scripts/cpp_check.py format

# または一括チェック（フロントエンド + C++）
uv run scripts/run_lint.py
```

**重要**: CIは Ubuntu 上で clang-format を実行するため、改行コード(CRLF/LF)の違いでエラーが出ることがある。ローカルで `clang-format -i` を実行してもCIで失敗する場合は、`.clang-format` の設定を確認すること。

### コーディング規約

#### フロントエンド (TypeScript/React)
- **Biomeの警告は必ず修正する**（--error-on-warnings で警告もエラー扱い）
- 非nullアサーション (`!`) は使用禁止 → 明示的なnullチェックを使用
- CSS Modulesを使用（グローバルCSSは避ける）
- Zustandでの状態管理

#### バックエンド (C++)
- **C++23**の機能を積極的に使用（std::expected, std::format, std::ranges等）
- **clang-format 21**でフォーマット（Google style base）
  - CI環境: LLVM 21 (apt.llvm.org)
  - ローカル: `winget install LLVM.LLVM`
  - **警告もエラーとして扱う** (`--Werror` フラグ使用)
  - CIでフォーマットチェックが通らない場合は `clang-format -i` で自動修正
- RAII原則に従う（スマートポインタ使用）
- ODBCの戻り値は必ずチェック
- **ヘッダーファイルのルール**:
  - C-Like（C互換）ヘッダー（`<intrin.h>`, `<malloc.h>`等）は標準C++ヘッダーで代替できる場合は使用しない
  - 例: `<intrin.h>` → `<immintrin.h>` (SIMD), `<malloc.h>` → `<cstdlib>`
  - Windows SDKヘッダー（`<Windows.h>`, `<sql.h>`等）は必要に応じて使用可

### 改行コード
- **CRLF (Windows)** で統一
- コミット前にHuskyが自動でconvert_eol.pyを実行
- 手動変換: `uv run scripts/convert_eol.py crlf`

### ビルドシステム
- **Ninja**を使用（Visual Studio generatorは使用しない）
- Developer Command Promptから実行（MSVCコンパイラが必要）
- 変数の型は基本的には`auto`を使用し、必要な時だけ特別に型を指定すること。

### Issue対応ワークフロー

#### 自動セキュリティスキャン
- **毎日 JST 00:00 (UTC 15:00)** に自動実行
- Semgrepがセキュリティ問題を検出すると自動でissueを作成
- ラベル: `semgrep`, `priority:high` or `priority:medium`

#### Issue対応の手順
1. **issueの取得と優先度確認**
   ```bash
   gh issue list --state open --json number,title,labels
   ```

2. **優先度順に対応**
   - `priority:critical` → 即座に対応
   - `priority:high` → 次に対応
   - `priority:medium` → 時間があれば対応
   - `priority:low` → 将来の改善

3. **修正完了後**
   - 修正内容をコミットメッセージにまとめる
   - issueをクローズ: `gh issue close <number> --comment "Fixed in commit <hash>"`

4. **Semgrep警告の抑制**
   - 意図的な`shell=True`使用など、安全が確認できる場合:
     ```python
     # nosemgrep: python.lang.security.audit.subprocess-shell-true
     result = subprocess.run(cmd, shell=True)  # Safe: hardcoded paths only
     ```
   - セキュリティコメントで理由を明記すること
