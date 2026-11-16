import { createPlacement, examples } from './placement.mjs';
import { createWhisperSpeech } from './speech.js?v=20';
import { characters, defaultCharacter, findCharacter } from './characters.mjs';

const element = (id) => document.getElementById(id);
const [scene, actor, status, spoken, heard, helpText, camera, media, confirm] =
  ['scene', 'actor', 'status', 'spoken', 'heard', 'helpText', 'camera', 'media', 'confirm'].map(element);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const hints = {
  water: '相手が指したものを、あなたの言葉で教えてください。',
  check: '画面の聞き取り結果と指されたものを確認してください。合っていればうなずき、違えば首を横に振ってください。',
  recall: '相手があなたから教わった言葉を使っています。タップして水を指してください。',
  practice: '覚えた言葉で水を頼みましょう。',
  'practice-confirm': '水を頼んだならうなずき、違えば首を横に振ってください。',
  done: '相手が水を渡しました。',
};

let memory = { name: '', water: '' };
let character = defaultCharacter;
const savedScenes = new Map();
let phase = 'name';
const placement = createPlacement();
let lessonTarget;
let exampleRequested = false;
let lessonQuiz = false;
let lessonHint = false;
let nameCorrection;
let pointing;
let poseLandmarker;
let active = false;
let target = '';
let candidate = '';
let recognition;
let restart;
let speaking = '';
let audioTurn = 0;
let cameraStream;
let cameraRun = 0;
let renderFrame;
let landmarker;
let gestureOrigin;
let gesturePeak;
let cameraStatus = 'カメラを起動しています。';
const gestureStatus = element('gestureStatus');
const replySource = element('replySource');
const replyTiming = element('replyTiming');
let replyRequest;
let nextTiming;
let nudgeTimer;
let nudgeRequest;
let nudges = 0;
let recordingSpeech = false;
const recentLines = [];
const followUps = {
  wait: ['Take your time.', 'No rush. I can wait.', 'Sure, whenever you’re ready.'],
  address: ['Yes? I’m listening.', 'I’m here. What is it?', 'You have my attention.'],
  name: ['Could you say your name again?', 'What should I call you?', 'Just your name is fine.'],
  water: ['What do you call this in your language?', 'I call this water. How do you say it?', 'How would you say water?'],
  tree: ['What do you call this tree?', 'What’s the word for this in your language?', 'I call this a tree. How do you say it?'],
  practice: ['What can I get you?', 'Is there something you need?', 'Tell me what you’d like.'],
};
const speechMode = element('speechMode');
const speechStatus = element('speechStatus');
const bargeIn = element('bargeIn');
const nameLanguage = element('nameLanguage');
const nameReview = element('nameReview');
const characterChoice = element('characterChoice');
const whisperSpeech = createWhisperSpeech({
  canListen: () => active && hearsSpeech() && (!speaking || (phase !== 'lesson' && bargeIn.checked)),
  isSpeaking: () => Boolean(speaking),
  manualOnly: () => phase === 'lesson',
  contextForTurn: () => {
    const gesture = recentPointing();
    const naming = phase === 'name' || gesture === 'self';
    const hint = naming && !speaking ? element('nameHint').value.trim() : '';
    const language = speaking ? 'auto' : naming ? nameLanguage.value : !acceptsSpeech() || ['water', 'lesson'].includes(phase) ? 'auto' : 'en';
    return { phase, lessonTarget, language, hint, gesture, playback: speaking, audioTurn, endSilenceMs: naming && !speaking ? 1050 : 650 };
  },
  onSustainedSpeech: pauseForWhisper,
  onSpeechStart: () => { recordingSpeech = true; cancelNudge(); replyTiming.hidden = true; },
  onText: routeSpeechTurn,
  onTurnEnd: (turn) => {
    recordingSpeech = false;
    if (turn.manual && phase === 'lesson') renderLesson();
    resumeAfterWhisper(turn);
    scheduleNudge();
  },
  onStatus: (text) => {
    speechStatus.textContent = text;
    speechStatus.hidden = !text;
    if (phase === 'lesson') renderLesson();
  },
});

function acceptsSpeech() {
  return phase === 'lesson' ? Boolean(lessonTarget && !placement.pending && !lessonQuiz) : ['name', 'water', 'practice'].includes(phase);
}

function canCorrectName() {
  return phase !== 'lesson' && Boolean(memory.name) && !['name', 'name-confirm'].includes(phase);
}

function recentPointing() {
  return pointing && performance.now() < pointing.until ? pointing.kind : undefined;
}

function hearsSpeech() {
  return acceptsSpeech() || phase === 'recall' || Boolean(recentPointing());
}

function waitingForGesture() {
  return active && (phase === 'lesson' ? Boolean(placement.pending && !speaking) : ['name-confirm', 'check', 'practice-confirm'].includes(phase));
}

