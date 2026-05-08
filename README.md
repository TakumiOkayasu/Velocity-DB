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

## 開発コマンド

統合 CLI `pdg.py` で集約している。

```bash
uv run scripts/pdg.py dev           # 開発サーバー (localhost:5173)
uv run scripts/pdg.py test frontend # Vitest
uv run scripts/pdg.py test backend  # Google Test
uv run scripts/pdg.py lint          # Biome + clang-format
uv run scripts/pdg.py check Release # lint + test + build 一括
```

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
- [Biome](https://biomejs.dev/)
