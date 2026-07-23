# E2E パフォーマンスベンチマーク (#515)

`frontend/e2e/perf-baseline.spec.ts` の計測結果を `docs/perf/e2e-benchmark.json` に自動記録する。
対象シナリオ:

| シナリオ | metric | 内容 | リグレッション上限 |
| -------- | ------ | ---- | ------------------ |
| `app-mount` | `startup` | App ルート初回マウント | 230 ms |
| `app-mount` | `object-tree` | ObjectTree 初回マウント | — |
| `app-mount` | `sql-editor` | SqlEditor (Monaco) 初回マウント | — |
| `er-diagram` | `er-diagram-50` | ER 図 50 テーブルのレンダリング | 500 ms |
| `result-grid` | `result-grid-1k` | クエリ実行 → 1000 行 × 10 列の結果表示 | — (#501 完了後に追加) |

## 実行方法 (ローカル)

hook が node/npm/bun の直接実行をブロックするため Docker 経由で実行する
(image タグは `frontend/bun.lock` の `@playwright/test` バージョンに合わせること):

```bash
# ベンチマークのみ (perf-baseline.spec.ts)
docker run --rm -v "C:/prog/Velocity-DB://app" \
  --mount "type=volume,target=//app/frontend/node_modules,source=frontend-bun-pw" \
  -e VELOCITYDB_GIT_COMMIT=$(git rev-parse --short HEAD) \
  -w "//app/frontend" mcr.microsoft.com/playwright:v1.58.2-jammy \
  bash -c 'npm install -g bun 2>&1 | tail -2 && bun install 2>&1 | tail -3 && npx playwright test e2e/perf-baseline.spec.ts'
```

`bun run test:e2e:bench` (package.json script) も同一 spec を実行する
(コンテナ内では `bun run` が Playwright の worker_threads と非互換のため `npx playwright test` を使う)。

実行後、`docs/perf/e2e-benchmark.json` が更新される。E2E 全体 (`npx playwright test`) を
実行した場合も perf spec が含まれるため同様に更新される。

- `-e VELOCITYDB_GIT_COMMIT=...`: コンテナ内では `.git` の参照に失敗することがある
  (worktree / dubious ownership) ため、ホスト側で取得したコミットハッシュを注入する。
  省略した場合は `git rev-parse` を試行し、失敗時は `"unknown"` が記録される。
- `-e VELOCITYDB_BENCH_ENV=<name>`: 環境名の明示的な上書き (省略時は `/.dockerenv` の有無で
  `docker` / `process.platform` を自動判定)。

## JSON の内容

```jsonc
{
  "meta": {
    "generatedAt": "2026-07-23T12:34:56.789Z",  // 最終書き込み時刻 (ISO 8601)
    "gitCommit": "d594ad7",                      // 計測時の HEAD (short hash)
    "playwrightVersion": "1.58.2",
    "environment": "docker",                     // docker / win32 / linux など
    "note": "..."                                // 計測条件の注意書き
  },
  "results": [
    {
      "scenario": "app-mount",   // シナリオ識別子
      "metric": "startup",       // performance measure 名
      "durationMs": 191.7,       // 計測値 (ms)。取得失敗時は null
      "targetMs": 230            // リグレッション上限 (上限 assertion のない metric では省略)
    }
  ]
}
```

- 同一 `scenario` + `metric` のエントリは再実行のたびに上書きされる ("latest" ファイル)。
  ベンチ spec 全体を実行すれば全エントリが最新値になる。
- 記録はリグレッション上限 assertion より前に行うため、上限超過でテストが fail しても
  実測値は JSON に残る。
- `results` は `scenario` → `metric` 順でソートされ、diff が安定する。

## 計測条件の注意 (mocked IPC)

計測は **Vite dev server + mock された `window.invoke`** (`page.addInitScript`) に対して行う。
つまり値は **frontend レンダリングのみのリグレッション基準値** であり、
production WebView2 / 実 DB (ODBC) の実測値ではない。C++ backend・実クエリの性能は含まれない。

また、コンテナ実行はホスト直接実行より遅い。リグレッション上限
(`STARTUP_TARGET_MS` = 230 ms, `ER_DIAGRAM_TARGET_MS` = 500 ms) は較正時の開発マシンの
Docker 実行 (startup 実測 191.7 ms) 基準であり、異なるマシンでは超過する可能性がある。
上限を安易に引き上げず、環境差か実リグレッションかを切り分けること。

既知の計測特性:

- JSON に記録される `app-mount` の値は spec 先頭テストの計測値で、**Vite dev server の
  モジュール変換キャッシュが cold な状態** を含む。上限 assertion
  (`startup_should_be_under_target_ms_...`) は 2 回目のページロード (warm) で再計測するため、
  遅いマシンでは「suite は pass するが記録値は targetMs を超える」ことがある。
- E2E 全体実行 (`npx playwright test`) では他 spec が並列 worker で同時に走り CPU を奪うため
  計測値が膨らむ。**記録用の実行はベンチ単体コマンド (上記) を使うこと**。

## 実行間の比較方法

`docs/perf/e2e-benchmark.json` はコミット対象。比較は git 履歴で行う:

```bash
# 直前のコミットとの比較
git diff HEAD~1 -- docs/perf/e2e-benchmark.json

# 変更履歴の一覧
git log -p --follow -- docs/perf/e2e-benchmark.json
```

計測値を更新したら、変化量 (改善/悪化) をコミットメッセージ or PR に記載すること。

## スコープ外 (別タスク)

- CI での自動実行・履歴集計 (#515 では対象外)
- production WebView2 / 実 DB 接続での実測
- ベースライン値テーブルの手動転記は `docs/PERFORMANCE_VALIDATION.md` を参照