function showCameraStatus(message = cameraStatus) {
  element('nameReviewRow').hidden = !active || phase !== 'name-confirm';
  gestureStatus.hidden = !waitingForGesture();
  camera.classList.toggle('preview', waitingForGesture() && Boolean(cameraStream));
  if (phase === 'lesson') confirm.hidden = !waitingForGesture();
  if (gestureStatus.textContent !== message) gestureStatus.textContent = message;
  camera.classList.toggle('preview', waitingForGesture() && Boolean(cameraStream));
}

function pose(...classes) { actor.className = classes.join(' '); }

function stopAudio() {
  cancelNudge();
  audioTurn++;
  speaking = '';
  window.speechSynthesis.cancel();
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();
}

function pauseForWhisper(turn) {
  if (!active || phase !== turn.phase || audioTurn !== turn.audioTurn || !speaking || window.speechSynthesis.paused) return;
  window.speechSynthesis.pause();
  turn.paused = true;
  actor.classList.remove('speaking');
  actor.classList.add('listening');
}

function resumeAfterWhisper(turn) {
  if (!turn.paused || !active || phase !== turn.phase || audioTurn !== turn.audioTurn || !speaking) return;
  window.speechSynthesis.resume();
  actor.classList.remove('listening');
  actor.classList.add('speaking');
}

function normalizeSpeech(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '');
}

function addressesCharacter(key) {
  const bare = key.replace(/^(?:hey|hi|hello|excuseme|ねえ|あの)/u, '').replace(/(?:さん|ねえ)$/u, '');
  return character.aliases.some((alias) => normalizeSpeech(alias) === key || normalizeSpeech(alias) === bare);
}

function acknowledgeAddress(phrase) {
  heard.textContent = `聞き取った声　${phrase}`;
  heard.hidden = false;
  status.textContent = `${character.label}がこちらを向いて聞いています。`;
  pose('listening');
  speakFollowUp(undefined, 'address');
}

function isBackchannel(value) {
  return /^(yeah|yes|yep|uh|um|uhhuh|mmhmm|oh|okay|ok|mm|うん|ええ|ああ|はい)$/.test(value);
}

function nod() {
  actor.classList.remove('nod');
  requestAnimationFrame(() => { if (active) actor.classList.add('nod'); });
}

function acknowledgeWait(phrase, reply) {
  heard.textContent = `聞き取った声　${phrase}`;
  heard.hidden = false;
  status.textContent = '相手が待っています。準備ができたら話してください。';
  speakFollowUp(reply, 'wait');
}

function cancelNudge() {
  clearTimeout(nudgeTimer);
  nudgeTimer = undefined;
  nudgeRequest?.abort();
  nudgeRequest = undefined;
}

function scheduleNudge() {
  if (nudgeTimer || nudgeRequest || nudges >= 2 || !active || !acceptsSpeech() || speaking || recordingSpeech || replyRequest) return;
  nudgeTimer = setTimeout(() => { nudgeTimer = undefined; void nudgeVisitor(); }, nudges === 0 ? 10000 : 17000);
}

function speakFollowUp(reply, kind = phase) {
  const options = followUps[kind === 'water' && target === 'tree' ? 'tree' : kind];
  const fresh = (line) => typeof line === 'string' && line.trim() && normalizeSpeech(line) !== 'goahead'
    && !recentLines.some((previous) => normalizeSpeech(previous) === normalizeSpeech(line));
  const next = fresh(reply) ? reply : options.find(fresh) || options.find((line) => line !== recentLines.at(-1));
  promptText(next);
}

