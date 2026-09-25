# Velocity-DB

Windows向けRDBMS管理ツール。SQL Server / PostgreSQL / MySQL に ODBC 経由で接続し、3ペインUIでクエリ実行・結果編集・スキーマ閲覧を行う。

## 特徴

- **3ペインUI** — オブジェクトツリー / SQLエディタ / 結果グリッド
- **マルチDB対応** — SQL Server / PostgreSQL / MySQL（ODBC）
- **インライン編集** — セル編集から UPDATE/INSERT/DELETE を自動生成
- **Monaco Editor** — VS Code 同等の編集体験と補完
- **ER図** — テーブル関連を可視化、A5:ER ファイルのインポートに対応

## 動作環境

- Windows 11 **HOME** (x64)
- WebView2 Runtime（Windows 10 1803 以降は標準搭載）
- 接続先 DB の ODBC ドライバ（SQL Server 18 / psqlODBC / MySQL Connector/ODBC 8.4）

## インストール

[Releases](../../releases) から `Velocity-DB-windows-x64.zip` をダウンロードし任意のフォルダに展開する。

ODBC ドライバは公式サイトから入手する。

- [ODBC Driver for SQL Server](https://learn.microsoft.com/ja-jp/sql/connect/odbc/download-odbc-driver-for-sql-server)
- [psqlODBC](https://www.postgresql.org/ftp/odbc/)
- [MySQL Connector/ODBC](https://dev.mysql.com/downloads/connector/odbc/)

## ビルド

必要ツール: Visual Studio 2026 Stable (18.x, C++。Build Tools可) / mise / uv (`pyproject.toml`の指定版)。
Node・Bun・LLVMは`mise.toml`と`mise.lock`、Vite+は`frontend/package.json`と`frontend/bun.lock`で管理する。
グローバルVite+ CLIやDockerの導入は不要。

### 初回セットアップ

未取得の場合は先にcloneする。既存の作業コピーではcloneせず、そのルートで次の手順へ進む。

```powershell
git clone https://github.com/TakumiOkayasu/Velocity-DB.git
cd Velocity-DB
```

Python環境の準備、Node/Bun/LLVMの導入、ビルドの順に実行する。
各段階が失敗したらそこで止まり、後続のコマンドは実行しない。

```powershell
uv sync --locked
if ($LASTEXITCODE -ne 0) { throw 'Python環境の準備に失敗。トラブルシューティングを確認してください。' }
mise trust
if ($LASTEXITCODE -ne 0) { throw 'miseの設定を信頼できませんでした。' }
mise install --locked node bun github:llvm/llvm-project
if ($LASTEXITCODE -ne 0) { throw 'Node/Bun/LLVMの導入に失敗しました。' }
uv run --locked scripts/pdg.py build all
```

`uv sync --locked`は`.python-version`と`uv.lock`に従ってPython環境を準備する。
既存の`.venv`で`no Python executable was found`が出た場合は、
[Python環境の復旧](./docs/TROUBLESHOOTING.md#python環境の復旧)を先に行う。
`mise trust`の`No untrusted config files found`や、個人用ツールのlock警告は、
[警告と終了コードの見分け方](./docs/TROUBLESHOOTING.md#miseのllvmセットアップ)を参照する。
警告文だけで成功・失敗を判断せず、各コマンド直後の`$LASTEXITCODE`を確認する。

`mise`と`uv`自体はPATHに追加する。miseやPython仮想環境のactivationは不要。
初回準備後は通常の`uv run --locked scripts/pdg.py ...`を使用する。
ツール更新時だけmiseの導入を再実行する。指定元は[開発ツールのバージョン管理](./docs/VISUAL_STUDIO_SETUP.md#開発ツールのバージョン管理)を参照。

成果物は `build/Release/VelocityDB.exe`。
frontendとbackendは既定で直列にbuildする。実機で速くなることを確認済みの場合のみ
`uv run scripts/pdg.py build all --parallel`で同時実行できる。

## 開発コマンド

統合 CLI `pdg.py` で集約している。

```bash
uv run scripts/pdg.py dev           # 開発サーバー (localhost:5173)
uv run scripts/pdg.py test frontend # Vitest (Vite+)
uv run scripts/pdg.py test backend  # Google Test
uv run scripts/pdg.py lint          # Vite+ (Oxlint/Oxfmt) + clang-format
uv run scripts/pdg.py check Release # lint + test + build 一括
```

C++ lint用のLLVMは、初回およびバージョン更新後にリポジトリルートで準備する。
[mise](https://mise.jdx.dev/installing-mise.html)をインストールし、`mise`自体をPATHに追加してから実行する。

```powershell
mise trust
mise install --locked github:llvm/llvm-project
```

ツール名を指定することで、`mise.toml`で固定したLLVMだけをインストールする。
引数なしの`mise install --locked`は個人のグローバル設定のツールも対象にするため、
それらがlockされていないと失敗する。対象を限定しても個人用ツールの警告が残る場合は、
コマンド直後の`$LASTEXITCODE`を確認する。`--locked`を外す必要はない。
`mise trust`の`No untrusted config files found`は未信頼の設定がないという警告で、
インストール失敗ではない。詳細は[トラブルシューティング](./docs/TROUBLESHOOTING.md#miseのllvmセットアップ)を参照。

以降の操作は上記の`uv run scripts/pdg.py ...`のまま。PowerShellのmise activationやLLVMのPATH追加は不要。
ビルドスクリプトが`mise.toml`の完全固定バージョンを読み、mise管理の`clang-format`を絶対パスで実行する。
未導入・バージョン不一致では整形前に失敗する。lint中の自動インストールやwinget版へのフォールバックは行わない。

Windows x64とLinux x64は同じLLVM公式リリースを使用し、OS別のURL・チェックサムを`mise.lock`で固定する。
公式アーカイブにはLLVM一式が含まれるため、初回は大きなダウンロードと展開領域が必要。
他OS・CPUアーキテクチャはこの設定の検証対象外。

更新時は`mise.toml`のLLVMバージョンを変更し、`mise lock --platform linux-x64,windows-x64`で両OSのlockを更新する。
設定とlockは同じPRに含め、Windows/Linuxの実行・整形結果比較CIを通す。週次Tool Version Upgradeもこの正本を使用する。
FrontendのVite+とnpm依存関係は`frontend/package.json`と`frontend/bun.lock`、Node/Bunは`mise.toml`と`mise.lock`を正本とする。

## ローカルとCIの検証

通常のPR CIもローカルも`pdg.py`と`CMakePresets.json`を使用する。
Pythonは`.python-version`、uvは`pyproject.toml`、Ruff/pytest/CMake/Ninjaは`uv.lock`を正本とする。
`uv run --locked`が同じ開発依存関係を導入し、設定とlockが不一致なら停止する。
Node/Bunは`mise.toml`の完全固定版を`pdg.py`がmiseから解決し、子プロセスのPATHへ設定する。
package scripts内の`vp`は`frontend/node_modules`のVite+を使う。
Frontendは毎回frozen installで`bun.lock`に同期する。依存更新時だけ明示的にlockを更新する。

[初回セットアップ](#初回セットアップ)を完了してから実行する:

```powershell
uv run --locked scripts/pdg.py check Release
```

`check`はPython lint、build scriptテスト (両OSのLLVM lock検証を含む)、製品lint、
frontendテスト、ビルド、backendテストとCSV並列反復を実行する。
CIの各段階だけ再現する場合:

```powershell
uv run --locked scripts/pdg.py lint python
uv run --locked scripts/pdg.py test scripts
uv run --locked scripts/pdg.py lint frontend
uv run --locked scripts/pdg.py build frontend
uv run --locked scripts/pdg.py test frontend
uv run --locked scripts/pdg.py build backend
uv run --locked scripts/pdg.py test backend
```

`test scripts`はインストール済みLLVMの統合検証も実行する。
LLVMなしでPythonの単体テストだけ実行する場合は`uv run --locked pytest scripts/tests`を使う。
VS 2026 StableとWindows SDKのインストールは引き続き必要で、選択処理は共通の`vswhere`を使う。
OS・VS/SDKのパッチ版まで同一にするものではない。選択された版はビルドログに記録する。
リリース・benchmark専用workflowの実行範囲は通常のPR CIとは異なる。

## ドキュメント

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — レイヤー構造とコンポーネント
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) — トラブルシューティング
- [docs/VISUAL_STUDIO_SETUP.md](./docs/VISUAL_STUDIO_SETUP.md) — VS2026 デバッグ手順

## 謝辞

以下の OSS を利用している。

- [webview/webview](https://github.com/webview/webview)
- [simdjson](https://github.com/simdjson/simdjson)
- [pugixml](https://github.com/zeux/pugixml)
- [Monaco Editor](https://github.com/microsoft/monaco-editor)
- [TanStack Table](https://tanstack.com/table)
- [React Flow](https://reactflow.dev/)
- [Zustand](https://github.com/pmndrs/zustand)
- [Vite+](https://viteplus.dev/)
- [Oxc](https://oxc.rs/)
