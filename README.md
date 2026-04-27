# Velocity-DB

Windows向け高性能RDBMSマネジメントツール。DataGripライクなUI/UXを目指し、SQL Server / PostgreSQL / MySQLに対応しています。

## 特徴

- **DataGripライクなUI** - 3ペインレイアウト（オブジェクトエクスプローラー、エディタ、結果）
- **高速なクエリ実行** - 非同期実行、結果キャッシュ、AVX2 SIMDフィルタリング
- **インライン編集** - セル編集とUPDATE/INSERT/DELETE SQL自動生成
- **Monaco Editor** - VS Code同等のSQL編集体験、コード補完対応
- **マルチDB対応** - SQL Server / PostgreSQL / MySQL（ODBC経由）
- **SSH接続** - SSHトンネル経由でのリモートDB接続
- **ER図表示** - React Flowによるテーブル関連の可視化、論理名表示、A5:ERファイルインポート対応
- **接続色分け** - server/database単位で自動色分け（タブ、ツリー、接続セレクタ）
- **エクスポート** - CSV/JSON/Excel形式でのデータ出力
- **セッション管理** - ウィンドウ状態、開いているタブ、接続プロファイルの永続化
- **グローバル検索** - テーブル、ビュー、プロシージャ、カラムの横断検索

## 動作要件

- Windows 10/11 (x64)
- SQL Server 2019+ / PostgreSQL 15+ / MySQL 8.4+（ODBC接続）
- WebView2 Runtime（Windows 10 1803以降は標準搭載）
- 接続先DBに対応するODBCドライバ（下記「ランタイム依存」参照）

## ランタイム依存

アプリケーションを実行するには、以下のランタイムが必要です。

### 必須

| コンポーネント | 用途 | インストール方法 |
|---------------|------|-----------------|
| **WebView2 Runtime** | UI表示 | Windows 10 1803以降は標準搭載。未インストールの場合: `winget install Microsoft.EdgeWebView2Runtime` |
| **Visual C++ 再頒布可能パッケージ** | C++ランタイム | `winget install Microsoft.VCRedist.2015+.x64` |

### ODBCドライバ（接続先DBに応じて選択）

※ 接続先DBに対応するドライバのみインストールすればOK

