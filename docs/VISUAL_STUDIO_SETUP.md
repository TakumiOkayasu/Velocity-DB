# Visual Studio 2026 での開発・デバッグ手順

## 前提条件

1. Visual Studio 2026 (18.x) の最新Stable版がインストールされていること
2. 「C++ によるデスクトップ開発」ワークロードがインストールされていること
3. `frontend/package.json`の`devEngines.packageManager.version`に指定されたBunが利用できること (フロントエンドビルド用)
4. uvとPython 3.14以降が利用できること (ビルドスクリプト実行用)
   - インストール: `winget install astral-sh.uv`

## 開発ツールのバージョン管理

VS以外も更新対象とする。バージョンを複数の設定に重複定義せず、次の正本を更新する。
「必要な下限」「固定版」「環境依存」を区別し、全ツールがローカル/CIで完全一致しているとは扱わない。

| ツール | 指定元・現状 | 更新とローカル/CIの関係 |
| --- | --- | --- |
| Visual Studio / MSVC / Windows SDK | VS 2026 Stable (18.x)、選択したインストールのtoolset/SDK | Installerで更新。CIはrunner配布版。実行ログで版を確認 |
| CMake | Presets形式6の読み込みには3.25以上。CMake本体の版は未固定 | ローカルは導入済み版、CIはrunner同梱版。報告ログの4.4.3は使用実績であり固定値ではない |
| Ninja | 版は未固定 | ローカルは導入済み版、CIはChocolateyで導入。報告ログの1.13.2は固定値ではない |
| Python | `pyproject.toml`の`requires-python = ">=3.14"`、Ruffは`py314` | uvで要件を満たすPythonを選択。明示的なCI指定は3.14。パッチ版は未固定 |
| uv / Ruff | 本体の版は未固定 | CIはsetup-uv / uvxで導入。Actionのコミット固定はツール本体の版固定とは別 |
| Bun | `frontend/package.json`の`devEngines.packageManager.version` (現在1.4.2) | CIはsetup-vp経由で指定版を使用。ローカルで直接`bun`を起動する場合も指定版に揃える |
| Vite+ / Oxlint / Oxfmt / Vitest / TypeScript等 | `frontend/package.json`と`frontend/bun.lock` | 依存更新時に両方を更新し、frontend lint・型検査・テスト・buildを確認 |
| LLVM / clang-format | `mise.toml` (現在23.1.1) と`mise.lock` | Windows/Linuxの公式配布物をlockし、両OSの整形結果一致をCIで検証 |
| mise | `mise.toml`の`min_version` (2026.9.1以上)、CIのmise-action入力は2026.9.1 | ローカルでより新しい版を利用可能。LLVMの固定版とは別に管理 |
| vcpkg | `vcpkg.json`の`builtin-baseline` | 同じSHAでproject-local vcpkgをcheckoutしてbootstrap |

[公式CMake仕様](https://cmake.org/cmake/help/latest/manual/cmake-presets.7.html#versions)に従い、
`CMakePresets.json`の`cmakeMinimumRequired`も3.25に揃える。これはPresetsの読み込み下限で、
VS 2026との組み合わせを含めた全依存の最低動作版を保証するものではない。

既存の週次`Tool Version Upgrade`はBun・vcpkg・LLVMを対象とする。
CMake・Ninja・uv・mise・Python本体を一括で最新化する仕組みではない。
それらの完全固定や更新自動化は未対応であり、導入する場合は既存の管理元を利用して
ローカルとCIの指定を一緒に変更し、アプリ全体のbackend build/testまで検証する。

## ツールチェーンの選択と更新

統合CLIはVisual Studio Installer同梱の`vswhere.exe`で、C++ x64ツールを備えた
最新のVS 2026 Stableを選択する。VS 2022・Preview/Insiders・次のメジャー版は対象外。
Community / Professional / Enterprise / Build Toolsと、カスタムインストール先に対応する。
IDEを使わずビルドする場合はBuild Toolsでもよい。

Visual Studio InstallerでStable版の更新を適用する。個人環境のVSをスクリプトが自動更新することはない。
検出できない場合はInstallerで「C++ によるデスクトップ開発」とMSVC x64/x86ツールを確認する。
固定パスや旧VSへフォールバックせず、必要なインストールがなければビルドを停止する。

CIは`windows-latest`を使用する。[GitHub公式のイメージ一覧](https://github.com/actions/runner-images#available-images)では、
2026-09-14時点でVS 2026を含むWindows Server 2025イメージを指す。
`windows-2025-vs2026`への変更は必須ではないため、既存の`windows-latest`を維持する。
VSの選択はローカルと共通のPython検出処理で行い、対応する18.x Stableがなければ停止する。
`latest`の移行で将来この要件を満たさなくなった場合は、対応VSの方針と合わせて更新する。
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
