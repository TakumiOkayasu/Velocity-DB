# トラブルシューティング

## ビルドエラー

### Ninja Permission Error

```
ninja: error: failed recompaction: Permission denied
```

- 自動回復機能あり（最大3回リトライ）
- VSCode/Visual Studio を閉じる
- VelocityDB.exe を終了

### MSVC Not Found

- Developer Command Prompt for VS 2022 から実行
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
