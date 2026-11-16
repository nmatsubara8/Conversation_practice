# Luanti 連携試作

Windows の同じ PC で Luanti と Node.js を実行し、物と置き場所が会話側へ渡るかを確認します。まず物と場所の判定だけを試す手順です。マヤとの練習は後半を参照してください。

1. リポジトリのルートで `node integrations/luanti/bridge.mjs` を実行します。
2. `conversation_practice` フォルダーをテストワールドの `worldmods` にコピーします。
3. Luanti の `minetest.conf` に `secure.http_mods = conversation_practice` を設定して再起動します。既存の一覧がある場合はコンマ区切りで追加します。
4. テストワールドで管理権限のあるプレイヤーが次のコマンドで試作用の4ブロックを取得し、間隔を空けて置きます。

   ```text
   /giveme conversation_practice:water
   /giveme conversation_practice:cup
   /giveme conversation_practice:target
   /giveme conversation_practice:other
   ```

5. 水を右クリックで選び、次に緑の場所を右クリックします。橋渡しサーバーが両方を確認し、緑の上に水が表示されます。空のコップや別の場所を選ぶと、どちらを確かめるかがチャット欄に表示されます。

## VoxeLibre でマヤと水を運ぶ

Luanti のオンラインコンテンツから VoxeLibre を導入し、専用のテストワールドを作ります。上の手順で Mod を有効にし、水・空のコップ・緑の台を平らな場所に並べます。水から台までは 4〜8 ブロック程度離し、マヤが通れる直線を空けてください。

Windows の PowerShell で、リポジトリのルートから連携サーバーを起動します。Ollama を Tailscale IP だけで待ち受けている場合は、その URL を指定します。

```powershell
$env:OLLAMA_URL = 'http://<WindowsのTailscale IP>:11434'
$env:OLLAMA_MODEL = 'qwen3:14b'
$env:ISLAND_HISTORY_DIR = 'X:\会話練習アプリ\luanti-history'
node .\integrations\luanti\bridge.mjs
```

`ISLAND_HISTORY_DIR` を設定すると発話の原文をそこに保存します。指定を省くと、起動フォルダーの `.luanti-history` を使います。連携サーバーは同じ PC からのみ接続できる試作用です。履歴の分離には Luanti のプレイヤー名を使います。家族の PIN 認証や、NAS 接続断時の再送は本実装で追加します。

1. ゲーム内で `/practice_maya` を実行します。マヤが水の方を向きます。
2. マヤを右クリックすると、一緒に水を運ぶことに合意します。マヤは水へ歩き、運んでいる間に Ollama で作った英語の一文を表示します。発話は自動で履歴に残ります。
3. マヤは緑の台の手前で止まり、台を光で示して待ちます。マヤをもう一度右クリックすると、空いている台に水を置きます。
4. `/practice_history` で直近 20 件の原文を開けます。一文を選んで「意味を確認」を押すと、日本語の訳と短い説明が表示されます。

音声で聞く場合は、作業を始める前に同じ Windows PC のブラウザで [マヤの読み上げ](http://127.0.0.1:3217/voice) を開きます。Luanti のプレイヤー名を入力して「新しい発話を読み上げる」を押し、タブを開いたままゲームに戻ります。読み上げにはブラウザの米国英語音声を使います。

マヤの移動は平らなテスト場所に合わせた試作です。障害物を回り込む経路探索、敵の検知、Safari と共有する語彙の記憶、語句単位の選択は次段階です。置く前の確認は身ぶりで表現します。
