# Luanti 連携試作

Windows の同じ PC で Luanti と Node.js を実行し、物と置き場所が会話側へ渡るかを確認します。音声・カメラ・会話本体との統合は次段階です。

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
