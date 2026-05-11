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

## 参考

- [README.md - パフォーマンス目標と実装](../README.md#パフォーマンス目標と実装)
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md)
- 関連 issue: #418 (パフォーマンス向上)、#416 (本検証)
