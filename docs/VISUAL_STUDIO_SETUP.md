# Visual Studio 2022 での開発・デバッグ手順

## 前提条件

1. Visual Studio 2022 がインストールされていること
2. 「C++ によるデスクトップ開発」ワークロードがインストールされていること
3. Bun がインストールされていること（フロントエンドビルド用）
   - インストール: `powershell -c "irm bun.sh/install.ps1 | iex"`
4. uv がインストールされていること（ビルドスクリプト実行用）
   - インストール: `winget install astral-sh.uv`

## セットアップ手順

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

以下のいずれかの方法でプロジェクトを開きます：

#### 方法A: CMakeプロジェクトとして開く（推奨）

1. Visual Studio 2022 を起動
2. 「フォルダーを開く」を選択
3. `D:\prog\Velocity-DB` フォルダを選択
4. Visual Studio が CMakeLists.txt を自動検出してプロジェクトを構成

#### 方法B: 生成済みソリューションを開く

1. `D:\prog\Velocity-DB\build\VelocityDB.sln` をダブルクリック
2. ソリューションエクスプローラーで「VelocityDB」プロジェクトを右クリック
3. 「スタートアッププロジェクトに設定」を選択

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

```text
VelocityDB.sln
├── ALL_BUILD         - 全プロジェクトビルド
├── VelocityDB        - メインアプリケーション (スタートアップ)
├── VelocityDBCore    - コアライブラリ
├── VelocityDBTests   - テストプロジェクト
├── simdjson          - JSON処理ライブラリ
├── pugixml           - XML処理ライブラリ
└── ZERO_CHECK        - CMake再生成チェック
```

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
2. 「ソリューションのクリーン」を実行してからリビルド
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
