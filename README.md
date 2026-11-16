# 会話練習アプリ

浜辺で相手役と出会い、指さしと短い発話で名前や物の意味を確かめる PoC です。「水とコップの練習」では、物と場所の言葉を確認し、水を置くお願いを聞いて行動します。

- `site/` はブラウザ画面と Node.js の会話サーバーです。
- `whisper/` は faster-whisper の音声認識サービスです。
- `integrations/luanti/` は [Windows 上の Luanti 連携試作](integrations/luanti/README.md) です。

## iPhone の Safari 版を NAS に導入する

この手順は、NAS 上の Docker Compose プロジェクト `island-poc` が稼働し、iPhone から Tailscale 経由の HTTPS で開ける環境を対象とします。Compose ファイルと各接続先は導入先で管理します。

### 1. Windows でソースを取得して NAS にコピーする

PowerShell で実行します。初回は Windows のユーザーフォルダーに取得し、次回からは同じフォルダーを更新します。

```powershell
Set-Location $env:USERPROFILE
if (Test-Path '.\Conversation_practice-luanti\.git') {
    git -C '.\Conversation_practice-luanti' pull --ff-only origin main
} else {
    git clone --branch main https://github.com/nmatsubara8/Conversation_practice.git Conversation_practice-luanti
}
if ($LASTEXITCODE -ne 0) { throw 'GitHub からソースを取得できませんでした。' }
Set-Location '.\Conversation_practice-luanti'
git log -1 --oneline

$destination = 'X:\会話練習アプリ\site'
if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
    throw 'NAS 上の site フォルダーを確認してください。'
}
Copy-Item -Path '.\site\*' -Destination $destination -Recurse -Force -ErrorAction Stop
```

通常の画面更新でコピーするのは `site` の中身です。Compose ファイルや Whisper の設定はそのまま使います。Windows の Ollama を利用する場合は、再ビルド前に Compose の `web.environment` で `OLLAMA_URL` が Windows 側の URL（`http://<WindowsのTailscale IP>:11434`）に設定されていることを確認します。Whisper が別サービスの場合は、既存の `STT_URL` を使います。

手動録音を使う版への初回更新では、`whisper/island-stt.py` も NAS の対応する `whisper` フォルダーへコピーします。

### 2. NAS で web サービスを更新する

**Windows の PowerShell** から NAS に接続します。`NAS_USER` と `NAS_IP` は、普段 NAS に SSH 接続するときの値に置き換えてください。

```powershell
ssh NAS_USER@NAS_IP
```

**SSH 接続後の NAS** で実行します。

```bash
cd '/volume1/apps/language/会話練習アプリ'
sudo docker compose -p island-poc up -d --build --no-deps whisper web
sudo docker compose -p island-poc ps web
sudo docker compose -p island-poc exec -T web node --check /app/placement.mjs
```

`web` の起動やモジュールの確認でエラーが出た場合は、同じ NAS のシェルで `sudo docker compose -p island-poc logs --tail=80 web` を実行します。

### 3. iPhone で確認する

1. Safari でいつもの HTTPS の URL を開き直します。「音声認識の設定」で **NAS（Whisper）** を選び、「水とコップの練習」を開きます。うなずきを使う場合は Safari にカメラを許可します。
2. **水 → 音を聞く** の順にタップします。`water` を聞き、**録音する → 「みず」と話す → 録音を止める** の順で操作します。声が拾われない場合は「マイクを再開」を押し、「マイクの準備ができました。」を確認してから言い直します。「water、みず」と返ってきたら、相手役が言い終えてからうなずくか ✓ を押します。聞き違いなら ✕ で言い直せます。
3. **空のコップ**と**台の上**を順に選び、「コップ」「ここ」と教え、同じように確かめます。
4. **水を置くよう頼む**を押し、「みず、ここ」と言います。相手役が水を台に置こうとする表示を確認し、✓ を押します。
5. **相手のお願いを聞く**を押します。声を聞いて「水」「台の上」「置く」を選び、「動作をする」を押します。台に水が表示されれば一往復できています。迷った場合は「身ぶりを見る」を使えます。
6. 水を選び直して別の呼び方を教え、合意すると、以前のお願いを聞くボタンが無効になることを確認します。水と場所の言葉を組み合わせて、お願いを再確認できます。

この版の学習記録は開いているページ内に保持します。NAS への自動保存、日記、家族別ログイン、Luanti での会話連携は今後の実装です。

## Whisper の処理時間を比較する

[Windows の GPU と NAS の CPU で同じ音声を測る手順](whisper/README.md) を用意しています。
