# Pre-DateGrip

Windows向け高性能RDBMSマネジメントツール。DataGripライクなUI/UXを目指し、SQL Serverをメインターゲットとしています。

## 特徴

- **DataGripライクなUI** - 3ペインレイアウト（オブジェクトエクスプローラー、エディタ、結果）
- **高速なクエリ実行** - 非同期実行、結果キャッシュ、AVX2 SIMDフィルタリング
- **インライン編集** - AG Gridによるセル編集とUPDATE/INSERT/DELETE SQL自動生成
- **Monaco Editor** - VS Code同等のSQL編集体験
- **ER図表示** - React Flowによるテーブル関連の可視化、A5:ERファイルインポート対応
- **エクスポート** - CSV/JSON/Excel形式でのデータ出力
- **セッション管理** - ウィンドウ状態、開いているタブ、接続プロファイルの永続化
- **グローバル検索** - テーブル、ビュー、プロシージャ、カラムの横断検索

## スクリーンショット

（準備中）

## 動作要件

- Windows 10/11 (x64)
- SQL Server 2016以降（ODBC接続）
- WebView2 Runtime（Windows 10 1803以降は標準搭載）
- Microsoft ODBC Driver for SQL Server（下記「ランタイム依存」参照）

## ランタイム依存

アプリケーションを実行するには、以下のランタイムが必要です。

### 必須

| コンポーネント | 用途 | インストール方法 |
|---------------|------|-----------------|
| **ODBC Driver 18 for SQL Server** | SQL Server接続 | `winget install Microsoft.ODBC.SQLServer.18` |
| **WebView2 Runtime** | UI表示 | Windows 10 1803以降は標準搭載。未インストールの場合: `winget install Microsoft.EdgeWebView2Runtime` |
| **Visual C++ 再頒布可能パッケージ** | C++ランタイム | `winget install Microsoft.VCRedist.2015+.x64` |

### インストールコマンド（まとめて実行）

```powershell
# PowerShellを管理者として実行
winget install Microsoft.ODBC.SQLServer.18
winget install Microsoft.EdgeWebView2Runtime
winget install Microsoft.VCRedist.2015+.x64
```

### 手動インストール

上記コマンドが使えない場合は、以下からダウンロードしてください：

- **ODBC Driver**: [Microsoft ODBC Driver for SQL Server](https://learn.microsoft.com/ja-jp/sql/connect/odbc/download-odbc-driver-for-sql-server)
- **WebView2 Runtime**: [Microsoft Edge WebView2](https://developer.microsoft.com/ja-jp/microsoft-edge/webview2/)
- **VC++ 再頒布可能**: [Visual C++ 再頒布可能パッケージ](https://learn.microsoft.com/ja-jp/cpp/windows/latest-supported-vc-redist)

### オプション（推奨）

| コンポーネント | 用途 | 備考 |
|---------------|------|------|
| **AVX2対応CPU** | SIMDフィルタリング高速化 | Intel: Haswell (2013)以降、AMD: Excavator (2015)以降。非対応CPUでも動作しますが、フィルタリング性能が低下します |

### 確認方法

インストール済みのODBCドライバを確認するには：

```powershell
Get-OdbcDriver | Where-Object { $_.Name -like '*SQL Server*' }
```

CPUがAVX2に対応しているか確認するには：

```powershell
# PowerShell
(Get-CimInstance Win32_Processor).Caption
# 上記で表示されたCPU名をWebで検索してAVX2対応を確認
```

## インストール

### リリース版

[Releases](../../releases)から最新の`Pre-DateGrip-windows-x64.zip`をダウンロードし、任意のフォルダに展開してください。

### ソースからビルド

#### 必要なツール

- Visual Studio 2022（C++ワークロード）
- Bun（`powershell -c "irm bun.sh/install.ps1 | iex"`）
- CMake 3.20以上
- Ninja（`winget install Ninja-build.Ninja`）
- Python 3.14+（ビルドスクリプト用）
- uv（`winget install astral-sh.uv`）

#### ビルド手順

```bash
# リポジトリをクローン
git clone https://github.com/your-username/Pre-DateGrip.git
cd Pre-DateGrip

# Developer Command Promptを開く（MSVCコンパイラが必要）
# または: "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"

# フロントエンドのビルド
cd frontend
bun install
bun run build
cd ..

# バックエンドのビルド（Ninja使用）
cmake -B build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel

# パッケージ作成
uv run scripts/package.py
```

ビルド成果物は `dist/` フォルダに出力されます。

## 開発

### ディレクトリ構成

```markdown
Pre-DateGrip/
├── src/                    # C++バックエンド
│   ├── database/           # DB接続、接続プール、結果キャッシュ、非同期実行
│   ├── parsers/            # SQLフォーマッター、A5:ERパーサー
│   ├── exporters/          # CSV/JSON/Excelエクスポーター
│   └── utils/              # SIMDフィルタ、設定管理、セッション管理、検索
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
bun run dev

# Lint/Format
bun run lint          # Biomeによるチェック
bun run lint:fix      # 自動修正
bun run format        # フォーマットのみ

# TypeScript型チェック
bun run typecheck

# テスト
bun run test

# キャッシュ削除
bun pm cache rm

# C++ Lint/Format/Build（一括）
uv run scripts/cpp_check.py all Release

# 全体チェック（C++ + Frontend）
uv run scripts/check_all.py Release
```

### 開発TODO

- [ ] ボタン配置の汚さ
- [ ] ウィンドウサイズの保持
- [ ] テーブル作成時のSQL（読み取り専用）を作る
- [ ] Ctrl+Wでタブを消す
- [ ] F5で実行
- [ ] a5er読み込み
- [ ] 未実装部分を追加
- [ ] issue対応

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

### パフォーマンス目標と実装

| 操作 | 目標 | 実装技術 |
|------|------|----------|
| アプリ起動 | < 0.3秒 | WebView2軽量初期化 |
| SQL Server接続 | < 50ms | ODBC直接接続、接続プール |
| SELECT（100万行） | < 500ms | 非同期クエリ実行、ストリーミング |
| 結果表示開始 | < 100ms | AG Grid仮想スクロール |
| 仮想スクロール | 60fps安定 | AG Grid仮想化 |
| SQLフォーマット | < 50ms | 軽量カスタムパーサー |
| CSVエクスポート（10万行） | < 2秒 | ストリーム書き込み |
| A5:ERロード（100テーブル） | < 1秒 | pugixml高速XMLパース |
| ER図レンダリング（50テーブル） | < 500ms | React Flow最適化レンダリング |
| クエリ履歴検索（1万件） | < 100ms | インメモリ検索 |
| 結果フィルタリング | 高速 | AVX2 SIMDベクトル化 |
| 繰り返しクエリ | 高速 | LRU結果キャッシュ（100MB） |

## 実装状況

- [x] Phase 0: CI/CD基盤（GitHub Actions、ビルドスクリプト、テスト基盤）
- [x] Phase 1: 基本SQL実行（接続、クエリ、トランザクション）
- [x] Phase 2: DataGripライクUI（3ペインレイアウト、Monaco Editor、タブ）
- [x] Phase 3: データ編集（インラインセル編集、CRUD操作）
- [x] Phase 4: 高度な機能（SQLフォーマッター、CSV/JSON/Excelエクスポート、実行計画）
- [x] Phase 5: A5:ER連携（.a5erファイルインポート、React Flow ER図）
- [x] Phase 6: パフォーマンス最適化（結果キャッシュ、非同期クエリ、AVX2 SIMDフィルタ）
- [x] Phase 7: 追加機能（グローバル検索、設定管理、セッション永続化）

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
