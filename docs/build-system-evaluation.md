# ビルドシステム評価レポート

## 背景

CMakeLists.txtの可読性・記述性への不満から、xmake/Mesonへの移行を検討した。
`poc/xmake/` と `poc/meson/` でPoCを実施し、全Done条件（debug build, 全依存リンク, GTest PASS, C++23）をクリア。

## 評価結果

### xmake PoC

| 項目 | 結果 |
|------|------|
| ビルド成功 | ✅ |
| 可読性 | ◎ (Lua, glob対応, 175行) |
| vcpkg連携 | ❌ 未実証。CMakeビルド成果物に依存 |
| パッケージ管理 | ❌ Norton誤検知でgtest取得失敗 |
| スタンドアロン動作 | ❌ CMakeの`build/`がないとビルド不可 |

### Meson PoC

| 項目 | 結果 |
|------|------|
| ビルド成功 | ✅ |
| 可読性 | ○ (Python風, 232行) |
| ソースツリー外パス | ❌ `include_directories()` が禁止。`/I`フラグ手動指定 |
| glob | ❌ 非対応。全ファイル個別列挙 |
| スタンドアロン動作 | ❌ CMakeの`build/`がないとビルド不可 |

### 判定

**両方とも「構文で書けること」の実証であり、「CMakeを置き換えられること」の実証ではない。**

本プロジェクトの制約（vcpkg必須, Norton環境, FetchContent依存）を満たすには追加検証が必要であり、
移行コストに見合う改善が見込めないため、CMake継続を決定。

## 代替策

CMake + Presets + モジュール化で可読性を改善する方針を採用。
詳細は `docs/cmake-refactoring.md` を参照。
