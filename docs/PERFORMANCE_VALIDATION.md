# Performance Validation Report

`README.md` のパフォーマンス目標 (12 項目) について、実装状況の検証結果を記録する。

- **対象 README**: [README.md#パフォーマンス目標と実装](../README.md#パフォーマンス目標と実装)
- **関連 issue**: #416 (パフォーマンス目標と実装)
- **検証範囲**: 実装の有無・計測手段の有無・実測値
- **検証範囲外**: 全項目の実環境ベンチマーク (実DB / WebView2 実環境を要するもの)

## サマリ

| # | 目標 | 実装 | 計測機構 | 既存ベンチマーク | 達成判定 |
| --- | ------ | ------ | ---------- | ------------------ | ---------- |
| 1 | アプリ起動 < 0.3s | ✅ | ✅ | ✅ | ✅ 191.7ms (Playwright headless, 2026-06-03) |
| 2 | SQL Server 接続 < 50ms | ✅ | ✅ | ✅ | ✅ 12ms (Docker localhost, 2026-06-04) |
| 3 | SELECT (100万行) < 500ms | ✅ | ✅ | ❌ | 🔍 未実測 |
| 4 | 結果表示開始 < 100ms | ✅ | ✅ | ✅ | 🔍 161.3ms (最適化前ベースライン, 2026-06-03) |
| 5 | 仮想スクロール 60fps | ✅ | ❌ | ⚠️ 部分 | 🔍 未実測 |
| 6 | SQL フォーマット < 50ms | ✅ | ✅ | ✅ | ✅ 中 1ms / 大 40ms |
| 7 | CSV エクスポート (10万行) < 2s | ✅ | ✅ | ✅ | ✅ 196ms (ctest Release, 2026-06-03) |
| 8 | A5:ER ロード (100テーブル) < 1s | ✅ | ✅ | ✅ | ✅ テキスト 2254μs / XML 834μs |
| 9 | ER 図レンダリング (50テーブル) < 500ms | ✅ | ✅ | ✅ | ✅ 77.2ms (Playwright headless, 2026-06-03) |
| 10 | クエリ履歴検索 (1万件) < 100ms | ✅ | ✅ | ✅ | ✅ < 100ms (ctest Release, 2026-06-03) |
| 11 | 結果フィルタリング (AVX2 SIMD) | ✅ | ✅ | ✅ | ✅ equals 0ms / contains 1ms (ctest Release, 2026-06-03) |
| 12 | LRU 結果キャッシュ (100MB) | ✅ | N/A | ✅ | ✅ サイズ上限・LRU 動作確認済 |

**凡例**: ✅ 実装あり / ⚠️ 部分的 / ❌ なし / 🔍 未実測

**結論**: 全 12 項目に該当する実装機構は存在する。#1/#2/#6/#7/#8/#9/#10/#11/#12 は ctest または E2E で継続的な計測が整備済みで目標値を満たすことが確認されている。#3/#4/#5 は実 DB / WebView2 実環境を要するため未実測。

## 各項目の詳細

### #1. アプリ起動 < 0.3s

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/webview_app.cpp:57-153` |
| 実装手法 | WebView2 直接初期化 (`webview::webview`)、ブラウザキャッシュ無効化、仮想ホスト経由ナビゲート |
| 計測機構 | `useStartupMark()` hook (`frontend/src/utils/perfMarks.ts`) が React app 初回マウントの `startup:start` / `startup:end` mark を打ち、`startup` measure entry を記録する |
| 計測手段 | E2E spec (`frontend/e2e/perf-baseline.spec.ts`) が Playwright (Chromium headless) で自動計測 (ベースライン 191.7ms, 2026-06-03)。**注**: Playwright は Chromium を直接起動するため WebView2 実機値とは乖離する。WebView2 での backend 起動コスト (プロセス起動 → WebView2 host 完成) は対象外 |
| 達成判定 | **✅ 191.7ms (Playwright Chromium headless + Vite dev, 2026-06-03)**。production WebView2 実機値は別途計測が必要 |

### #2. SQL Server 接続 < 50ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/database/connection_registry.h`, `backend/database/sqlserver_driver.cpp`, `backend/database/async_connection_executor.h` |
| 実装手法 | ODBC Native API 直接利用、`shared_ptr` ベースの接続レジストリ、ThreadPool (MAX_THREADS=8) で非同期化 |
| 計測機構 | `tests/perf/integration/test_sqlserver_connect_bench.cpp` が `VELOCITYDB_PERF_MSSQL_CONNSTR` 経由で実 SQL Server への `connect()` を 5 回計測し mean/median/max を出力 |
| 計測手段 | `ctest --preset release -L perf -R SqlServerConnect` で実行。`VELOCITYDB_PERF_MSSQL_CONNSTR` が未設定の場合はスキップ。Docker 実行手順は `tests/perf/README.md` を参照 |
| 達成判定 | **✅ 達成**。mean=11998μs (≈12ms) < 50ms target。Docker SQL Server 2022 + localhost 接続 (11rep median=11675μs max=16517μs, 2026-06-04) |

### #3. SELECT (100万行) < 500ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/database/async_query_executor.h:31-101`, `backend/database/async_query_executor.cpp` |
| 実装手法 | ThreadPool で非同期実行、`AsyncQueryResult` に `startTime` / `endTime` (`std::chrono::steady_clock`) を保持 |
| 計測機構 | あり (`AsyncQueryResult.startTime/endTime`) |
| 計測手段 | 100 万行のテストデータを準備した実 DB に対して `executeAsync()` し、`endTime - startTime` を確認 |
| 達成判定 | **未実測**。クライアント-サーバー間ネットワーク・行サイズに大きく依存 |

### #4. 結果表示開始 < 100ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `frontend/src/components/grid/GridTable.tsx:47-82`, `frontend/src/components/grid/ResultGrid.tsx`, `frontend/src/store/query/slices/dataViewSlice.ts` |
| 実装手法 | TanStack React Virtual で行を仮想化。`broken-state` 検出時は `FALLBACK_RENDER_LIMIT=50` で先頭行のみ描画 (issue #417 参照) |
| 計測機構 | `useFirstRenderMark('result-grid')` hook (`frontend/src/utils/perfMarks.ts`) が ResultGrid 初回マウント時に `result-grid` measure を記録 |
| 計測手段 | `frontend/e2e/perf-baseline.spec.ts` (#501 describe) が接続 mock → F9 実行 → 1000行 × 10列フィクスチャで ResultGrid を mount → measure 取得 |
| 達成判定 | **🔍 161.3ms (Playwright headless, 1000行×10列 mock, 2026-06-03)**。目標 100ms を超過。ただし本計測は最適化前のベースライン値 (#501 実装後に再計測予定) |
| ベースライン値 (2026-06-03) | result-grid-1k: 161.3ms (1000行×10列, Playwright Chromium headless + Vite dev) |

### #5. 仮想スクロール 60fps 安定

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `frontend/src/components/grid/GridTable.tsx`, `frontend/src/components/grid/ResultGrid.tsx` |
| 実装手法 | TanStack Virtual + 行高固定 32px + `memo` 最適化 |
| 計測機構 | なし |
| 計測手段 | 実機 Chrome DevTools Performance プロファイル、または Playwright + Chrome DevTools Protocol |
| 達成判定 | **未実測**。fps は GPU/モニタ環境に強く依存 |

### #6. SQL フォーマット < 50ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/parsers/sql_formatter.h:11-40`, `backend/parsers/sql_formatter.cpp` |
| 実装手法 | `unordered_set` でキーワード判定 (O(1))、文字単位ストリーミングパース |
| 計測機構 | あり (`tests/perf/test_sql_formatter_bench.cpp`) |
| 既存ベンチマーク | `tests/perf/test_sql_formatter_bench.cpp` (小 JOIN-heavy / 中 500 行 / 大 10000 行、5 反復で mean/median/max を出力) で中サイズ mean < 50ms を `EXPECT_LT` |
| 計測手段 | `ctest --preset release -L perf` で実行 |
| 達成判定 | **✅ 達成**。中サイズ (500 行 / 40KB) で mean=1ms、大 (10000 行 / 826KB) で mean=40ms (target 50ms 圏内、2026-05-15 ローカル Release) |
| ベースライン値 (2026-05-15) | 小 JOIN-heavy (3648 chars): mean=0ms / median=0ms / max=0ms<br>中 500行 (40219 chars): mean=1ms / median=1ms / max=2ms<br>大 10000行 (826769 chars): mean=40ms / median=41ms / max=41ms |

### #7. CSV エクスポート (10万行) < 2s

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/exporters/csv_exporter.h`, `backend/exporters/csv_exporter.cpp:8-79` |
| 実装手法 | `std::ofstream` バイナリモードでストリーム書き込み、UTF-8 BOM、CSV エスケープ、`reserve()` 事前割り当て |
| 計測機構 | あり (`tests/perf/test_csv_exporter_bench.cpp` の `std::chrono::steady_clock` 計測) |
| 既存ベンチマーク | `tests/perf/test_csv_exporter_bench.cpp` (10 万行 × 10 列、NULL/エスケープ混在) で 2s 上限を `EXPECT_LT` |
| 計測手段 | `ctest --preset release -L perf` または `ctest --test-dir build -R CSVExporterBench -V` |
| 達成判定 | **✅ 196ms (ctest Release, 2026-06-03)**。目標 2000ms を大幅に下回る |
| ベースライン値 (2026-06-03) | 10万行 × 10列 (NULL/エスケープ混在): 196ms |

### #8. A5:ER ロード (100テーブル) < 1s

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/parsers/a5er_parser.h`, `backend/parsers/a5er_parser.cpp` |
| 実装手法 | `pugixml` 直接利用、テキスト/XML 両形式対応 |
| 計測機構 | `tests/perf/test_a5er_parser_bench.cpp` — `A5ERParser::parseFromString()` を 5 反復計測 (I/O 分離) |
| 計測手段 | `ctest --test-dir build -R A5ERParserBench -V`。フィクスチャ: `tests/fixtures/a5er/fixture_100tables.a5er(.xml)` (100 テーブル × 5 列 + 99 リレーション、`gen_a5er_fixture.py` で再生成可) |
| 達成判定 | **✅ テキスト形式 mean=2254μs / XML 形式 mean=834μs (2026-06-03, Release ビルド, Windows 11, kRepeatCount=20, ウォームアップ 2 回)**。目標 100ms (100000μs) を大幅に下回る |

### #9. ER 図レンダリング (50テーブル) < 500ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `frontend/src/components/diagram/ERDiagram.tsx:1-100` |
| 実装手法 | React Flow (`@xyflow/react`)、ノード/エッジの memo 化、`GRID_LAYOUT` 自動配置 |
| 計測機構 | `useERDiagramRenderMark(tableCount, threshold=50)` hook (`frontend/src/utils/perfMarks.ts`) が 50テーブル到達時に `er-diagram-50` measure を記録 |
| 計測手段 | `frontend/e2e/perf-baseline.spec.ts` (#597 describe) が Docker Playwright で「新規ER図」タブ → フィクスチャ (`frontend/e2e/fixtures/er-diagram-50tables.json`, 50テーブル) をインポート → measure 取得 |
| 達成判定 | **✅ 77.2ms (Playwright Chromium headless + Vite dev, 2026-06-03)**。目標 500ms を大幅に下回る |

### #10. クエリ履歴検索 (1万件) < 100ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/database/query_history.h:46-72`, `backend/database/query_history.cpp:34-60` |
| 実装手法 | `std::vector<HistoryItem>` で最大 10000 件保持。`std::search` + `std::tolower` による case-insensitive linear search (O(n*m)) |
| 計測機構 | `tests/perf/test_query_history_search_bench.cpp` — 1 万件投入後 `search()` を短/中/長/NoMatch の 4 パターンで計測し `< 100ms` を `EXPECT_LT` |
| 計測手段 | `ctest --test-dir build -R QueryHistorySearchBench -V` |
| 達成判定 | **✅ < 100ms (ctest Release, 2026-06-03)**。4 パターン全て PASS |
| 備考 | 線形検索のため、SQL 平均長や検索語長によっては目標 100ms を超える可能性がある。インデックス化検討の余地あり |

### #11. 結果フィルタリング (AVX2 SIMD)

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/utils/simd_filter.h:11-33`, `backend/utils/simd_filter.cpp` |
| 実装手法 | AVX2 intrinsics (`_mm256_*`) 直接利用、`__cpuidex()` で実行時 AVX2 検出、非対応 CPU では `std::memcmp()` フォールバック |
| 計測機構 | `tests/perf/test_simd_filter_bench.cpp` — `simdStringEquals` (100k 反復 × 64byte) / `simdStringContains` (64KB haystack) を AVX2 経路と scalar 経路で計測比較し `< 50ms` を `EXPECT_LT` |
| 計測手段 | `ctest --test-dir build -R SimdFilterBench -V` |
| 達成判定 | **✅ equals 0ms / contains 1ms (ctest Release, 2026-06-03)**。AVX2 available: yes。simdStringContains は `std::string_view::find` より 4 倍高速 (ratio=0.26) |
| ベースライン値 (2026-06-03) | simdStringEquals: 0ms (memcmp 比 ratio=0.92)<br>simdStringContains: 1ms (string_view::find: 4ms, ratio=0.26) |

### #12. LRU 結果キャッシュ (100MB)

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/database/result_cache.h:14-62`, `backend/database/result_cache.cpp` |
| 実装手法 | `unordered_map` + `std::list` による O(1) アクセス・LRU 順序更新。デフォルト上限 100MB (`100 * 1024 * 1024`) |
| 計測機構 | N/A (キャッシュは時間目標ではなくサイズ上限と LRU 動作が目標) |
| 既存ベンチマーク | `tests/database/test_result_cache.cpp` で `put`/`get`/`evict`/サイズ追跡を検証済 + `tests/perf/test_result_cache_bench.cpp` で hit / miss / eviction を伴う put のリグレッション検出 |
| 計測手段 | `ctest --preset release -L perf` (perf bench), `ctest --preset release` (機能テスト) |
| 達成判定 | **✅ 達成**。実装・機能テスト・perf bench 共に存在 |

## 計測手順

### ローカルで再現可能な項目 (要 PoC ベンチマーク追加)

`#3, #6, #10, #11` はバックエンド C++ の Google Test 内で `std::chrono` を使えば計測可能。`#7` はテストデータ生成のコストが高いが原理的には可能。

```bash
# バックエンドテスト実行
uv run scripts/pdg.py test backend
```

### 実 DB が必要な項目

`#2, #3` は実 SQL Server / PostgreSQL / MySQL への接続が必要。検証には以下のテストデータが必要:

- 100 万行 × 適度な列数 (例: 10 列) のテーブル
- ローカル / リモート両方の接続シナリオ

### 実環境 (WebView2) が必要な項目

`#1, #4, #5, #9` は WebView2 ランタイム上で動作する完成品アプリでの計測が必要。Playwright での E2E 計測 + Chrome DevTools Protocol が現実的。

## 今後のアクション

本検証では「実装の存在確認」までを完了した。継続的な目標達成保証のためには以下が必要:

1. **ベンチマークテスト群の追加** (別 issue / PR)
   - ✅ バックエンド基盤: `tests/perf/` 新設、`VelocityDBPerfTests` 実行ファイル、`perf` ctest ラベル (#425)
   - ✅ `scripts/pdg.py` に `bench` サブコマンド (`pdg bench backend` で `ctest -L perf`)
   - ✅ 個別目標 #6/#7/#8/#10/#11 の計測テスト整備済
   - 🔍 #3 SELECT 100万行: 実 DB 必要、別 issue (#589)
   - ✅ フロントエンド: Playwright E2E で #1/#9 を自動計測済 (#606/#607/#609)
2. **CI への組み込み**
   - ✅ 通常テスト workflow (`ci.yml` / `test.yml`) は `ctest -LE perf` で perf を除外
   - ✅ `bench.yml` を新設 (`workflow_dispatch` で手動実行)
   - 🔍 PR 毎のリグレッション検出 (値の記録・比較) は未対応
3. **README の目標表現の明確化**
   - 「高速」(#11) のように定量的でない記述を、具体値もしくは相対値 (例: 「非 SIMD 比 N 倍」) に置き換え
   - 計測条件 (CPU、メモリ、DB ロケーション) の前提を README に併記

## フロントエンド計測ベースライン (#494)

`#479` パフォーマンスリファクタの起点として、フロントエンド主要画面の初回マウント時間と本番 bundle 構成を計測する仕組みを整備した (`#494`)。後続の `#501` (ResultGrid 最適化) / `#505` (selector 最適化) / `#504` (store 分割) は本セクションのベースライン値を起点に効果を判定する。

### 計測対象と計測機構

| 対象 | ファイル | 計測 mark 名 | 自動取得 | 対応 README 目標 |
| ---- | -------- | ------------ | -------- | ---------------- |
| App ルート | `frontend/src/App.tsx` | `startup` | ✅ E2E spec | #1 起動 < 0.3s |
| ObjectTree | `frontend/src/components/tree/ObjectTree.tsx` | `object-tree` | ✅ E2E spec | — |
| SqlEditor (Monaco) | `frontend/src/components/editor/SqlEditor.tsx` | `sql-editor` | ✅ E2E spec | — |
| ResultGrid | `frontend/src/components/grid/ResultGrid.tsx` | `result-grid` | ⚠️ 手動 (クエリ実行後) | #4 結果表示開始 < 100ms |
| ERDiagram (50 テーブル以上) | `frontend/src/components/diagram/ERDiagram.tsx` | `er-diagram-50` | ✅ E2E spec (#597) | #9 ER 図 50 テーブル < 500ms |

各コンポーネントは `useFirstRenderMark` (`frontend/src/utils/perfMarks.ts`) で初回マウントの `${name}:start` / `${name}:end` mark を打ち、`${name}` の measure entry を Performance API に記録する。再レンダリングでは記録しない (初回マウントのみ)。

- `useStartupMark()` は `useFirstRenderMark('startup')` のラッパー (App ルート専用)。
- `useERDiagramRenderMark(tableCount, threshold=50)` は `tableCount` が `threshold` 以上に達した最初のレンダリング時のみ mark を打つ条件付き hook。閾値未達の ER 図 (例: 49 テーブル) では mark が記録されない仕様。

### 初回レンダリング時間の取得手順

1. dev server 起動:

   ```powershell
   uv run scripts/pdg.py dev
   ```

2. Chrome / Edge で `http://localhost:5173/` を開く
3. DevTools → Performance タブで Record 開始
4. 操作:
   - ResultGrid: 任意のクエリを実行して結果を表示
   - ObjectTree: 接続プロファイルを開いてスキーマを展開
   - SqlEditor: 新規タブを開いて Monaco を初期化
5. Record 停止 → Timings レーンの `result-grid` / `object-tree` / `sql-editor` measure entry の duration を読み取り

または DevTools → Console で以下を実行:

```js
performance.getEntriesByType('measure')
  .filter(e => ['startup', 'result-grid', 'object-tree', 'sql-editor', 'er-diagram-50'].includes(e.name))
  .map(e => ({ name: e.name, duration_ms: e.duration.toFixed(2) }));
```

### Docker 経由の Playwright 自動取得

`frontend/e2e/perf-baseline.spec.ts` は dev server (Vite) で `startup` / `object-tree` / `sql-editor` の 3 mark を取得し、`[#494 baseline] <JSON>` 形式で stdout に出力する。WebView2 / production preview とは値が一致しない (Vite の HMR + source map を含むため) が、リグレッション検出の基準値として使用できる。

`bun` は worker_threads 非互換のため Node.js ベースの公式 Playwright image を使用する。image タグは `bun.lock` の `@playwright/test` バージョンと一致させること。

Docker コマンドの詳細 (image タグ含む) は `CLAUDE.md`「E2Eテスト (Playwright)」を参照すること。image タグは `bun.lock` の `@playwright/test` バージョンと一致させる。

`result-grid` は BottomPanel (クエリ実行後に表示) に mount されるため本 spec では取得しない。実機で接続 + クエリ実行後に DevTools Console で取得: `performance.getEntriesByType('measure').filter(e => e.name === 'result-grid')`

`er-diagram-50` (#9) は `#597 ER diagram baseline` describe ブロックで取得。「+ボタン → 新規ER図」→ `frontend/e2e/fixtures/er-diagram-50tables.json` をインポート → measure 記録の流れ。

### bundle サイズレポートの取得手順

`rollup-plugin-visualizer` v7.0.1 (Vite 8 / rolldown 対応) を opt-in で組み込んでいる。`VELOCITYDB_BUNDLE_REPORT=1` を設定したビルド時のみ `frontend/dist/bundle-report.html` を生成する。

```powershell
$env:VELOCITYDB_BUNDLE_REPORT = '1'
uv run scripts/pdg.py build frontend
# → frontend/dist/bundle-report.html をブラウザで開く
Remove-Item Env:VELOCITYDB_BUNDLE_REPORT
```

`gzipSize` / `brotliSize` を有効にしているため、各 chunk の raw / gzip / brotli サイズを併記レポートする。

### ベースライン値テーブル

> **計測環境の注記**: 自動取得値は Docker (Node.js Playwright 公式 image) + Chromium headless + Vite dev server で取得。production WebView2 + 実機値とは異なる (リグレッション検出用途)。

#### 初回マウント時間

| 対象 | 計測条件 | duration (ms) | 計測日 | 環境 |
| ---- | -------- | ------------- | ------ | ---- |
| startup (App) | `page.goto('/')` 直後 | 191.7 | 2026-06-03 | Docker Linux + Chromium headless + Vite dev |
| ObjectTree | LeftPanel 常時表示 (接続なし) | 1.7 | 2026-06-03 | Docker Linux + Chromium headless + Vite dev |
| SqlEditor (Monaco) | 新規タブ初期化 (Ctrl+N) | 3.5 | 2026-06-03 | Docker Linux + Chromium headless + Vite dev |
| ResultGrid | 空配列 (mock invoke) | TBD | — | クエリ実行後に mount、実機 DevTools で取得 |
| ResultGrid | 1000 行 × 10 列 | TBD | — | フィクスチャ不在 (#501) |
| ResultGrid | 10000 行 × 10 列 | TBD | — | フィクスチャ不在 (#501) |
| ERDiagram (50 テーブル) | 「新規ER図」→ 50テーブルフィクスチャインポート | 77.2 | 2026-06-03 | Docker Linux + Chromium headless + Vite dev |

> `startup` / `ObjectTree` / `SqlEditor` は `frontend/e2e/perf-baseline.spec.ts` で自動取得可 (Docker + Node.js Playwright)。
> `ResultGrid 空配列` はクエリ実行後に mount されるため実機で手動取得: `performance.getEntriesByType('measure').filter(e => e.name === 'result-grid')`
> `ResultGrid 1000/10000 行` と `ERDiagram 50 テーブル` はフィクスチャ不在のため別タスク (#501 / #597)。

#### bundle 構成

計測環境: Docker (`oven/bun:latest`) で `bunx vite build` (production)。raw / gzip は Vite 標準出力、brotli は `brotli -q 11` で別計測。サイズは decimal kB (`bytes / 1000`)。

| chunk | raw (KB) | gzip (KB) | brotli (KB) | 計測日 |
| ----- | -------- | --------- | ----------- | ------ |
| `vendor-monaco` | 4203.27 | 1079.19 | 823.09 | 2026-05-14 |
| `vendor-table` | 63.10 | 16.74 | 14.96 | 2026-05-14 |
| `vendor-reactflow` | 173.49 | 55.98 | 48.29 | 2026-05-14 |
| `vendor-react` | 182.90 | 57.55 | 49.28 | 2026-05-14 |
| `vendor-state` | 2.37 | 1.15 | 1.05 | 2026-05-14 |
| `vendor-sqltools-formatter` | 33.05 | 9.46 | 8.18 | 2026-05-14 |
| entry (`index`) | 40.27 | 12.52 | 10.95 | 2026-05-14 |

参考 (`#501` 等での比較に有用な周辺 chunk):

| chunk | raw (KB) | gzip (KB) |
| ----- | -------- | --------- |
| `providers` (dynamic) | 280.31 | 64.47 |
| `editor.worker` (Monaco worker) | 280.01 | (raw のみ) |
| `style.css` | 234.86 | 35.73 |
| `ResultGrid` | 54.80 | 18.01 |
| `LeftPanel` | 28.01 | 9.54 |
| `ConnectionDialog` | 20.82 | 5.72 |
| `queryStore` | 19.60 | 6.63 |
| `SqlEditor` | 16.15 | 6.02 |

> `vendor-monaco` が全体の **78%** (raw) / **76%** (gzip) / **75%** (brotli) を占める。`SqlEditor` / `ResultGrid` / `ERDiagramView` はいずれも `lazyWithRetry` (React.lazy) で動的 import しているため、`vendor-monaco` は SqlEditor タブを初めて開くまで読み込まれない (初期 JS = entry 40kB のみ)。#507 対応済。

### 本セクションのスコープ外 (follow-up)

- `web-vitals` ライブラリ導入による LCP / CLS / INP の自動取得 — WebView2 file:// 配信での挙動が未確認のため別 issue 化
- Lighthouse CI 自動実行 — 同上
- Playwright + Chrome DevTools Protocol での measure 自動取得 — `#5` (60fps 検証) と統合検討

## 参考

- [README.md - パフォーマンス目標と実装](../README.md#パフォーマンス目標と実装)
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md)
- 関連 issue: #418 (パフォーマンス向上)、#416 (本検証)、#479 (perf リファクタ親)、#494 (フロントエンド計測基盤)
