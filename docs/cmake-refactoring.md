# CMake リファクタリング記録

## 変更概要

CMakeLists.txtの可読性改善のため、以下のリファクタリングを実施。

## Before / After

### ルート CMakeLists.txt

| 指標 | Before | After |
|------|--------|-------|
| 行数 | 90 | 61 |
| グローバル `add_compile_options` | 4箇所 | 0 |
| グローバル `add_definitions` | 1箇所 | 0 |
| グローバル `add_link_options` | 1箇所 | 0 |

### backend/CMakeLists.txt

| 指標 | Before | After |
|------|--------|-------|
| 行数 | 278 | 278 |
| 出力先設定 | 14行 (手動4config x 2target) | 2行 (`target_set_output_directories`) |
| UNICODE定義 | ルートのグローバル | ターゲットスコープ (`target_compile_definitions`) |
| SIMD設定 | ルートのグローバル | ターゲットスコープ (`target_compile_options`) |

### tests/CMakeLists.txt

| 指標 | Before | After |
|------|--------|-------|
| 行数 | 67 | 61 |
| 出力先設定 | 7行 (手動4config) | 1行 (`target_set_output_directories`) |

### pdg.py

| 指標 | Before | After |
|------|--------|-------|
| CMake configure | `-G Ninja -DCMAKE_BUILD_TYPE=...` (Ninja有無分岐) | `--preset debug/release` |
| CTest | `--test-dir build --build-config ...` | `--preset debug/release` |
| Ninja検出ロジック | あり | 不要 (Presetsで固定) |

### 合計

| 指標 | Before | After | 差分 |
|------|--------|-------|------|
| 全CMakeLists.txt合計 | 500行 | 464行 | -36行 (-7%) |
| グローバルスコープ汚染 | 6箇所 | 0 | -6 |
| 出力先設定の重複 | 3箇所 (21行) | 3箇所 (3行) | -18行 |
| pdg.py (build.py+test.py) | 複雑な条件分岐 | Presets委任 | 簡潔化 |

## 新規ファイル

| ファイル | 責務 |
|----------|------|
| `cmake/CompilerWarnings.cmake` | MSVC `/MP` `/utf-8` をターゲット単位で適用 |
| `cmake/ReleaseOptimizations.cmake` | `/Gy` `/Gw` `/OPT:REF` `/OPT:ICF` をターゲット単位で適用 |
| `cmake/OutputDirectories.cmake` | 全config共通の出力先設定を1関数に集約 |

## 主要な改善点

1. **グローバルスコープ汚染の排除**: `add_definitions`/`add_compile_options`/`add_link_options` → `target_*` 系に統一
2. **重複の関数化**: 出力先設定が14+7行 → 1行ずつに
3. **Presets活用**: pdg.pyからジェネレータ分岐を除去、`cmake --preset` に統一
4. **モジュール化**: MSVC設定・Release最適化を再利用可能な関数に切り出し
