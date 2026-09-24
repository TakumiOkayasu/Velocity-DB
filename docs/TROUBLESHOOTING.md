# トラブルシューティング

## ビルドエラー

### Vite+ (vp) not found

`pdg.py`のfrontend操作はグローバルVite+ CLIを使用する。Bunだけが導入済みでも、
`vp`がPythonプロセスのPATHから見つからないと停止する。
このメッセージだけでは、未インストールとPATH未反映を区別できない。
CIでは`setup-vp`がCLIを導入するため、ローカルだけで起こり得る。

未導入なら[公式インストーラー](https://viteplus.dev/guide/)をPowerShellで実行する:

```powershell
irm https://vite.plus/ps1 | iex
```

ターミナルを開き直して確認する。VS Code等の内蔵ターミナルでは、アプリ自体も再起動する。

```powershell
Get-Command vp -CommandType Application
vp --version
uv run --locked python -c "import shutil; print(shutil.which('vp'))"
```

最後の出力が`None`なら、Pythonから実行できる`vp`がPATHにない。
PowerShellの関数・エイリアスだけで呼べても、`pdg.py`からは使用できない。
既に導入済みなら、そのインストール先のbinディレクトリがPATHに含まれるか確認する。
カスタム導入先は[公式の環境設定](https://viteplus.dev/guide/env)を参照する。

確認できたら元の操作を再実行する:

```powershell
uv run --locked scripts/pdg.py lint --fix
uv run --locked scripts/pdg.py check Release
```

このプロジェクトはNode/Bunの管理にグローバルCLIを使うため、
`frontend/node_modules`内のCLIだけを起動する構成には切り替えない。
`pdg.py`は実行中にグローバルCLIを自動インストールしない。

### miseのLLVMセットアップ

`mise trust`で`No untrusted config files found`と表示される場合、未信頼の設定がないという意味で、
それ自体はインストール失敗ではない。まず`mise.toml`と`mise.lock`があるリポジトリルートに移動する。

`mise install --locked`で`uv@latest is not in the lockfile`などが出る場合は、
個人のグローバル設定（例: `~/.config/mise/config.toml`）のツールまでインストール対象になっている。
このリポジトリのlockfileが管理するLLVMだけを指定して再実行する。

```powershell
mise trust
mise install --locked github:llvm/llvm-project
```

バージョンを省略したツール指定は、リポジトリの`mise.toml`の固定バージョンを使用する。
`--locked`を維持することで、`mise.lock`のURL・チェックサムによる固定も継続する。
個人用ツールをこのリポジトリのlockfileに追加したり、グローバル設定を削除したりする必要はない。
mise 2026.9.2では、対象を限定してもグローバル設定のツールについて同じ警告が残る場合がある。
LLVMのインストール結果と終了コードを確認する（PowerShellでは直後に`$LASTEXITCODE`、成功は`0`）。
それでもLLVM自体のlockエラーが出る場合は、`mise.toml`と`mise.lock`を同じコミットの内容に揃える。

参考: [mise installのツール指定](https://mise.jdx.dev/cli/install.html)。

### Ninja Permission Error

```text
ninja: error: failed recompaction: Permission denied
```

- 自動回復機能あり（最大3回リトライ）
- VSCode/Visual Studio を閉じる
- VelocityDB.exe を終了

### Norton による CMake コンパイラ検出の誤検知

```text
CMake Error: Generator: execution of make failed.
```

Norton が `CMakeCCompilerId.exe` を `Win64:MalwareX-gen [Trj]` として誤検知・検疫し、CMake configure のコンパイラ検出が失敗する。

**対処法**: Norton の除外設定にビルドディレクトリを追加:

1. Norton Security → 設定 → ウイルス対策 → スキャン除外
2. `build/` ディレクトリのフルパスを追加
3. `vcpkg/` ディレクトリも追加 (project-local vcpkg.exe / port build 用)
4. CMake configure を再実行

### vcpkg detect_compiler 永続失敗 (CMake 4.x × VS 同梱 vcpkg-tool 非互換)

```text
ninja: error: build.ninja:35: loading 'CMakeFiles\rules.ninja': The system cannot find the file specified.
```

`uv run scripts/pdg.py build backend` を `--clean` 無しで連続実行すると vcpkg `detect_compiler` 段階で永続失敗する症状。CMake 4.2 と Visual Studio 同梱の古い vcpkg-tool portfile の世代非互換が原因 (`build.ninja` に `include CMakeFiles\rules.ninja` を埋めるが空プロジェクトのため `rules.ninja` は生成されない → `ninja -t recompact` 失敗)。

**自動解消**: 本リポジトリの `scripts/_lib/build.py` は project-local の最新 vcpkg を `<repo>/vcpkg/` に自動 clone し `VCPKG_ROOT` を上書きするため、`uv run scripts/pdg.py build backend` を実行するだけで自動移行される。旧 `build/vcpkg_installed/` は initial run で自動削除される (transition guard)。

**手動回復が必要なケース** (上記でも失敗する場合):

1. `Remove-Item -Recurse -Force .\build, .\vcpkg` で完全リセット
2. `uv run scripts/pdg.py build backend --clean` で再 build (vcpkg 再 clone + 全 port 再 build、+5-15 分)

### MSVC更新後のC1853 (古いPCHの再利用)

`fatal error C1853`で`cmake_pch.cxx.pch`が拒否される場合、以前のコンパイラで作成したPCHが残っている可能性がある。
Issue #711ではC++の`/TP`指定でC++用PCHを使用しており、frontend lint・テスト・buildは成功した後、backendの差分ビルドで停止していた。

`pdg.py build backend` / `build all`はMSVCの`cl.exe`、`c1xx.dll`、`c2.dll`のパスとSHA-256を
`build/msvc-fingerprint.json`に記録する。同じパスでのバイナリ更新も検知し、コンパイラが変わった場合は
PCH・object・生成済み依存ライブラリを含む`build/`全体を再生成する。
記録のない既存buildも初回だけ再生成するため、その回は依存関係の復元を含め通常より時間がかかる。
`frontend/dist/`、ソース、project-local `vcpkg/`は保持される。コンパイラが同一なら差分ビルドを継続する。

```powershell
uv run scripts/pdg.py build all
```

コンパイラの読み取りに失敗した場合はbuildを削除する前に停止する。
configure成功後に記録するため、コンパイル失敗後の再試行でも同じコンパイラの成果物は再利用できる。
この検知は統合CLI経由のビルドに適用される。CMakeを直接実行して作った成果物やPCH破損を手動で再生成する場合は
`uv run scripts/pdg.py build backend --clean`を使う。

冒頭の`mise install --locked`で出る個人用ツールのlockエラーは別問題であり、上記「miseのLLVMセットアップ」を参照する。
PCHを無効化したりコンパイラを旧版に戻したりする必要はない。

参考: [Microsoft C1853](https://learn.microsoft.com/en-us/cpp/error-messages/compiler-errors-1/fatal-error-c1853)、
[CMake --fresh](https://cmake.org/cmake/help/latest/manual/cmake.1.html#cmdoption-cmake-fresh)。
`--fresh`によるCMakeCache/CMakeFilesの再生成だけでは、下位ディレクトリの古いコンパイラ成果物の破棄を保証できない。

### MSVC Not Found

- Developer Command Prompt for VS 2026 から実行
- または `uv run scripts/pdg.py build backend` を使用

## フロントエンドのデバッグ

### ログファイル

- `log/frontend.log` - フロントエンドログ
- `log/backend.log` - バックエンドログ
- アプリ起動時に自動削除

### フロントエンドの変更が反映されない

```bash
uv run scripts/pdg.py build frontend --clean
```

WebView2キャッシュは自動削除される。

## Issue対応

### 自動セキュリティスキャン

毎日 JST 00:00 実行

### 対応手順

1. `gh issue list --state open` で確認
2. 優先度順に対応 (`priority:critical` > `high` > `medium` > `low`)
3. 修正後、コミットメッセージにまとめる
4. `gh issue close <number>` でクローズ

### Semgrep警告の抑制

```python
# nosemgrep: python.lang.security.audit.subprocess-shell-true
result = subprocess.run(cmd, shell=True)  # Safe: hardcoded paths only
```