async function requestDialogue(data, signal) {
  const response = await fetch('/api/island/interrupt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, characterId: character.id, pointedObject: target, recent: recentLines.slice(-4) }),
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function nudgeVisitor() {
  if (!active || !acceptsSpeech() || speaking || recordingSpeech || replyRequest || nudges >= 2) return;
  const controller = new AbortController();
  const currentPhase = phase;
  nudgeRequest = controller;
  let reply;
  try { ({ reply } = await requestDialogue({ phase, event: 'silence' }, controller.signal)); }
  catch { /* Use a short line for the current scene if the model is unavailable. */ }
  if (nudgeRequest !== controller || !active || phase !== currentPhase) return;
  nudgeRequest = undefined;
  nudges++;
  speakFollowUp(reply);
}

async function routeSpeechTurn(text, turn) {
  if (!active || phase !== turn.phase || audioTurn !== turn.audioTurn) return;
  const phrase = text.trim();
  const key = normalizeSpeech(phrase);
  const isPlayback = turn.playback && normalizeSpeech(turn.playback).includes(key);
  if (phase === 'lesson') {
    if ((turn.lessonTarget === undefined || turn.lessonTarget === lessonTarget) && key && !isPlayback && acceptsSpeech() && !speaking) receiveLessonSpeech(phrase);
    return;
  }
  if (key && !isPlayback && turn.gesture === 'self' && (phase === 'name' || canCorrectName())) {
    if (phase !== 'name') {
      nameCorrection = { phase, candidate };
      advance('name', null);
    }
    const name = phrase.replace(/^(?:(?:私|わたし|僕|ぼく)[、,。\s]+|me[、,.:\s]+|I\s*[、,.:]\s*)/iu, '').trim();
    applySpeechResult(name);
    if (phase === 'name') speakForPhase();
    return;
  }
  if (key && !isPlayback && turn.gesture === 'partner') {
    cancelNudge();
    cancelReply();
    pointing = undefined;
    heard.textContent = `聞き取った声　${phrase}`;
    heard.hidden = false;
    status.textContent = `相手役が自分を指しています。`;
    pose('intro');
    promptText();
    return;
  }
  if (addressesCharacter(key) && key !== normalizeSpeech(turn.playback || '')) {
    cancelReply();
    acknowledgeAddress(phrase);
    return;
  }
  if (!key || isPlayback) return;
  if (isBackchannel(key)) { if (turn.playback) nod(); return; }
  if (!acceptsSpeech()) return;
  cancelNudge();
  cancelReply();
  if (phase === 'practice') {
    if (memory.water && key === normalizeSpeech(memory.water)) advance('practice-confirm');
    else { pose('point-water'); promptText(); }
    return;
  }
  const controller = new AbortController();
  replyRequest = controller;
  const aiStartedAt = performance.now();
  let intent;
  let reply;
  try {
    ({ intent, reply } = await requestDialogue({ phase: turn.phase, utterance: phrase.slice(0, 400), duringPlayback: Boolean(turn.playback) }, controller.signal));
  } catch { /* Keep the current question when the classifier is unavailable. */ }
  if (replyRequest !== controller || !active || phase !== turn.phase || audioTurn !== turn.audioTurn) return;
  replyRequest = undefined;
  if (turn.transcribedAt && intent !== 'acknowledge') nextTiming = { ...turn, aiStartedAt, aiFinishedAt: performance.now() };

  if (intent === 'acknowledge') nod();
  else if (intent === 'wait') acknowledgeWait(phrase, reply);
  else if (intent === 'address') acknowledgeAddress(phrase);
  else if (intent === 'answer') {
    if (speaking) { stopAudio(); pose('listening'); }
    applySpeechResult(phrase);
  } else {
    heard.textContent = `聞き取った声　${phrase}`;
    heard.hidden = false;
    status.textContent = intent === 'unclear'
      ? '相手が待っています。準備ができたら話してください。'
      : 'WindowsのAIに接続できず、発話の意図を確認できませんでした。';
    speakFollowUp(reply);
  }
}

function sayShared(concept) {
  const text = concept === 'name' || concept === 'water' ? memory[concept] : '';
  speakActor(text);
}

function speakActor(text, language, onFinish) {
  const lang = language || (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(text) ? 'ja-JP' : 'en-US');

  stopAudio();
  if (!active || !text) return;
  const turn = audioTurn;
  const timing = nextTiming;
  nextTiming = undefined;
  if (lang === 'en-US' && hearsSpeech()) {
    recentLines.push(text);
    if (recentLines.length > 8) recentLines.shift();
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  if (lang === character.locale) {
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang === lang);
    const voice = voices[character.voiceSlot] || voices[0];
    if (voice) utterance.voice = voice;
  }
  utterance.rate = 0.85;
  if (timing) utterance.onstart = () => {
    if (!active || turn !== audioTurn) return;
    const seconds = (ms) => `${(ms / 1000).toFixed(1)}秒`;
    const total = seconds(performance.now() - timing.speechEndedAt);
    const recognitionTime = seconds(timing.transcribedAt - timing.uploadedAt);
    const aiTime = seconds(timing.aiFinishedAt - timing.aiStartedAt);
    replyTiming.textContent = `返事まで ${total}（NASの音声認識 ${recognitionTime}、WindowsのAI ${aiTime}）`;
    replyTiming.hidden = false;
  };
  speaking = text;
  actor.classList.add('speaking');
  let finished = false;
  let watchdog;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(watchdog);
    if (turn !== audioTurn) return;
    speaking = '';
    actor.classList.remove('speaking');
    if (onFinish) { onFinish(); return; }
    if (phase === 'lesson') {
      renderLesson();
      if (acceptsSpeech()) {
        status.textContent = speechMode.value === 'whisper' ? '「録音する」を押してから話してください。' : '今、話してください。';
        if (speechMode.value === 'whisper') void whisperSpeech.ensureListening();
        else refreshRecognition();
      }
    }
    if (active && acceptsSpeech()) actor.classList.add('listening');
    scheduleNudge();
  };
  utterance.onend = finish;
  utterance.onerror = finish;
  const synthesis = window.speechSynthesis;
  synthesis.speak(utterance);
  if (phase === 'lesson' && !finished) {
    // Some mobile sessions finish playback without delivering the utterance event.
    watchdog = setInterval(() => {
      if (turn !== audioTurn || (!synthesis.speaking && !synthesis.pending)) finish();
    }, 750);
  }
}

// Generated replies and unconfirmed transcriptions cannot enter the actor's speech.
function promptText() {
  spoken.textContent = '';
  spoken.hidden = true;
  stopAudio();
}

function speakShared(concept) {
  sayShared(concept);
  spoken.textContent = memory[concept];
  spoken.hidden = !memory[concept];
}

function showPhase() {
  element('placementLesson').hidden = phase !== 'lesson';
  element('openPlacement').hidden = phase === 'lesson';
  if (phase === 'lesson') {
    element('start').hidden = true;
    renderLesson();
  }
  const grove = !['name', 'name-confirm'].includes(phase);
  scene.dataset.phase = phase;
  scene.classList.toggle('grove', grove);
  element('place').textContent = grove ? '林の入口' : '浜辺';
  for (const id of ['water', 'tree']) {
    element(id).hidden = !grove || phase === 'lesson';
    element(id).setAttribute('aria-pressed', String(id === target));
  }
  element('water').dataset.indicated = String(['water', 'check'].includes(phase) && target === 'water');
  confirm.hidden = !waitingForGesture();
  showCameraStatus();
  helpText.hidden = true;
  pose(phase === 'name' ? 'intro' : element('water').dataset.indicated === 'true' ? 'point-water' : phase === 'check' ? 'point' : 'beckon');
  if (phase === 'done') pose('offer-water', 'happy');
  status.textContent = {
    lesson: '水・空のコップ・置き場所を指して、言葉を教えましょう。',
    name: '相手が自分を指しています。自分を指して名前を伝えましょう。',
    'name-confirm': '名前は合っていますか？',
    water: '相手が指したものを、あなたの言葉で教えましょう。',
    check: '指されたものと聞き取った言葉が合っていれば、うなずいてください。',
    recall: '相手が何を探しているか、指さして答えましょう。',
    practice: '覚えた言葉で相手に水を頼みましょう。水をタップすると言葉を教え直せます。',
    'practice-confirm': '聞き取った声を確認できます。合っていればうなずき、言い直したければ首を横に振ってください。',
    done: '相手が水を渡しました。水をタップすると言葉を教え直せます。',
  }[phase];
}

function advance(next, reply) {
  cancelReply();
  replySource.hidden = true;
  gestureOrigin = undefined;
  gesturePeak = undefined;
  pointing = undefined;
  phase = next;
  nudges = 0;
  showPhase();
  refreshRecognition();
  if (reply === null) promptText();
  else speakForPhase();
}

function speakForPhase() {
  if (['recall', 'practice-confirm'].includes(phase)) speakShared('water');
  else promptText();
}

function askAboutWater() {
  target = 'water';
  advance('water');
}

function refreshRecognition() {
  clearTimeout(restart);
  if (recognition) {
    const previous = recognition;
    recognition = undefined;
    previous.abort();
  }
  restart = setTimeout(listen, 200);
}

function listen() {
  if (!active || speechMode.value === 'whisper' || recognition || !hearsSpeech()) return;
  if (!SpeechRecognition) {
    status.textContent = 'このブラウザでは音声認識できません。iPhoneのSafariで開いてください。';
    return;
  }
  const current = new SpeechRecognition();
  recognition = current;
  current.lang = ['water', 'lesson'].includes(phase) || (phase === 'name' && nameLanguage.value === 'ja') ? 'ja-JP' : 'en-US';
  current.continuous = true;
  current.interimResults = true;
  let overlappingTurn;
  let gesture;
  current.onresult = (event) => {
    if (!active || recognition !== current) return;
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const phrase = result[0].transcript.trim();
      if (!phrase) continue;
      const key = normalizeSpeech(phrase);
      const playbackKey = normalizeSpeech(speaking);
      if (!key || (speaking && playbackKey.includes(key) && (playbackKey === key || !addressesCharacter(key)))) {
        if (result.isFinal && overlappingTurn) {
          resumeAfterWhisper(overlappingTurn);
          overlappingTurn = undefined;
        }
        continue;
      }
      gesture ||= recentPointing();
      cancelNudge();
      if (speaking && !overlappingTurn) overlappingTurn = { phase, audioTurn, playback: speaking };
      if (overlappingTurn && key.length >= 12) pauseForWhisper(overlappingTurn);
      if (!result.isFinal) continue;
      const turn = overlappingTurn || { phase, audioTurn };
      overlappingTurn = undefined;
      turn.gesture = gesture;
      gesture = undefined;
      void routeSpeechTurn(phrase, turn).finally(() => { resumeAfterWhisper(turn); scheduleNudge(); });
      break;
    }
  };
  current.onerror = (event) => {
    if (recognition !== current || event.error === 'aborted' || event.error === 'no-speech') return;
    status.textContent = `音声認識を開始できませんでした（${event.error}）。マイクの設定を確認してください。`;
    if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) recognition = undefined;
  };
  current.onend = () => {
    if (recognition !== current) return;
    recognition = undefined;
    scheduleNudge();
    if (active) restart = setTimeout(listen, 260);
  };
  try { current.start(); } catch { recognition = undefined; status.textContent = '音声認識を開始できませんでした。会話を一時停止して再開してください。'; }
}

