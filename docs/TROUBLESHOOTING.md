# トラブルシューティング

## ビルドエラー

### Python環境の復旧

`Project virtual environment directory ... cannot be used ... (no Python executable was found)`は、
uvが既存の`.venv`に有効なPython実行ファイルを見つけられず停止したことを示す。
`pdg.py`が起動する前のエラーなので、build/test/lintの引数を変えても復旧しない。
miseの個人用ツールに関する警告とは別問題。

ログだけでは、作成の中断・移動・別OSとの共有・実行ファイルの削除など、原因までは特定できない。
Windows/WSL間で`.venv`を共有・コピーせず、それぞれのOSで作成する。

リポジトリルートで、仮想環境を利用中のプロセスを終了し、activation中なら`deactivate`する。
既存環境を削除せず一意の名前へ退避してから、lockに従って再作成する:

```powershell
$venvBackup = '.venv.backup-' + [guid]::NewGuid().ToString('N')
Rename-Item -LiteralPath .\.venv -NewName $venvBackup -ErrorAction Stop
uv sync --locked
if ($LASTEXITCODE -ne 0) { throw 'Python環境の再作成に失敗しました。表示されたuvのエラーを確認してください。' }
uv run --locked python --version
```

退避先には元の内容が残る。新しい環境で作業できることを確認してから、不要なら退避先だけを削除する。
`.venv`が存在しない初回セットアップでは退避は不要で、`uv sync --locked`だけでよい。
`--locked`を外したり、`uv.lock`を削除したりする必要はない。
再作成が失敗した場合は、Pythonの取得失敗・権限・セキュリティソフトの検疫履歴を、実際のエラーに沿って確認する。

参考: [uvの環境同期](https://docs.astral.sh/uv/concepts/projects/sync/)、
[uvのPython管理](https://docs.astral.sh/uv/guides/install-python/)。

### フロントエンドのNode/Bunが見つからない

グローバル`vp`のインストールは不要。統合CLIは`mise.toml`に固定したNode/Bunを使い、
`bun install --frozen-lockfile`後にpackage scripts内のローカル`vp`を実行する。
古い`Vite+ (vp) not found`エラーが出る場合は、まず作業ブランチにこの移行が反映されているか確認する。

```powershell
mise trust
mise install --locked node bun
uv run --locked scripts/pdg.py lint frontend
```

`mise`自体がPythonから見つかるかは次で確認する:

```powershell
uv run --locked python -c "import shutil; print(shutil.which('mise'))"
```

`None`ならmiseをPATHへ追加し、ターミナル (内蔵ターミナルならIDE本体も) を開き直す。
Node/Bunの未導入・版不一致はfrontend操作前にエラーにする。
手動導入のNode/Bunやグローバル`vp`へのフォールバック、自動的なツール導入は行わない。
`bun.lock`不整合でfrozen installに失敗する場合は、意図した依存更新か確認してlockを更新する。

### 開発ツールの更新

Node/Bunは`mise.toml`を変更し、CIと同じmise版でWindows/Linuxのlockを更新する:

```powershell
mise lock node bun --platform linux-x64,windows-x64
mise install --locked node bun
uv run --locked scripts/pdg.py lint frontend
uv run --locked scripts/pdg.py test frontend
uv run --locked scripts/pdg.py build frontend
```

Vite+やReact等の依存関係は`frontend/package.json`と`frontend/bun.lock`を更新する。
これらのlockは管理対象が異なるため、両方をコミットする。mise本体の版を上げる場合は、
CIのmise-action指定も更新し、lock形式と両OSの互換性を確認する。

### miseのLLVMセットアップ

`mise trust`で`No untrusted config files found`と表示される場合、未信頼の設定がないという意味で、
それ自体はインストール失敗ではない。まず`mise.toml`と`mise.lock`があるリポジトリルートに移動する。

`mise install --locked`を引数なしで実行すると、個人のグローバル設定のツールも対象になる。
Node/Bun/LLVMだけを指定して実行する:

```powershell
mise trust
mise install --locked node bun github:llvm/llvm-project
$LASTEXITCODE
```

成功は`0`。必ずinstallの直後に確認する。対象を限定していても、
`C:\Users\...\.config\mise\config.toml`の`uv@latest is not in the lockfile`など、
個人用ツールについて警告が出る場合がある (#746)。そのWARNだけでは対象ツールの導入失敗とは判断できない。

| 表示 | 判断・次の操作 |
| --- | --- |
| `No untrusted config files found` | 新たに信頼する設定がないという意味。導入失敗ではない |
| 個人用ツールのlock警告 + install終了コード0 | 指定した導入処理は成功。`pdg.py`による固定版確認へ進む |
| install終了コードが0以外 | 後続を止め、対象ツールのERROR・ダウンロード・checksum等の詳細を確認 |
| `no Python executable was found` | miseとは別のPython環境の問題。上の復旧手順へ |

バージョンを省略したツール指定は、リポジトリの`mise.toml`の固定バージョンを使用する。
`--locked`は維持する。個人用ツールをリポジトリのlockへ追加したり、グローバル設定を削除したりしない。
リポジトリのNode/Bun/LLVM自体のlockエラーなら、`mise.toml`と`mise.lock`を同じコミットに揃える。
Python環境が正常になった後、`uv run --locked scripts/pdg.py lint`で
mise管理のNode/Bun/clang-formatのパス・版確認とlintを実行できる。

警告の発生条件まで切り分ける場合は、
`mise --version`とinstall直後の`$LASTEXITCODE`を記録する。個人設定全体や秘密情報の提示は不要。

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
