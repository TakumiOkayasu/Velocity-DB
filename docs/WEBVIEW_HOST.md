# WebView ホストと起動設定

## ホスト境界

`WebViewApp` は `IWebViewHost` を受け取り、ウィンドウ・フロントエンドの配置・起動設定と
JSON リクエストハンドラーを渡す。既定の実装は `makeWebView2Host()` のみ。
別エンジンを追加する場合はこの境界を実装し、アプリの構成箇所で選択する。
現時点でエンジン選択 UI や別エンジンの実装はない。

- `backend/host/webview_host.h`: ホスト設定とブロッキング `run` の契約
- `backend/host/webview2_host.cpp`: WebView2 の生成・設定と既存ブリッジの接続
- `backend/host/webview2_options.h`: 型付き設定から固定のブラウザー引数への変換
- `third_party/webview.h`: Windows ウィンドウ、COM、ワーカープール、UI スレッドへの応答配送

フロントエンドは従来どおり `window.invoke` を使う。JSON 要求・応答、Promise の相関付け、
ワーカーから UI スレッドへの配送は維持する。代替ホストも同じ契約を提供し、
`run` が戻る前に要求処理とコールバックを終了させる必要がある。
DB 接続・クエリ・設定の Provider はネイティブのウィンドウや COM 型を扱わない。

## 保存値と起動時の値

設定ダイアログの「WebView」で変更し、既存の `updateSettings` で
`settings.json` の `webview` に保存する。通常の保存先は
`%LOCALAPPDATA%/Velocity-DB/settings.json`。
設定ファイルはアプリ起動時に一度読み込み、ホストと `SettingsProvider` が同じ値を受け取る。

`getSettings` は以下を別々に返す:

- `webview`: 保存された次回起動用の値
- `webviewStartup`: このアプリ起動時にホストへ渡した値。保存しても変更しない
- `webviewRestartRequired`: 保存値と起動時の値が異なるか

変更を適用するには、開いている Velocity-DB をすべて正常終了して起動し直す。
保存だけではホストを作り直さず、タブや未保存 SQL を閉じない。
起動時の値は「要求した設定」であり、GPU の利用可否や描画の成功を保証する値ではない。
WebView2 のランタイム・端末ポリシー・環境変数などで実効動作が変わる場合がある。

| 設定 | 既定値 | WebView2 への要求 |
| --- | --- | --- |
| `gpuCompositing` | `false` | OFF では従来の `--disable-gpu-compositing` を維持。ON はこの制限を外してランタイムの既定動作に任せる |
| `rendererBackgrounding` | `false` | OFF では従来の `--disable-renderer-backgrounding` を維持。ON は非アクティブ時の優先度低下を許可する |
| `cacheEnabled` | `false` | OFF では従来どおり CDP `Network.setCacheDisabled` を要求。ON はブラウザー既定のキャッシュ動作を使う |
| `openDevToolsOnStartup` | `false` | ON は起動時に開発者ツールを開く。OFF は自動で開かないだけで、開発者ツール自体の利用禁止ではない |

全項目 OFF が変更前と同じ動作。GPU 合成の設定は GPU 全体の有効・無効とは異なり、
キャッシュ設定は既存キャッシュの消去ではない。これらは WebView2 固有の要求であり、
別エンジンへ無条件に同じ意味で移植しない。任意のコマンドライン引数、セキュリティ機能の無効化、
プロファイル保存先やランタイム実行ファイルの自由指定は受け付けない。
旧設定ファイルに `webview` がなくても既定値を使用する。

起動ログには WebView2 のランタイム版・要求した設定・一部 API の成否を記録する。
要求と API の成否を区別し、成功ログだけで最終的な画面描画を正常と判断しない。

## 部分的な描画欠けの切り分け (#779)

報告された再現操作はテーブルのタブを高速に閉じたり開いたりすること。
欠けるのは WHERE 入力欄より下のテーブル領域の一部で、アプリ全体の白画面ではない。
この設定機能の追加だけで原因特定・修正済みとは扱わない。

1. 同じビルド・テスト用データ・表示サイズで、データ入りタブの開閉順序と回数を固定する。
   アプリ版、Windows 版、WebView2 ランタイム版、表示倍率、起動設定、再現時刻を記録する。
2. 欠けた状態のスクリーンショットと DOM を比較する。テーブル、見出し、先頭の表示行の有無、
   `getBoundingClientRect()`、スクロール位置、仮想行範囲、computed style を確認する。
   DOM/レイアウト欠落と、存在するのにピクセルが欠ける状態を分ける。
3. ウィンドウのリサイズ・最小化からの復元で戻るか確認する。
   回復だけでは GPU 原因と断定せず、レイアウト再計測とネイティブ再描画の両方を候補に残す。
4. 同じ UI と固定データを通常ブラウザーと WebView2 で比較する。
   ブラウザー側の別データや IPC モック差を描画エンジン差と混同しない。
5. 起動設定は一度に一つだけ変え、完全終了・再起動後に同じ操作を繰り返す。
   改善の有無と変更前の基準動作への復帰を確認する。

単体テストは設定の互換性・保存・起動時スナップショット・引数変換・ブリッジ契約を検証する。
WebView2 の描画欠けや実 GPU/COM 動作の再現を保証するものではない。
ログやスクリーンショットを共有する前に、SQL・DB の内容・接続情報など不要な秘密情報を除く。

参考:
[WebView2 のブラウザーフラグ](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/webview-features-flags)、
[WebView2 のパフォーマンス](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/performance)、
[CDP Network.setCacheDisabled](https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-setCacheDisabled)。