function applySpeechResult(phrase) {
  if (!phrase) return;
  heard.textContent = `聞き取った声　${phrase}`;
  heard.hidden = false;
  if (phase === 'name') {
    candidate = phrase.replace(/^(?:(?:my name is|i am|i['’]m)\s+|(?:私|わたし)の名前は\s*)/iu, '')
      .replace(/[.!?。！？]+$/u, '').trim().replace(/(?:と申します|といいます|です)$/u, '').trim().slice(0, 80);
    if (!candidate) return;
    nameReview.value = candidate;
    phase = 'name-confirm';
    confirm.hidden = false;
    showCameraStatus();
    status.textContent = '名前が合っていれば ✓ を押してください。違う場合は入力欄で直すか、✕を押して言い直せます。';
    promptText();
    refreshRecognition();
  } else if (phase === 'water' && target) {
    candidate = phrase.replace(/[.!?。！？]+$/u, '').trim().slice(0, 80);
    if (candidate) advance('check');
  } else if (phase === 'water') {
    status.textContent = 'どの物の名前か、画面で指さしてもう一度教えてください。';
  }
}

function cancelReply() {
  replyRequest?.abort();
  replyRequest = undefined;
}

function answer(yes) {
  if (!waitingForGesture()) return;
  gestureOrigin = undefined;
  gesturePeak = undefined;
  if (phase === 'lesson') {
    const wasRequest = placement.pending.target === 'request';
    placement.answer(yes);
    promptText();
    renderLesson();
    refreshRecognition();
    status.textContent = yes ? '意味を共有しました。' : 'もう一度、指して言い直せます。';
    if (yes && wasRequest) {
      lessonTarget = undefined;
      element('lessonTable').dataset.water = 'true';
    }
    return;
  }
  if (phase === 'practice-confirm') {
    if (yes) {
      advance('done');
      status.textContent = '相手の聞き返しに答えて、水を頼めました。';
    } else {
      advance('practice');
    }
    return;
  }
  if (phase === 'name-confirm') {
    const correctedName = nameReview.value.trim();
    if (yes && !correctedName) { status.textContent = '相手に教える名前を入力してください。'; return; }
    if (!yes) {
      advance('name');
      return;
    }
    memory.name = correctedName;
    if (nameCorrection) {
      const previous = nameCorrection;
      nameCorrection = undefined;
      candidate = previous.candidate;
      advance(previous.phase);
    } else if (memory.water) advance('recall');
    else askAboutWater();
    return;
  }
  if (yes && target === 'water') {
    memory.water = candidate;
    target = '';
    element('export').disabled = false;
    advance('recall');
  } else {
    askAboutWater();
  }
}

function trackGesture(matrix, time) {
  const yaw = Math.atan2(matrix[2], matrix[10]);
  const pitch = Math.atan2(matrix[6], matrix[10]);
  if (!gestureOrigin) { gestureOrigin = { yaw, pitch }; }
  const horizontal = Math.abs(yaw - gestureOrigin.yaw);
  const vertical = Math.abs(pitch - gestureOrigin.pitch);
  if (gesturePeak) {
    if (time - gesturePeak.time > 1800) {
      gesturePeak = undefined;
      gestureOrigin = undefined;
    } else if (horizontal < 0.085 && vertical < 0.085) {
      answer(gesturePeak.yes);
      return;
    } else {
      showCameraStatus('首の動きを検出しました。正面に戻してください。');
      return;
    }
  }
  if (horizontal > 0.13 && horizontal > vertical * 1.25) gesturePeak = { yes: false, time };
  if (vertical > 0.13 && vertical > horizontal * 1.25) gesturePeak = { yes: true, time };
  showCameraStatus('顔を検出しました。うなずくか、首を横に振ってください。');
}

function pointingDirection(points) {
  if (!points) return undefined;
  const [left, right] = [points[11], points[12]];
  if (left.visibility < 0.6 || right.visibility < 0.6) return undefined;
  const width = Math.abs(left.x - right.x);
  if (width < 0.05) return undefined;
  const x = (left.x + right.x) / 2;
  const y = (left.y + right.y) / 2 + width * 0.38;
  const distance = (point) => Math.hypot(point.x - x, point.y - y);
  const shoulderDepth = (left.z + right.z) / 2;
  const directions = new Set();
  for (const [wristId, indexId] of [[15, 19], [16, 20]]) {
    const wrist = points[wristId];
    const index = points[indexId];
    if (wrist.visibility < 0.6 || index.visibility < 0.6) continue;
    const forward = shoulderDepth - wrist.z;
    const fingerDepth = wrist.z - index.z;
    const fingerScreen = Math.hypot(index.x - wrist.x, index.y - wrist.y);
    if (forward > width * 0.65 && fingerDepth > Math.max(width * 0.06, fingerScreen * 0.8)) {
      directions.add('partner');
    } else if (forward < width * 0.4 && distance(index) < width * 0.48
      && distance(wrist) - distance(index) > width * 0.09) {
      directions.add('self');
    }
  }
  return directions.size === 1 ? directions.values().next().value : undefined;
}

async function startCamera() {
  const run = ++cameraRun;
  let stream;
  let cameraStep = 'カメラを起動できませんでした。Safariのカメラ許可を確認してください。';
  cameraStatus = 'カメラを起動しています。';
  showCameraStatus();
  const fail = (error) => {
    if (run !== cameraRun) return;
    stream?.getTracks().forEach((track) => track.stop());
    cameraStream = undefined;
    camera.srcObject = null;
    cameraStatus = cameraStep;
    media.textContent = `${cameraStatus}${error?.name ? `（${error.name}）` : ''}`;
    showCameraStatus();
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: false });
    if (!active || run !== cameraRun) { stream.getTracks().forEach((track) => track.stop()); return; }
    cameraStream = stream;
    camera.srcObject = stream;
    showCameraStatus();
    await camera.play();
    if (!active || run !== cameraRun) return;
    cameraStep = '顔認識のデータを読み込めませんでした。接続を確認して再開してください。';
    cameraStatus = '顔認識のデータを読み込んでいます。';
    showCameraStatus();
    if (!landmarker) {
      const base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
      const { FaceLandmarker, FilesetResolver } = await import(`${base}/vision_bundle.mjs`);
      landmarker = await FaceLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(`${base}/wasm`), {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task' },
        runningMode: 'VIDEO', numFaces: 1, outputFacialTransformationMatrixes: true,
      });
    }
    if (!active || run !== cameraRun) return;
    cameraStep = '顔の動きを判定できませんでした。一時停止して再開してください。';
    cameraStatus = '顔をカメラに向けてください。';
    showCameraStatus();
    media.textContent = 'カメラは確認時の首の動きを端末内で判定します。音声認識にはブラウザの機能を使います。';
    if (!poseLandmarker) {
      const base = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21';
      void (async () => {
        const { PoseLandmarker, FilesetResolver } = await import(`${base}/vision_bundle.mjs`);
        poseLandmarker = await PoseLandmarker.createFromOptions(await FilesetResolver.forVisionTasks(`${base}/wasm`), {
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
          runningMode: 'VIDEO',
        });
      })().catch(() => {
        if (active && run === cameraRun) media.textContent = '自分を指さす判定を読み込めませんでした。';
      });
    }
    let lastPoseFrame = 0;
    let pointingFrames = 0;
    let previousDirection;
    let previous = -1;
    let lastFrame = 0;
    const loop = (time) => {
      if (!active || run !== cameraRun) return;
      if (waitingForGesture() && document.activeElement !== nameReview && time - lastFrame >= 55 && camera.readyState >= 2 && camera.currentTime !== previous) {
        previous = camera.currentTime;
        lastFrame = time;
        try {
          const matrix = landmarker.detectForVideo(camera, time).facialTransformationMatrixes[0]?.data;
          if (matrix?.length === 16) trackGesture(matrix, time);
          else {
            gestureOrigin = undefined;
            gesturePeak = undefined;
            showCameraStatus();
          }
        } catch (error) { fail(error); return; }
      } else if (!waitingForGesture() || document.activeElement === nameReview) {
        gestureOrigin = undefined;
        gesturePeak = undefined;
      }
      if (poseLandmarker && phase !== 'name-confirm' && camera.readyState >= 2 && time - lastPoseFrame >= 150) {
        lastPoseFrame = time;
        try {
          const direction = pointingDirection(poseLandmarker.detectForVideo(camera, time).landmarks[0]);
          pointingFrames = direction && direction === previousDirection ? pointingFrames + 1 : direction ? 1 : 0;
          previousDirection = direction;
          if (pointingFrames >= 2) {
            const wasListening = hearsSpeech();
            pointing = { kind: direction, until: time + 2000 };
            if (!wasListening) listen();
          }
        } catch {
          pointingFrames = 0;
        }
      } else if (phase === 'name-confirm') {
        pointingFrames = 0;
      }
      renderFrame = requestAnimationFrame(loop);
    };
    renderFrame = requestAnimationFrame(loop);
  } catch (error) { fail(error); }
}

function setActive(enabled) {
  active = enabled;
  speechMode.disabled = active;
  characterChoice.disabled = active;
  nameLanguage.disabled = active;
  bargeIn.disabled = active;
  speechStatus.hidden = true;
  replyTiming.hidden = true;
  nextTiming = undefined;
  element('controls').hidden = false;
  element('start').hidden = true;
  element('pause').textContent = active ? '一時停止' : '再開';
  element('help').disabled = !active;
  element('repeat').disabled = !active;
  if (active) {
    if (speechMode.value === 'whisper') void whisperSpeech.start();
    if (phase === 'name-confirm') {
      confirm.hidden = false;
      showCameraStatus();
      status.textContent = '合っていればうなずくか ✓、違う場合は首を横に振るか ✕ で答えてください。';
      promptText();
    } else {
      showPhase();
      speakForPhase();
    }
    if (phase === 'name' && speechMode.value === 'whisper') status.textContent = '名前だけを話してください。';
    listen();
    void startCamera();
  } else {
    pointing = undefined;
    whisperSpeech.stop();
    recordingSpeech = false;
    cancelReply();
    replySource.hidden = true;
    stopAudio();
    refreshRecognition();
    cameraRun++;
    cancelAnimationFrame(renderFrame);
    cameraStream?.getTracks().forEach((track) => track.stop());
    camera.srcObject = null;
    cameraStream = undefined;
    confirm.hidden = true;
    showCameraStatus();
    pose();
    media.textContent = '一時停止中です。';
    status.textContent = '一時停止中';
  }
}

function showCharacter() {
  actor.setAttribute('aria-label', character.label);
  actor.style.setProperty('--outfit', character.outfit);
  actor.style.setProperty('--hair', character.hair);
}

for (const profile of characters) {
  const option = document.createElement('option');
  option.value = profile.id;
  option.textContent = profile.label;
  characterChoice.append(option);
}
characterChoice.value = character.id;
showCharacter();
characterChoice.onchange = () => {
  const next = findCharacter(characterChoice.value);
  if (active || !next || next === character) return;
  if (phase === 'lesson') {
    character = next;
    showCharacter();
    return;
  }
  savedScenes.set(character.id, { memory, phase, target, candidate, nameCorrection, review: nameReview.value });
  character = next;
  const saved = savedScenes.get(character.id);
  memory = saved?.memory || { name: '', water: '' };
  phase = saved?.phase || 'name';
  target = saved?.target || '';
  candidate = saved?.candidate || '';
  nameCorrection = saved?.nameCorrection;
  nameReview.value = saved?.review || '';
  recentLines.length = 0;
  nudges = 0;
  heard.hidden = true;
  spoken.hidden = true;
  element('export').disabled = !memory.water;
  showCharacter();
  showPhase();
  status.textContent = saved ? `${character.label}との続きから始められます。` : `${character.label}と出会う浜辺から始めます。`;
};

function renderLesson() {
  const record = element('recordLesson');
  record.hidden = speechMode.value !== 'whisper';
  const capturing = whisperSpeech.isRecording();
  record.disabled = !active || !acceptsSpeech() || Boolean(speaking) || (recordingSpeech && !capturing);
  record.textContent = capturing ? '録音を止める' : '録音する';
  element('resumeLessonMic').disabled = !active || !acceptsSpeech();
  element('listenExample').disabled = !active || lessonQuiz || !Object.hasOwn(examples, lessonTarget) || Boolean(placement.pending);
  element('proposePlacement').disabled = !active || lessonQuiz || Boolean(placement.pending) || !Object.keys(examples).every(key => placement.agreed[key]);
  element('askPlacement').disabled = !active || !placement.request || Boolean(placement.pending);
  element('placementChoices').hidden = !lessonQuiz;
  for (const button of element('lessonObjects').querySelectorAll('button')) {
    button.disabled = !active || lessonQuiz;
    button.setAttribute('aria-pressed', String(button.dataset.target === lessonTarget));
  }
  showCameraStatus();
}

function receiveLessonSpeech(phrase) {
  heard.textContent = `聞き取った声　${phrase}`;
  heard.hidden = false;
  if (lessonTarget === 'request') placement.propose(phrase);
  else placement.hear(lessonTarget, phrase, exampleRequested);
  if (!placement.pending) {
    status.textContent = '水と置き場所の言葉を使って、もう一度頼んでください。';
    return;
  }
  pose(lessonTarget === 'water' || lessonTarget === 'request' ? 'point-water' : 'point');
  if (lessonTarget === 'request') {
    element('lessonMove').textContent = '相手役が水を持ち上げ、指定の台に置こうとしています。';
  } else if (exampleRequested) {
    const target = lessonTarget;
    const attempt = placement.pending;
    // Keep the bilingual confirmation inside the user-requested audio exchange.
    speakActor(examples[target], 'en-US', () => speakActor(attempt.text, 'ja-JP'));
  }
  status.textContent = '指した対象と聞き取った表現が合っていれば ✓、違えば ✕。';
  renderLesson();
}

element('openPlacement').onclick = () => {
  if (phase === 'lesson') return;
  if (!active) { phase = 'lesson'; setActive(true); }
  else advance('lesson');
};

element('lessonObjects').onclick = ({ target: button }) => {
  if (!active || lessonQuiz || recordingSpeech || !Object.hasOwn(examples, button.dataset.target)) return;
  placement.answer(false);
  promptText();
  lessonTarget = button.dataset.target;
  exampleRequested = false;
  element('lessonTable').dataset.water = 'false';
  element('lessonMove').textContent = '';
  pose(lessonTarget === 'water' ? 'point-water' : 'point');
  status.textContent = '指したものをあなたの言葉で伝えてください。英語の音も聞けます。';
  renderLesson();
  refreshRecognition();
};
element('listenExample').onclick = () => {
  if (!active || lessonQuiz || recordingSpeech || placement.pending || !Object.hasOwn(examples, lessonTarget)) return;
  exampleRequested = true;
  speakActor(examples[lessonTarget], 'en-US');
};
element('recordLesson').onclick = async () => {
  if (!active || !acceptsSpeech() || speaking) return;
  if (whisperSpeech.isRecording()) { whisperSpeech.finishManual(); return; }
  if (recordingSpeech) return;
  element('recordLesson').disabled = true;
  await whisperSpeech.beginManual();
  renderLesson();
};
element('resumeLessonMic').onclick = () => {
  if (!active || !acceptsSpeech()) return;
  stopAudio();
  recordingSpeech = false;
  status.textContent = 'マイクの準備ができたら、もう一度話してください。';
  if (speechMode.value === 'whisper') void whisperSpeech.start();
  else {
    refreshRecognition();
    listen();
  }
};
element('proposePlacement').onclick = () => {
  if (!active || lessonQuiz || recordingSpeech || placement.pending) return;
  lessonTarget = 'request';
  element('lessonMove').textContent = '';
  status.textContent = '水と台を指すつもりで、覚えた言葉を組み合わせて頼んでください。';
  renderLesson();
  refreshRecognition();
};
element('askPlacement').onclick = () => {
  if (!active || recordingSpeech || !placement.request || placement.pending) return;
  lessonQuiz = true;
  lessonHint = false;
  const form = element('placementChoices');
  form.reset();
  element('lessonTable').dataset.water = 'false';
  element('lessonTable').dataset.hint = 'false';
  element('lessonMove').textContent = '';
  pose();
  speakActor(placement.request);
  status.textContent = '聞こえたお願いに合わせて、物・場所・動作を選んでください。';
  renderLesson();
};
element('placementHint').onclick = () => {
  if (!active || !lessonQuiz) return;
  lessonHint = true;
  pose('point-water');
  element('lessonTable').dataset.hint = 'true';
  element('lessonMove').textContent = '相手役が水を指し、手で台の上に置く動作を示しています。';
};
element('placementChoices').onsubmit = (event) => {
  event.preventDefault();
  if (!active || !lessonQuiz || speaking) return;
  const choices = new FormData(event.target);
  const result = placement.perform(choices.get('object'), choices.get('location'), choices.get('action'), lessonHint);
  if (result.object && result.location && result.action) {
    lessonQuiz = false;
    lessonTarget = undefined;
    element('lessonTable').dataset.water = 'true';
    element('lessonMove').textContent = '水を台に置きました。';
    pose('happy');
  } else {
    element('lessonMove').textContent = '相手役が待っています。もう一度選べます。';
  }
  renderLesson();
};

element('start').onclick = () => setActive(true);
element('pause').onclick = () => setActive(!active);
element('yes').onclick = () => answer(true);
element('no').onclick = () => answer(false);
element('help').onclick = () => {
  const text = phase === 'name' ? '自分を指して、名前を伝えてください。'
    : hints[phase] || '相手があなたの名前を確認しています。';
  helpText.textContent = text;
  helpText.hidden = false;
};
element('repeat').onclick = () => { if (['recall', 'practice-confirm'].includes(phase)) speakShared('water'); };
for (const id of ['water', 'tree']) {
  element(id).onclick = () => {
    if (!active) return;
    if (phase === 'recall' && id === 'water') advance('practice');
    else if (phase === 'recall') { pose('point-water'); speakShared('water'); }
    else if (id === 'water' && ['practice', 'done'].includes(phase)) {
      memory.water = '';
      element('export').disabled = true;
      askAboutWater();
    } else if (phase === 'water') {
      target = id;
      showPhase();
      pose('point', 'listening');
      status.textContent = '指した物の名前を声で教えてください。';
    }
  };
}
element('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ version: 1, characterId: character.id, ...memory }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `island-memory-${character.locale}-${character.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
element('import').onclick = () => element('file').click();
element('file').onchange = async ({ target: input }) => {
  const file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 4096) throw new Error('File too large');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || typeof data.name !== 'string' || typeof data.water !== 'string') throw new Error('Invalid memory');
    if ((data.characterId ?? defaultCharacter.id) !== character.id) {
      status.textContent = '別の相手役の記憶ファイルです。相手役を選び直してから読み込んでください。';
      input.value = '';
      return;
    }
    if (data.water) nameCorrection = undefined;
    memory = { name: data.name.slice(0, 80), water: data.water.slice(0, 80) };
    element('export').disabled = !memory.water;
    if (memory.water && active) advance('recall');
    if (memory.water && !active) phase = 'recall';
    status.textContent = '相手役の記憶を読み込みました。';
  } catch { status.textContent = 'このファイルを読み込めませんでした。'; }
  input.value = '';
};
document.addEventListener('visibilitychange', () => { if (document.hidden && active) setActive(false); });
