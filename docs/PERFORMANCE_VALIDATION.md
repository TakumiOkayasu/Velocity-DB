# Performance Validation Report

`README.md` のパフォーマンス目標 (12 項目) について、実装状況の検証結果を記録する。

- **対象 README**: [README.md#パフォーマンス目標と実装](../README.md#パフォーマンス目標と実装)
- **関連 issue**: #416 (パフォーマンス目標と実装)
- **検証範囲**: 実装の有無・計測手段の有無・実測値
- **検証範囲外**: 全項目の実環境ベンチマーク (実DB / WebView2 実環境を要するもの)

## サマリ

| # | 目標 | 実装 | 計測機構 | 既存ベンチマーク | 達成判定 |
| --- | ------ | ------ | ---------- | ------------------ | ---------- |
| 1 | アプリ起動 < 0.3s | ✅ | ❌ | ❌ | 🔍 未実測 |
| 2 | SQL Server 接続 < 50ms | ✅ | ⚠️ 部分 | ❌ | 🔍 未実測 |
| 3 | SELECT (100万行) < 500ms | ✅ | ✅ | ❌ | 🔍 未実測 |
| 4 | 結果表示開始 < 100ms | ✅ | ✅ | ⚠️ 部分 | 🔍 未実測 |
| 5 | 仮想スクロール 60fps | ✅ | ❌ | ⚠️ 部分 | 🔍 未実測 |
| 6 | SQL フォーマット < 50ms | ✅ | ❌ | ❌ | 🔍 未実測 |
| 7 | CSV エクスポート (10万行) < 2s | ✅ | ✅ | ✅ | 🔍 未実測 |
| 8 | A5:ER ロード (100テーブル) < 1s | ✅ | ❌ | ❌ | 🔍 未実測 |
| 9 | ER 図レンダリング (50テーブル) < 500ms | ✅ | ❌ | ❌ | 🔍 未実測 |
| 10 | クエリ履歴検索 (1万件) < 100ms | ✅ | ❌ | ❌ | 🔍 未実測 |
| 11 | 結果フィルタリング (AVX2 SIMD) | ✅ | ❌ | ❌ | 🔍 未実測 |
| 12 | LRU 結果キャッシュ (100MB) | ✅ | N/A | ✅ | ✅ サイズ上限・LRU 動作確認済 |

**凡例**: ✅ 実装あり / ⚠️ 部分的 / ❌ なし / 🔍 未実測

**結論**: 全 12 項目に該当する実装機構は存在する。ただし継続的な計測 (ベンチマークテスト) が整備されているのは LRU キャッシュ (#12) のみであり、**ほとんどの項目で目標値が継続的に守られていることを保証する仕組みがない**。

## 各項目の詳細

### #1. アプリ起動 < 0.3s

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/webview_app.cpp:57-153` |
| 実装手法 | WebView2 直接初期化 (`webview::webview`)、ブラウザキャッシュ無効化、仮想ホスト経由ナビゲート |
| 計測機構 | なし (起動時刻のロギングなし) |
| 計測手段 | 実機での `Stopwatch` 手動計測、または `webview_app.cpp` 開始/終了点に `std::chrono::steady_clock` を追加 |
| 達成判定 | **未実測**。WebView2 ランタイム初期化コストは環境依存 |

### #2. SQL Server 接続 < 50ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/database/connection_registry.h`, `backend/database/sqlserver_driver.cpp`, `backend/database/async_connection_executor.h` |
| 実装手法 | ODBC Native API 直接利用、`shared_ptr` ベースの接続レジストリ、ThreadPool (MAX_THREADS=8) で非同期化 |
| 計測機構 | 部分的 (`async_connection_executor` 内部) |
| 計測手段 | 実 SQL Server 接続を伴う統合テストを追加し、`AsyncConnectionResult` の所要時間を記録 |
| 達成判定 | **未実測**。サーバー所在地・認証方式・TLS 確立時間で大きく変動 |

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
| 計測機構 | `dataViewSlice` 内に `performance.now()` 利用箇所あり |
| 計測手段 | E2E (Playwright) で `performance.measure` を計測する追加テスト |
| 達成判定 | **未実測**。WebView2 レンダラのレイアウト時間を含む |

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
| 計測機構 | なし |
| 計測手段 | `tests/parsers/test_sql_formatter.cpp` に `std::chrono::steady_clock` ベースの計測アサートを追加 |
| 達成判定 | **未実測**。ローカル実測が容易な項目 |

### #7. CSV エクスポート (10万行) < 2s

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/exporters/csv_exporter.h`, `backend/exporters/csv_exporter.cpp:8-79` |
| 実装手法 | `std::ofstream` バイナリモードでストリーム書き込み、UTF-8 BOM、CSV エスケープ、`reserve()` 事前割り当て |
| 計測機構 | あり (`tests/perf/test_csv_exporter_bench.cpp` の `std::chrono::steady_clock` 計測) |
| 既存ベンチマーク | `tests/perf/test_csv_exporter_bench.cpp` (10 万行 × 10 列、NULL/エスケープ混在) で 2s 上限を `EXPECT_LT` |
| 計測手段 | `ctest --preset release -L perf` で実行 |
| 達成判定 | **未実測** (要 CI 実機)。ディスク I/O 性能に依存 |

### #8. A5:ER ロード (100テーブル) < 1s

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/parsers/a5er_parser.h`, `backend/parsers/a5er_parser.cpp` |
| 実装手法 | `pugixml` 直接利用、テキスト/XML 両形式対応 |
| 計測機構 | なし |
| 計測手段 | 100 テーブルを含む A5:ER ファイルを `tests/parsers/test_a5er_parser.cpp` 用フィクスチャに追加 |
| 達成判定 | **未実測**。ファイルサイズ・スキーマ複雑度に依存 |

### #9. ER 図レンダリング (50テーブル) < 500ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `frontend/src/components/diagram/ERDiagram.tsx:1-100` |
| 実装手法 | React Flow (`@xyflow/react`)、ノード/エッジの memo 化、`GRID_LAYOUT` 自動配置 |
| 計測機構 | なし |
| 計測手段 | E2E (Playwright) で 50 テーブル分のサンプルを開いた時の `performance.mark` を記録 |
| 達成判定 | **未実測**。SVG レンダラ性能に依存 |

### #10. クエリ履歴検索 (1万件) < 100ms

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/database/query_history.h:46-72`, `backend/database/query_history.cpp:34-60` |
| 実装手法 | `std::vector<HistoryItem>` で最大 10000 件保持。`std::search` + `std::tolower` による case-insensitive linear search (O(n*m)) |
| 計測機構 | なし |
| 計測手段 | `tests/database/test_query_history.cpp` に 1 万件投入後 `search()` を計測 |
| 達成判定 | **未実測**。ローカル実測が容易な項目 |
| 備考 | 線形検索のため、SQL 平均長や検索語長によっては目標 100ms を超える可能性がある。インデックス化検討の余地あり |

### #11. 結果フィルタリング (AVX2 SIMD)

| 項目 | 内容 |
| ------ | ------ |
| 実装ファイル | `backend/utils/simd_filter.h:11-33`, `backend/utils/simd_filter.cpp` |
| 実装手法 | AVX2 intrinsics (`_mm256_*`) 直接利用、`__cpuidex()` で実行時 AVX2 検出、非対応 CPU では `std::memcmp()` フォールバック |
| 計測機構 | なし |
| 計測手段 | `tests/utils/` 配下に `test_simd_filter.cpp` を新規追加し、AVX2 経路 vs フォールバック経路を計測比較 |
| 達成判定 | **未実測**。「高速」の定義が README に明記されていない (相対比較の基準が不明) |

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
   - 🔍 個別目標 (#3 SELECT / #6 SQL フォーマット / #10 履歴検索 / #11 SIMD) の計測テスト追加は別 PR
   - 🔍 フロントエンド: Vitest での `performance.now()` ベース計測 + Playwright での E2E 計測 (未着手)
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

| 対象 | ファイル | 計測 mark 名 |
| ---- | -------- | ------------ |
| ResultGrid | `frontend/src/components/grid/ResultGrid.tsx` | `result-grid` |
| ObjectTree | `frontend/src/components/tree/ObjectTree.tsx` | `object-tree` |
| SqlEditor (Monaco) | `frontend/src/components/editor/SqlEditor.tsx` | `sql-editor` |

各コンポーネントは `useFirstRenderMark` (`frontend/src/utils/perfMarks.ts`) で初回マウントの `${name}:start` / `${name}:end` mark を打ち、`${name}` の measure entry を Performance API に記録する。再レンダリングでは記録しない (初回マウントのみ)。

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
  .filter(e => ['result-grid', 'object-tree', 'sql-editor'].includes(e.name))
  .map(e => ({ name: e.name, duration_ms: e.duration.toFixed(2) }));
```

### bundle サイズレポートの取得手順

`rollup-plugin-visualizer` v7.0.1 (Vite 8 / rolldown 対応) を opt-in で組み込んでいる。`VELOCITYDB_BUNDLE_REPORT=1` を設定したビルド時のみ `frontend/dist/bundle-report.html` を生成する。

```powershell
$env:VELOCITYDB_BUNDLE_REPORT = '1'
uv run scripts/pdg.py build frontend
# → frontend/dist/bundle-report.html をブラウザで開く
Remove-Item Env:VELOCITYDB_BUNDLE_REPORT
```

`gzipSize` / `brotliSize` を有効にしているため、各 chunk の raw / gzip / brotli サイズを併記レポートする。

### ベースライン値テーブル (要追記)

> 計測者は実機で取得した値を以下の表に追記してください。計測環境 (OS / CPU / WebView2 Runtime version) も併記すること。

#### 初回マウント時間

| 対象 | 計測条件 | duration (ms) | 計測日 | 環境 |
| ---- | -------- | ------------- | ------ | ---- |
| ResultGrid | 1000 行 × 10 列 | TBD | YYYY-MM-DD | TBD |
| ResultGrid | 10000 行 × 10 列 | TBD | YYYY-MM-DD | TBD |
| ObjectTree | 接続プロファイル 1 件展開 (テーブル 50 件) | TBD | YYYY-MM-DD | TBD |
| SqlEditor | 新規タブ初期化 | TBD | YYYY-MM-DD | TBD |

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

> `vendor-monaco` が全体の **78%** (raw) / **76%** (gzip) / **75%** (brotli) を占める。Monaco の lazy-load 分割は `#501`/`#494` 後続の優先課題候補 (follow-up issue へ)。

### 本セクションのスコープ外 (follow-up)

- `web-vitals` ライブラリ導入による LCP / CLS / INP の自動取得 — WebView2 file:// 配信での挙動が未確認のため別 issue 化
- Lighthouse CI 自動実行 — 同上
- Playwright + Chrome DevTools Protocol での measure 自動取得 — `#5` (60fps 検証) と統合検討

## 参考

- [README.md - パフォーマンス目標と実装](../README.md#パフォーマンス目標と実装)
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md)
- 関連 issue: #418 (パフォーマンス向上)、#416 (本検証)、#479 (perf リファクタ親)、#494 (フロントエンド計測基盤)
