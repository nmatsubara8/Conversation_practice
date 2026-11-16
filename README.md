# 会話練習アプリ

浜辺で相手役と出会い、指さしと短い発話で名前や水の意味を確かめる PoC です。

- `site/` はブラウザ画面と Node.js の会話サーバーです。
- `whisper/` は faster-whisper の音声認識サービスです。

既存の NAS 上の Docker Compose から両ディレクトリをビルドします。別ホストで Ollama を動かす場合は、Compose の `web.environment` に `OLLAMA_URL` を設定してください。値は `http://<Ollamaホスト>:11434` です。Whisper を別コンテナで動かす場合は、同様に `STT_URL` を設定します。

共有済みの表現だけを相手役が話す仕組みは設計段階です。現行 PoC には定型のセリフがあります。
