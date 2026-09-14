# Visual Studio 2026 での開発・デバッグ手順

## 前提条件

1. Visual Studio 2026 (18.x) の最新Stable版がインストールされていること
2. 「C++ によるデスクトップ開発」ワークロードがインストールされていること
3. Bun がインストールされていること（フロントエンドビルド用）
   - インストール: `powershell -c "irm bun.sh/install.ps1 | iex"`
4. uv がインストールされていること（ビルドスクリプト実行用）
   - インストール: `winget install astral-sh.uv`

## ツールチェーンの選択と更新

統合CLIはVisual Studio Installer同梱の`vswhere.exe`で、C++ x64ツールを備えた
最新のVS 2026 Stableを選択する。VS 2022・Preview/Insiders・次のメジャー版は対象外。
Community / Professional / Enterprise / Build Toolsと、カスタムインストール先に対応する。
IDEを使わずビルドする場合はBuild Toolsでもよい。

Visual Studio InstallerでStable版の更新を適用する。個人環境のVSをスクリプトが自動更新することはない。
検出できない場合はInstallerで「C++ によるデスクトップ開発」とMSVC x64/x86ツールを確認する。
固定パスや旧VSへフォールバックせず、必要なインストールがなければビルドを停止する。

CIも同じPython検出処理を使用し、`windows-2025-vs2026`を指定する。
VSのインストール版・MSVC toolset・Windows SDKをログに出力する。
CMakeキャッシュはrunner image版とMSVC toolset版で分離し、異なる環境の生成物を復元しない。
CIイメージの配布タイミングによるパッチ版の差はあり得るため、実行ログで使用版を確認する。

公式資料: [VS 2026更新履歴](https://learn.microsoft.com/en-us/visualstudio/releases/2026/release-history)、
[vswhereによるC++検出](https://github.com/microsoft/vswhere/wiki/Find-VC)、
[VS 2026 runner image](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-VS2026-Readme.md)。

## セットアップ手順

> **注**: 初回 `uv run scripts/pdg.py build backend` 実行時、project-local vcpkg が `<repo>/vcpkg/` に自動 clone されます (約 50MB、`.gitignore` 済)。CMake 4.x と VS 同梱 vcpkg-tool の世代非互換を回避するため必須です。

### 1. フロントエンドのビルド

アプリ実行時にフロントエンドが必要です。初回は以下を実行してください：

```powershell
# ビルドスクリプトを使用（推奨）
uv run scripts/pdg.py build frontend

# または手動でBunを使用
cd frontend
bun install
bun run build
```

### 2. ソリューションを開く

本リポジトリはNinja/CMake Presetsを使用するため、`.sln`は生成しない。

1. Visual Studio 2026を起動
2. 「フォルダーを開く」を選択
3. このリポジトリのルートフォルダを選択
4. CMake Presetsの`debug`または`release`を選択

### 3. デバッグ構成の選択

ツールバーで構成を選択：

- **Debug** : デバッグ用（ブレークポイント使用可能）
- **Release** : リリース用（最適化有効）

プラットフォームは **x64** を選択してください。

### 4. デバッグ実行

- **F5** : デバッグ開始
- **Ctrl+F5** : デバッグなしで開始
- **F9** : ブレークポイントの設定/解除
- **F10** : ステップオーバー
- **F11** : ステップイン

## プロジェクト構成

| CMakeターゲット | 用途 |
| --- | --- |
| `VelocityDB` | メインアプリケーション |
| `VelocityDBCore` | コアライブラリ |
| `VelocityDBTests` | テスト実行ファイル |


## トラブルシューティング

### WebView2 が見つからない場合

WebView2 Runtime がインストールされていることを確認してください：
<https://developer.microsoft.com/en-us/microsoft-edge/webview2/>

### フロントエンドが表示されない場合

1. `frontend/dist` フォルダが存在することを確認
2. 存在しない場合は `uv run scripts/pdg.py build frontend` を実行
3. プロジェクトをリビルド（CMakeがdistをコピーします）

### ビルドエラーが発生する場合

1. Visual Studio のビルドツールが最新か確認
2. CMakeのキャッシュを削除して再構成する
3. `build` フォルダを削除してCMakeを再実行：

   ```text
   uv run scripts/pdg.py build backend --type Debug --clean
   ```

## デバッグのヒント

### ブレークポイントの設定場所

- `backend/main.cpp` - アプリケーション起動
- `backend/webview_app.cpp` - WebView初期化
- `backend/ipc_handler.cpp` - フロントエンドとの通信
- `backend/database/sqlserver_driver.cpp` - DB接続・クエリ実行

### 出力ウィンドウ

「表示」→「出力」で出力ウィンドウを表示。
デバッグ中のログメッセージを確認できます。

### 変数の監視

デバッグ中に「デバッグ」→「ウィンドウ」→「ウォッチ」で
変数の値を監視できます。
