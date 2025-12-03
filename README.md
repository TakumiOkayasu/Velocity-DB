# Pre-DateGrip

Windows向け高性能RDBMSマネジメントツール。DataGripライクなUI/UXを目指し、SQL Serverをメインターゲットとしています。

## 特徴

- **DataGripライクなUI** - 3ペインレイアウト（オブジェクトエクスプローラー、エディタ、結果）
- **高速なクエリ実行** - 100万行のSELECTを500ms以内で処理
- **インライン編集** - AG Gridによるセル編集とUPDATE/INSERT/DELETE SQL自動生成
- **Monaco Editor** - VS Code同等のSQL編集体験
- **ER図表示** - React Flowによるテーブル関連の可視化
- **クエリ履歴** - localStorageによる永続化

## スクリーンショット

（準備中）

## 動作要件

- Windows 10/11 (x64)
- SQL Server 2016以降（ODBC接続）
- WebView2 Runtime（Windows 10 1803以降は標準搭載）

## インストール

### リリース版

[Releases](../../releases)から最新の`Pre-DateGrip-windows-x64.zip`をダウンロードし、任意のフォルダに展開してください。

### ソースからビルド

#### 必要なツール

- Visual Studio 2022（C++ワークロード）
- Node.js 20以上
- CMake 3.20以上

#### ビルド手順

```bash
# リポジトリをクローン
git clone https://github.com/your-username/Pre-DateGrip.git
cd Pre-DateGrip

# フロントエンドのビルド
cd frontend
npm install
npm run build
cd ..

# バックエンドのビルド
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Release

# パッケージ作成
scripts\package.bat
```

ビルド成果物は `dist/` フォルダに出力されます。

## 開発

### ディレクトリ構成

```
Pre-DateGrip/
├── src/                    # C++バックエンド
│   ├── database/           # DB接続、スキーマ取得、トランザクション管理
│   ├── parsers/            # SQLフォーマッター、A5:ERパーサー
│   ├── exporters/          # CSV/JSON/Excelエクスポーター
│   └── utils/              # JSON処理、SIMDフィルタ、ファイルユーティリティ
├── frontend/               # Reactフロントエンド
│   └── src/
│       ├── api/            # IPCブリッジ（開発用モックデータ付き）
│       ├── components/     # UIコンポーネント
│       └── store/          # Zustand状態管理
├── tests/                  # C++テスト（Google Test）
├── third_party/            # 外部ライブラリ
└── scripts/                # ビルド・チェックスクリプト
```

### 開発コマンド

```bash
# フロントエンド開発サーバー（ホットリロード）
cd frontend
npm run dev

# Lint/Format
npm run lint          # Biomeによるチェック
npm run lint:fix      # 自動修正
npm run format        # フォーマットのみ

# TypeScript型チェック
npm run typecheck

# テスト
npm run test

# C++ Lint/Format/Build（一括）
scripts\cpp-check.bat all Release

# 全体チェック（C++ + Frontend）
scripts\check-all.bat Release
```

### 技術スタック

#### バックエンド（C++23）

| カテゴリ | ライブラリ/技術 |
|---------|----------------|
| WebView | webview/webview (WebView2) |
| データベース | ODBC Native API |
| JSON | simdjson |
| XML | pugixml |
| 最適化 | SIMD (AVX2)、メモリマップドファイル |

#### フロントエンド（React + TypeScript）

| カテゴリ | ライブラリ |
|---------|-----------|
| ビルド | Vite |
| UI | React 18 |
| エディタ | Monaco Editor |
| テーブル | AG Grid（仮想スクロール） |
| スタイル | CSS Modules |
| 状態管理 | Zustand |
| ER図 | React Flow |
| Linter/Formatter | Biome |
| テスト | Vitest |

### パフォーマンス目標

| 操作 | 目標 |
|------|------|
| アプリ起動 | < 0.3秒 |
| SQL Server接続 | < 50ms |
| SELECT（100万行） | < 500ms |
| 結果表示開始 | < 100ms |
| 仮想スクロール | 60fps安定 |
| SQLフォーマット | < 50ms |
| CSVエクスポート（10万行） | < 2秒 |

## 実装状況

- [x] Phase 0: CI/CD基盤
- [x] Phase 1: 基本SQL実行
- [x] Phase 2: DataGripライクUI
- [x] Phase 3: データ編集
- [ ] Phase 4: 高度な機能（SQLフォーマッター、エクスポート、実行計画）
- [ ] Phase 5: A5:ER連携
- [ ] Phase 6: パフォーマンス最適化
- [ ] Phase 7: 追加機能（検索、設定、セッション管理）

## ライセンス

（準備中）

## 謝辞

このプロジェクトは以下のオープンソースライブラリを使用しています：

- [webview/webview](https://github.com/webview/webview)
- [simdjson](https://github.com/simdjson/simdjson)
- [pugixml](https://github.com/zeux/pugixml)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)
- [AG Grid](https://www.ag-grid.com/)
- [React Flow](https://reactflow.dev/)
- [Zustand](https://github.com/pmndrs/zustand)
- [Biome](https://biomejs.dev/)
