# #718: パスワード取得・消失経路の調査

調査対象: main `12b8a84a0e75ec7590181e16cbb890c54991f932`。
資格情報の取得だけでなく、保存、上書き、接続文字列生成まで確認した。

## DBパスワード

| 境界 / メソッド | 値の出所と空になる条件 | 判断 |
| --- | --- | --- |
| `useConnectionProfile.loadProfile` | `savePassword=true` なら `getProfilePassword(id)`。それ以外、空の応答、取得失敗ではフォーム初期値 `''` | 取得失敗を表示せず継続する。フォームに入力した値は保存値とは別 |
| `ConnectionDialog` のテスト接続 / 本接続 | フォームの `config.password` を渡す。本接続は `MainLayout` 経由 | 保存パスワードを接続直前に再取得しない |
| `ObjectTree` の接続確認 | `useWindowsAuth=false` なら `getProfilePassword(id)`。それ以外は `''` | 今回の申告値は false。フラグの条件変更だけでは説明できない |
| `connectionProfileProvider.getProfilePassword` / IPC | IDを送信し、応答の password を文字列として検証 | 空文字は許可。IPC失敗は例外 |
| `SettingsProvider::getProfilePassword` | `SettingsAccessor::getProfilePassword` の結果をJSONへ変換 | 復号失敗はエラー応答。空文字へ置換しない |
| `SettingsAccessor::getProfilePassword` | IDで保存プロファイルを検索。`encryptedPassword.empty()` なら空文字。それ以外はDPAPI復号 | ID不一致はエラー。空文字の明示的な返却箇所 |
| `CredentialProtector::decrypt` | Base64デコード後 `CryptUnprotectData` | 空の暗号文入力は空文字。デコード・DPAPI失敗はエラー |
| `connectionStore.addConnection` / `connectionProvider.connectAsync` | 渡された password をそのままIPC要求へ入れる | 意図的な空文字化なし |
| `extractConnectionParams` | IPCのpassword文字列を所有する `std::string` にコピー | 欠落・型不正なら初期値の空文字 |
| `prepareConnection` / `buildConnectionString` | パラメータをコピーし、PostgreSQLではpasswordをlibpq用にエスケープ | PostgreSQLではuseWindowsAuthによるpassword省略なし |
| `AsyncConnectionExecutor` / `PostgreSQLDriver` | 生成済み接続文字列を接続処理へ渡す | ダイアログの本接続とツリーの本接続が共有する経路 |

## 保存・消去

`SettingsProvider::saveConnectionProfile` は空の暗号化フィールドを持つ構造体を生成し、
`SettingsAccessor::updateConnectionProfile` の `*it = profile` で既存値を上書きする。
その後、`savePassword=true` でもpasswordが省略・空欄ならsetterを呼ばないため、
保存済みパスワードは失われる。暗号化setterやファイルsaveの失敗も無視されていた。

修正はDB / SSHパスワード / 鍵パスフレーズを引き継いでから、明示的な置換・削除を適用する。
setterや保存に失敗した場合はエラーを返し、メモリの旧プロファイルを復元する。

`setProfilePassword(id, "")` は明示的に暗号文を消去し、savePasswordもfalseにする。
SSHの2つのsetterも空文字で暗号文を消去する。プロファイル削除と設定全体の置換も
資格情報を含む状態を変更する。`updateSettings` の呼び出し側は既存AppSettingsをコピーして
一般設定などを編集しており、通常経路ではプロファイルを初期化していない。

## SSHとその他の取得箇所

- `ObjectTree` はSSH認証方式に応じて `getSshPassword` / `getSshKeyPassphrase` を取得する。
  BackendはDBパスワードと同様に、空の暗号文なら空文字、復号失敗ならエラーを返す。
- 編集画面の `SELECT_PROFILE` はSSHパスワードとパスフレーズを空で初期化し、保存値を取得しない。
  保存時は入力欄が空ならSSHのsavePassword=falseを送るため、別途、保存済みSSH資格情報の
  UIでの取り扱いを修正する必要がある。今回のDBパスワード欠落と同一原因とは断定しない。
- `SshTunnel` は渡されたSSH資格情報をlibssh2へ渡す。DBパスワードとは別の値。
- `psql_subprocess` はCOPY処理用の子プロセス環境にPGPASSWORDを設定する。
  初回DB接続のパスワード取得経路ではない。
- DEV用mock応答とテストfixtureも確認した。実アプリの保存資格情報の実装ではない。

## 確定していない点

#718の「同じプロファイルを再選択してダイアログから本接続成功、変更せず直後にツリーでは失敗」
という手順で、保存処理が実行された証拠はない。今回見つけた消失バグは修正可能だが、
これだけで報告された経路差の根本原因と断定できない。Issueは自動クローズしない。
