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

# Frontend (React)
cd frontend
npm install                   # Install dependencies
npm run dev                   # Development server (localhost:5173)
npm run build                 # Production build
npm run test                  # Run tests
npm run lint                  # Lint code (Biome)
npm run lint:fix              # Auto-fix lint issues

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

Phase 0 (CI/CD foundation) is complete. The project structure is implemented with:
- C++ backend skeleton with ODBC, WebView2, and IPC handlers
- React frontend with Monaco Editor, AG Grid, and Zustand state management
- Google Test for C++ and Vitest for frontend
- GitHub Actions CI/CD pipelines

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
- **Node.js**: 24.x (see `.nvmrc`)
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
│       └── file_utils.h/cpp
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

## Implementation Phases

- **Phase 0**: CI/CD foundation (GitHub Actions, build scripts, test infrastructure)
- **Phase 1**: Basic SQL execution (connection, queries, transactions, result display)
- **Phase 2**: DataGrip-like UI (3-pane layout, Object Explorer, Monaco Editor, tabs)
- **Phase 3**: Data editing (inline cell editing, row CRUD operations)
- **Phase 4**: Advanced features (SQL formatter, export CSV/JSON/Excel, query history, execution plans)
- **Phase 5**: A5:ER integration (import .a5er files, ER diagram with React Flow)
- **Phase 6**: Performance optimization (SIMD filtering, memory-mapped cache, async queries)
- **Phase 7**: Additional features (search, settings, session management, security)

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

### 作業完了時の必須チェック
作業が終わったら、以下のLinter/Formatterでエラーが出ないか**必ずチェック**すること：

```bash
# フロントエンド (Biome)
cd frontend && npm run lint

# C++ (clang-format)
clang-format --style=file --dry-run --Werror src/**/*.cpp src/**/*.h

# または一括チェック
uv run scripts/run_lint.py
```

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
- RAII原則に従う（スマートポインタ使用）
- ODBCの戻り値は必ずチェック

### 改行コード
- **CRLF (Windows)** で統一
- コミット前にHuskyが自動でconvert_eol.pyを実行
- 手動変換: `uv run scripts/convert_eol.py crlf`

### ビルドシステム
- **Ninja**を使用（Visual Studio generatorは使用しない）
- Developer Command Promptから実行（MSVCコンパイラが必要）