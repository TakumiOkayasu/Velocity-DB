# Performance Benchmarks

`ctest --preset release -L perf` で実行するパフォーマンスベンチマーク群。

通常の単体テストとは分離されており、`ctest --preset release -LE perf` でスキップできる。

## ベンチ一覧

| ファイル | 対象 | 実 DB 必要 |
| ------ | ------ | ------ |
| `test_smoke_bench.cpp` | 起動スモーク | なし |
| `test_sql_formatter_bench.cpp` | SQL フォーマッター (小/中/大) | なし |
| `test_a5er_parser_bench.cpp` | A5:ER パーサー (テキスト/XML, 100テーブル) | なし |
| `test_csv_exporter_bench.cpp` | CSV エクスポーター | なし |
| `test_result_cache_bench.cpp` | LRU 結果キャッシュ | なし |
| `test_simd_filter_bench.cpp` | SIMD 文字列フィルタ | なし |
| `test_query_history_search_bench.cpp` | クエリ履歴検索 (1万件) | なし |
| `integration/test_select_million_rows_bench.cpp` | SELECT 100万行 (PG/MSSQL) | **必要** |
| `integration/test_sqlserver_connect_bench.cpp` | SQL Server 接続時間 | **必要** |

## 統合ベンチの実行手順

### SQL Server 接続ベンチ (`test_sqlserver_connect_bench`)

`VELOCITYDB_PERF_MSSQL_CONNSTR` が未設定の場合は自動スキップ。

**Docker を使った SQL Server 起動:**

```powershell
docker run -e ACCEPT_EULA=Y -e SA_PASSWORD=<SA_PASSWORD> `
  -p 1433:1433 -d mcr.microsoft.com/mssql/server:2022-latest
```

起動後、`VELOCITYDB_PERF_MSSQL_CONNSTR` を設定して実行:

```powershell
$env:VELOCITYDB_PERF_MSSQL_CONNSTR = "Driver={ODBC Driver 18 for SQL Server};Server=localhost,1433;UID=sa;PWD=<SA_PASSWORD>;TrustServerCertificate=yes;"
ctest --preset release -L perf -R SqlServerConnect
```

期待出力例:
```
[bench] SqlServerConnect (5rep): mean=12ms median=11ms max=18ms
```

### SELECT 100万行ベンチ (`test_select_million_rows_bench`)

フィクスチャの準備が必要。詳細は `scripts/perf/setup_million_row_fixture.py` を参照。

```powershell
# PostgreSQL
$env:VELOCITYDB_PERF_PG_CONNSTR = "host=localhost dbname=velocitydb_perf user=postgres password=..."
# SQL Server
$env:VELOCITYDB_PERF_MSSQL_CONNSTR = "Driver={ODBC Driver 18 for SQL Server};..."
ctest --preset release -L perf -R SelectMillionRows
```
