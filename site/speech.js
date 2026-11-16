function makeWav(frames, sampleRate) {
  const sourceLength = frames.reduce((total, frame) => total + frame.length, 0);
  const samples = new Float32Array(sourceLength);
  let start = 0;
  for (const frame of frames) { samples.set(frame, start); start += frame.length; }
  const outputRate = Math.min(sampleRate, 16000);
  const ratio = sampleRate / outputRate;
  const sampleCount = Math.floor(sourceLength / ratio);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  const label = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  label(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  label(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, outputRate, true);
  view.setUint32(28, outputRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, sampleCount * 2, true);
  for (let index = 0; index < sampleCount; index++) {
    const from = Math.floor(index * ratio);
    const to = Math.floor((index + 1) * ratio);
    let sum = 0;
    for (let source = from; source < to; source++) sum += samples[source];
    const sample = sum / (to - from);
    view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
  }
  return buffer;
}

export function createWhisperSpeech({ canListen, isSpeaking, contextForTurn, onSpeechStart, onSustainedSpeech, onText, onTurnEnd, onStatus }) {
  let run;

  function stop() {
    const previous = run;
    run = undefined;
    if (!previous) return;
    previous.request?.abort();
    previous.stream?.getTracks().forEach((track) => track.stop());
    void previous.audio.close().catch(() => {});
  }

  async function start() {
    stop();
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio || !navigator.mediaDevices?.getUserMedia) {
      onStatus('このブラウザではWhisper用の録音を開始できません。');
      return;
    }
    let current;
    try {
      const audio = new Audio();
      current = { audio };
      run = current;
      await audio.resume();
      if (run !== current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (run !== current) { stream.getTracks().forEach((track) => track.stop()); return; }
      current.stream = stream;
      const microphone = audio.createMediaStreamSource(stream);
      const processor = audio.createScriptProcessor(2048, 1, 1);
      const mute = audio.createGain();
      mute.gain.value = 0;
      microphone.connect(processor);
      processor.connect(mute);
      mute.connect(audio.destination);

      const frameMs = 2048 * 1000 / audio.sampleRate;
      let lead = [];
      let frames = [];
      let voiceMs = 0;
      let quietMs = 0;
      let noise = 0.003;
      let turn;
      function reset() { lead = []; frames = []; voiceMs = 0; quietMs = 0; turn = undefined; }

      processor.onaudioprocess = (event) => {
        if (run !== current || current.request) { reset(); return; }
        if (!canListen()) {
          if (turn) onTurnEnd(turn);
          reset();
          return;
        }
        const frame = event.inputBuffer.getChannelData(0);
        const loudness = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
        const overlapping = turn ? Boolean(turn.playback) : isSpeaking();
        const voiced = loudness > Math.max(overlapping ? 0.02 : 0.009, noise * 3);
        if (!voiced && !frames.length) noise = 0.95 * noise + 0.05 * loudness;
        if (voiced && !frames.length) {
          turn = contextForTurn();
          onSpeechStart();
          frames = lead;
          lead = [];
          onStatus('マイクで聞いています。');
        }
        if (!turn) {
          lead.push(frame.slice());
          if (lead.length > Math.ceil(240 / frameMs)) lead.shift();
          return;
        }
        frames.push(frame.slice());
        if (voiced) {
          turn.speechEndedAt = performance.now();
          voiceMs += frameMs;
          quietMs = 0;
          if (turn.playback && !turn.pauseRequested && voiceMs >= 460) {
            turn.pauseRequested = true;
            onSustainedSpeech(turn);
          }
        }
        else quietMs += frameMs;
        if (quietMs < turn.endSilenceMs && frames.length * frameMs < 6500) return;
        if (voiceMs >= 95) void transcribe(current, frames, turn);
        else onTurnEnd(turn);
        reset();
      };
      onStatus('マイクの準備ができました。');
    } catch (error) {
      if (current && run !== current) return;
      stop();
      onStatus(`マイクを起動できませんでした（${error.name}）。Safariのマイク許可を確認してください。`);
    }
  }

  async function transcribe(current, frames, turn) {
    const request = new AbortController();
    current.request = request;
    turn.uploadedAt = performance.now();
    onStatus('NASで文字起こししています。');
    try {
      const headers = { 'Content-Type': 'audio/wav', 'X-Island-Language': turn.language };
      if (turn.hint) headers['X-Island-Name-Hint'] = encodeURIComponent(turn.hint);
      const response = await fetch('/api/island/transcribe', {
        method: 'POST', headers, body: makeWav(frames, current.audio.sampleRate), signal: request.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { text } = await response.json();
      turn.transcribedAt = performance.now();
      if (run !== current) return;
      if (text) { onStatus('NASのWhisperで文字起こししました。'); await onText(text, turn); }
      else onStatus('声を文字にできませんでした。もう一度話してください。');
    } catch (error) {
      if (run === current && error.name !== 'AbortError') onStatus(`NASの音声認識に接続できません（${error.message}）。`);
    } finally {
      current.request = undefined;
      if (run === current) onTurnEnd(turn);
    }
  }

  return { start, stop };
}
