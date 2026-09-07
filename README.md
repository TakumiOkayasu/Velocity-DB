# Velocity-DB

Windows向けRDBMS管理ツール。SQL Server / PostgreSQL / MySQL に ODBC 経由で接続し、3ペインUIでクエリ実行・結果編集・スキーマ閲覧を行う。

## 特徴

- **3ペインUI** — オブジェクトツリー / SQLエディタ / 結果グリッド
- **マルチDB対応** — SQL Server / PostgreSQL / MySQL（ODBC）
- **インライン編集** — セル編集から UPDATE/INSERT/DELETE を自動生成
- **Monaco Editor** — VS Code 同等の編集体験と補完
- **ER図** — テーブル関連を可視化、A5:ER ファイルのインポートに対応

## 動作環境

- Windows 10/11 (x64)
- WebView2 Runtime（Windows 10 1803 以降は標準搭載）
- 接続先 DB の ODBC ドライバ（SQL Server 18 / psqlODBC / MySQL Connector/ODBC 8.4）

## インストール

[Releases](../../releases) から `Velocity-DB-windows-x64.zip` をダウンロードし任意のフォルダに展開する。

ODBC ドライバは公式サイトから入手する。

- [ODBC Driver for SQL Server](https://learn.microsoft.com/ja-jp/sql/connect/odbc/download-odbc-driver-for-sql-server)
- [psqlODBC](https://www.postgresql.org/ftp/odbc/)
- [MySQL Connector/ODBC](https://dev.mysql.com/downloads/connector/odbc/)

## ビルド

必要ツール: Visual Studio 2022 (C++) / CMake 3.20+ / Ninja / Bun / uv。

```bash
git clone https://github.com/TakumiOkayasu/Velocity-DB.git
cd Velocity-DB
uv run scripts/pdg.py build all
```

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
mise install --locked
```

以降の操作は上記の`uv run scripts/pdg.py ...`のまま。PowerShellのmise activationやLLVMのPATH追加は不要。
ビルドスクリプトが`mise.toml`の完全固定バージョンを読み、mise管理の`clang-format`を絶対パスで実行する。
未導入・バージョン不一致では整形前に失敗する。lint中の自動インストールやwinget版へのフォールバックは行わない。

Windows x64とLinux x64は同じLLVM公式リリースを使用し、OS別のURL・チェックサムを`mise.lock`で固定する。
公式アーカイブにはLLVM一式が含まれるため、初回は大きなダウンロードと展開領域が必要。
他OS・CPUアーキテクチャはこの設定の検証対象外。

更新時は`mise.toml`のLLVMバージョンを変更し、`mise lock --platform linux-x64,windows-x64`で両OSのlockを更新する。
設定とlockは同じPRに含め、Windows/Linuxの実行・整形結果比較CIを通す。週次Tool Version Upgradeもこの正本を使用する。
Frontendのツール・依存関係は引き続き`frontend/package.json`と`frontend/bun.lock`を正本とする。

## ドキュメント

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — レイヤー構造とコンポーネント
- [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) — トラブルシューティング
- [docs/VISUAL_STUDIO_SETUP.md](./docs/VISUAL_STUDIO_SETUP.md) — VS2022 デバッグ手順

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