| コンポーネント | 用途 | インストール方法 |
|---------------|------|-----------------|
| **ODBC Driver 18 for SQL Server** | SQL Server接続 | `winget install Microsoft.ODBC.SQLServer.18` |
| **PostgreSQL ODBC Driver (psqlODBC)** | PostgreSQL接続 | `winget install PostgreSQL.psqlODBC` |
| **MySQL Connector/ODBC 8.4** | MySQL接続 | [公式サイト](https://dev.mysql.com/downloads/connector/odbc/)からダウンロード |

### インストールコマンド（まとめて実行）

```powershell
# PowerShellを管理者として実行

# 必須
winget install Microsoft.EdgeWebView2Runtime
winget install Microsoft.VCRedist.2015+.x64

# 接続先DBに応じて必要なドライバをインストール
winget install Microsoft.ODBC.SQLServer.18   # SQL Server
winget install PostgreSQL.psqlODBC            # PostgreSQL
# MySQL: https://dev.mysql.com/downloads/connector/odbc/ から手動DL
```

### 手動インストール

上記コマンドが使えない場合は、以下からダウンロードしてください：

- **ODBC Driver (SQL Server)**: [Microsoft ODBC Driver for SQL Server](https://learn.microsoft.com/ja-jp/sql/connect/odbc/download-odbc-driver-for-sql-server)
- **PostgreSQL ODBC**: [psqlODBC](https://www.postgresql.org/ftp/odbc/releases/)
- **MySQL ODBC**: [MySQL Connector/ODBC](https://dev.mysql.com/downloads/connector/odbc/)
- **WebView2 Runtime**: [Microsoft Edge WebView2](https://developer.microsoft.com/ja-jp/microsoft-edge/webview2/)
- **VC++ 再頒布可能**: [Visual C++ 再頒布可能パッケージ](https://learn.microsoft.com/ja-jp/cpp/windows/latest-supported-vc-redist)

### オプション（推奨）

| コンポーネント | 用途 | 備考 |
|---------------|------|------|
| **AVX2対応CPU** | SIMDフィルタリング高速化 | Intel: Haswell (2013)以降、AMD: Excavator (2015)以降。非対応CPUでも動作しますが、フィルタリング性能が低下します |

### 確認方法

インストール済みのODBCドライバを確認するには：

```powershell
Get-OdbcDriver | Format-Table Name, Platform
```

CPUがAVX2に対応しているか確認するには：

```powershell
# PowerShell
(Get-CimInstance Win32_Processor).Caption
# 上記で表示されたCPU名をWebで検索してAVX2対応を確認
```

## 使い方

### キーボードショートカット

Velocity-DBは効率的な操作のための豊富なキーボードショートカットを提供しています：

#### SQL実行

- **F9** - SQL実行（1キー、推奨）
- **Ctrl+Enter** - SQL実行（2キー）

#### クエリ管理

- **Ctrl+N** - 新規クエリタブを作成

#### SQL編集

- **Ctrl+Shift+F** - SQLフォーマット（整形）

#### ナビゲーション

- **Ctrl+Shift+P** - グローバル検索を開く
- **Ctrl+,** - 設定を開く

#### その他

- **F5** - 無効化（ページリロード防止）

**注**: F5キーはブラウザのリロードと競合するため、SQL実行には使用できません。代わりにF9キーを使用してください。

### 複数DB同時接続

Velocity-DBは複数のデータベースを同時に操作できます：

```sql
-- USE文でデータベースを切り替え
USE SalesDB;
SELECT * FROM dbo.employees;

USE LogisticsDB;
SELECT * FROM dbo.products;
```

複数のSQL文を実行すると、各結果が個別のタブに表示されます（USE文の結果は除く）。

クロスデータベースJOINも可能です：

```sql
-- masterに接続した状態で
USE master;
SELECT e.*, p.*
FROM SalesDB.dbo.employees e
INNER JOIN LogisticsDB.dbo.products p ON e.id = p.employee_id;
```

---

## インストール

### リリース版

[Releases](../../releases)から最新の`Velocity-DB-windows-x64.zip`をダウンロードし、任意のフォルダに展開してください。

### ソースからビルド

#### 必要なツール

- Visual Studio 2022（C++ワークロード）
- Bun（`powershell -c "irm bun.sh/install.ps1 | iex"`）
- CMake 3.20以上
- Ninja（`winget install Ninja-build.Ninja`）
- Python（ビルドスクリプト用）
- uv（`winget install astral-sh.uv`）

#### ビルド手順

```bash
# リポジトリをクローン
git clone https://github.com/TakumiOkayasu/Velocity-DB.git
cd Velocity-DB

# フロントエンドのビルド
uv run scripts/pdg.py build frontend

# バックエンドのビルド（初回）
uv run scripts/pdg.py build backend --clean

# バックエンドのビルド（2回目以降：インクリメンタル）
uv run scripts/pdg.py build backend

# または一括ビルド
uv run scripts/pdg.py build all

# パッケージ作成
uv run scripts/pdg.py package
```

**ビルドパフォーマンス:**

- 初回ビルド: 1.5-2分
- インクリメンタルビルド（変更なし）: 5-10秒
- インクリメンタルビルド（1ファイル変更）: 20-30秒

ビルド成果物は `build/[Debug|Release]/VelocityDB.exe` に出力されます。

## 開発

### ディレクトリ構成

```markdown
Velocity-DB/
├── backend/                # C++バックエンド
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

すべての開発コマンドは統一CLI `pdg.py` で実行できます。

#### 統一CLI（推奨）

```bash
# ビルド
uv run scripts/pdg.py build backend              # Releaseビルド
uv run scripts/pdg.py build backend --type Debug # Debugビルド
uv run scripts/pdg.py build backend --clean      # クリーンビルド
uv run scripts/pdg.py build frontend             # フロントエンドビルド
uv run scripts/pdg.py build all                  # 一括ビルド

# 短縮形
uv run scripts/pdg.py b backend                  # 'build' の代わりに 'b'

# テスト
uv run scripts/pdg.py test backend               # バックエンドテスト
uv run scripts/pdg.py test frontend              # フロントエンドテスト
uv run scripts/pdg.py test frontend --watch      # Watchモード
uv run scripts/pdg.py test e2e                   # E2Eテスト (Playwright)

# 短縮形
uv run scripts/pdg.py t frontend                 # 'test' の代わりに 't'

# Lint (プロダクトコード: Frontend + C++)
uv run scripts/pdg.py lint                       # 全体Lint
uv run scripts/pdg.py lint --fix                 # 自動修正

# 短縮形
uv run scripts/pdg.py l --fix                    # 'lint' の代わりに 'l'

# Lint (ビルドスクリプト: Python) - 別途実行
ruff check scripts/                              # チェックのみ
ruff check --fix scripts/ && ruff format scripts/  # 自動修正

# 開発サーバー
uv run scripts/pdg.py dev                        # フロントエンド開発サーバー

# 短縮形
uv run scripts/pdg.py d                          # 'dev' の代わりに 'd'

# 全体チェック
uv run scripts/pdg.py check Release              # Lint + Test + Build

# 短縮形
uv run scripts/pdg.py c Release                  # 'check' の代わりに 'c'

# パッケージ作成
uv run scripts/pdg.py package                    # ビルド + パッケージング

# ヘルプ
uv run scripts/pdg.py --help                     # 全コマンド表示
uv run scripts/pdg.py build --help               # buildコマンドのヘルプ
```

#### 直接Bunを使う場合（オプション）

フロントエンド開発では、以下のコマンドも直接使用可能です：

```bash
cd frontend

# 開発
bun run dev          # 開発サーバー
bun run test         # テスト
bun run lint         # Lint
bun run lint:fix     # 自動修正
bun run typecheck    # 型チェック

# その他
bun run format       # フォーマット
```

### 技術スタック

#### ビルドスクリプト（Python）

| カテゴリ | ツール/技術 |
|---------|------------|
| パッケージマネージャ | uv |
| Lint/Format | Ruff |
| 設定 | pyproject.toml |

#### バックエンド（C++）

| カテゴリ | ライブラリ/技術 |
|---------|----------------|
| ビルド | CMake + Ninja (MSVC) |
| WebView | webview/webview (WebView2) |
| データベース | ODBC Native API |
| JSON | simdjson |
| XML | pugixml |
| 最適化 | SIMD (AVX2)、メモリマップドファイル |
| Lint/Format | clang-format, clang-tidy |

#### フロントエンド（React）

| カテゴリ | ライブラリ |
|---------|-----------|
| パッケージマネージャ | Bun |
| ビルド | Vite |
| UI | React |
| エディタ | Monaco Editor |
| テーブル | TanStack Table（仮想スクロール） |
| スタイル | CSS Modules |
| 状態管理 | Zustand |
| ER図 | React Flow |
| Linter/Formatter | Biome |
| テスト (Unit) | Vitest |
| テスト (E2E) | Playwright |

### パフォーマンス目標と実装

| 操作 | 目標 | 実装技術 |
|------|------|----------|
| アプリ起動 | < 0.3秒 | WebView2軽量初期化 |
| SQL Server接続 | < 50ms | ODBC直接接続、接続プール |
| SELECT（100万行） | < 500ms | 非同期クエリ実行、ストリーミング |
| 結果表示開始 | < 100ms | TanStack Table仮想スクロール |
| 仮想スクロール | 60fps安定 | TanStack Table仮想化 |
| SQLフォーマット | < 50ms | 軽量カスタムパーサー |
| CSVエクスポート（10万行） | < 2秒 | ストリーム書き込み |
| A5:ERロード（100テーブル） | < 1秒 | pugixml高速XMLパース |
| ER図レンダリング（50テーブル） | < 500ms | React Flow最適化レンダリング |
| クエリ履歴検索（1万件） | < 100ms | インメモリ検索 |
| 結果フィルタリング | 高速 | AVX2 SIMDベクトル化 |
| 繰り返しクエリ | 高速 | LRU結果キャッシュ（100MB） |

> 各項目の実装状況・計測手段・検証結果は [docs/PERFORMANCE_VALIDATION.md](./docs/PERFORMANCE_VALIDATION.md) を参照。

## 謝辞

このプロジェクトは以下のオープンソースライブラリを使用しています：

- [webview/webview](https://github.com/webview/webview)
- [simdjson](https://github.com/simdjson/simdjson)
- [pugixml](https://github.com/zeux/pugixml)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)
- [TanStack Table](https://tanstack.com/table)
- [React Flow](https://reactflow.dev/)
- [Zustand](https://github.com/pmndrs/zustand)
- [Biome](https://biomejs.dev/)
