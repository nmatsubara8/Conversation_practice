# Whisper の Windows GPU 比較

既存の NAS 版（CPU、medium）と、Windows で並行起動する試験版（RTX、medium）に、同じ WAV を送って比べます。Windows 版はコンテナ内のループバックだけで待ち受けます。既存の iPhone からの接続先は変えません。

## 1. Windows で GPU 版を起動する

Docker Desktop の Linux コンテナと WSL 2 バックエンド、および NVIDIA ドライバーを使用します。[Docker Desktop の GPU 対応](https://docs.docker.com/desktop/features/gpu)を参照してください。

Windows の PowerShell で、最新のリポジトリのルートから実行します。

```powershell
docker build -f whisper/Dockerfile.gpu -t island-whisper-gpu ./whisper
docker run -d --gpus all --name island-whisper-gpu --mount type=volume,source=island-whisper-gpu-models,target=/models island-whisper-gpu
docker logs -f island-whisper-gpu
```

初回はモデルをダウンロードします。`Whisper ready` が出たら Ctrl+C でログ表示を終了します。コンテナは動き続けます。GPU 利用時は、CUDA が使えなければ起動または文字起こしが失敗します。

## 2. 同じ音声を Windows 版で測る

8 秒以内のモノラル PCM 16 ビット WAV を一つ用意し、リポジトリのルートに `sample.wav` として置きます。例えば “Could I have a drink?” を一回録音します。日本語なら、以下の `--language en` を `--language ja` に変え、NAS 側でも同じ指定を使います。

```powershell
docker cp .\sample.wav island-whisper-gpu:/tmp/sample.wav
docker cp .\whisper\benchmark.py island-whisper-gpu:/tmp/island-benchmark.py
docker exec island-whisper-gpu python /tmp/island-benchmark.py /tmp/sample.wav --language en
```

## 3. NAS 版で測る

Windows の PowerShell から、同じ WAV とスクリプトを NAS のホームフォルダーへ転送し、SSH で接続します。以下のユーザー名とホストを実環境の値に置き換えます。

```powershell
scp .\sample.wav .\whisper\benchmark.py NAS_USER@NAS_IP:
ssh NAS_USER@NAS_IP
```

SSH 接続後の NAS で実行します。

```bash
cd '/volume1/apps/language/会話練習アプリ'
container=$(sudo docker compose -p island-poc ps -q whisper)
sudo docker cp "$HOME/sample.wav" "$container:/tmp/sample.wav"
sudo docker cp "$HOME/benchmark.py" "$container:/tmp/island-benchmark.py"
sudo docker compose -p island-poc exec -T whisper python /tmp/island-benchmark.py /tmp/sample.wav --language en
```

どちらも `model` が `medium` であることを確認し、初回・再試行 3 回の中央値・認識結果を比べます。CPU は INT8、GPU は FP16 です。この測定には iPhone との通信や読み上げが含まれません。GPU で速くなったら、次は GPU 版の測定中に普段の iPhone 操作を行い、共用する Ollama の応答時間も確認します。

測定後に Windows の試験用コンテナを止めるには `docker stop island-whisper-gpu`、再開するには `docker start island-whisper-gpu` を使います。実際の発話を使った場合は、測定後にコピーした WAV を Windows・NAS・両コンテナから削除できます。
