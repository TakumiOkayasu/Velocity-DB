# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pre-DateGrip is a Windows-only high-performance RDBMS management tool with DataGrip-like UI/UX, targeting SQL Server as the primary database.

## Build Commands

```bash
# Backend (C++ with CMake)
scripts\build.bat Debug       # Debug build
scripts\build.bat Release     # Release build
scripts\test.bat              # Run C++ tests

# Or manually with CMake
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release

# Frontend (React)
cd frontend
npm install                   # Install dependencies
npm run dev                   # Development server (localhost:5173)
npm run build                 # Production build
npm run test                  # Run tests
npm run lint                  # Lint code

# Package for distribution
scripts\package.bat
```

## Current Status

Phase 0 (CI/CD foundation) is complete. The project structure is implemented with:
- C++ backend skeleton with ODBC, WebView2, and IPC handlers
- React frontend with Monaco Editor, AG Grid, and Zustand state management
- Google Test for C++ and Vitest for frontend
- GitHub Actions CI/CD pipelines

## Technology Stack

### Backend (C++20)
- **WebView**: webview/webview (OS WebView2)
- **Database**: ODBC Native API (SQL Server)
- **JSON**: simdjson
- **SQL Parser**: sqlparser-rs (Rust) or custom implementation
- **Optimization**: SIMD (AVX2), Memory-Mapped Files
- **XML Parser**: pugixml (for A5:ER support)

### Frontend (React + TypeScript)
- **Build**: Vite
- **UI**: React 18
- **Editor**: Monaco Editor
- **Table**: AG Grid (Virtual Scrolling)
- **Styling**: CSS Modules + DataGrip dark theme
- **State**: Zustand
- **ER Diagram**: React Flow

### Testing
- **C++**: Google Test
- **Frontend**: Vitest

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
