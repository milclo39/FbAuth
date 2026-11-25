import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const FFMPEG_CORE_BASE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const FFMPEG_WORKER_CDN_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js';

const els = {
  protocolWarning: document.getElementById('protocolWarning'),
  statusBadge: document.getElementById('statusBadge'),
  modeBadge: document.getElementById('modeBadge'),
  audioBadge: document.getElementById('audioBadge'),

  previewVideo: document.getElementById('previewVideo'),
  previewPlaceholder: document.getElementById('previewPlaceholder'),
  recOverlay: document.getElementById('recOverlay'),
  recTimer: document.getElementById('recTimer'),

  audioMeterFill: document.getElementById('audioMeterFill'),
  audioMeterText: document.getElementById('audioMeterText'),

  toggleCameraBtn: document.getElementById('toggleCameraBtn'),
  startRecordBtn: document.getElementById('startRecordBtn'),
  stopRecordBtn: document.getElementById('stopRecordBtn'),
  mirrorToggle: document.getElementById('mirrorToggle'),

  recordModeRadios: document.querySelectorAll('input[name="recordMode"]'),
  audioEnabledRadios: document.querySelectorAll('input[name="audioEnabled"]'),
  videoSource: document.getElementById('videoSource'),
  audioSource: document.getElementById('audioSource'),
  resolutionSelect: document.getElementById('resolutionSelect'),

  ffmpegStatusText: document.getElementById('ffmpegStatusText'),
  preloadFfmpegBtn: document.getElementById('preloadFfmpegBtn'),

  conversionBox: document.getElementById('conversionBox'),
  conversionMessage: document.getElementById('conversionMessage'),
  conversionPercent: document.getElementById('conversionPercent'),
  conversionProgressBar: document.getElementById('conversionProgressBar'),

  playbackVideo: document.getElementById('playbackVideo'),
  playbackPlaceholder: document.getElementById('playbackPlaceholder'),
  downloadBtn: document.getElementById('downloadBtn'),

  metaFormat: document.getElementById('metaFormat'),
  metaAudio: document.getElementById('metaAudio'),
  metaSize: document.getElementById('metaSize'),
  metaDuration: document.getElementById('metaDuration'),
  metaConvertTime: document.getElementById('metaConvertTime'),
  metaMime: document.getElementById('metaMime'),

  historyList: document.getElementById('historyList'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),

  logOutput: document.getElementById('logOutput'),
  clearLogBtn: document.getElementById('clearLogBtn'),
};

const state = {
  stream: null,
  recorder: null,
  isRecording: false,
  isConverting: false,
  recordStartedAt: 0,
  timerIntervalId: null,

  audioCtx: null,
  analyser: null,
  meterRafId: null,

  ffmpeg: null,
  ffmpegLoaded: false,
  ffmpegLoadingPromise: null,
  classWorkerURL: null,

  history: [],
  activeHistoryId: null,
};

function log(message, level = 'INFO') {
  const now = new Date();
  const ts = now.toTimeString().slice(0, 8);
  const line = `[${ts}] [${level}] ${message}`;
  els.logOutput.textContent += (els.logOutput.textContent ? '\n' : '') + line;
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function getSelectedRecordMode() {
  const checked = document.querySelector('input[name="recordMode"]:checked');
  return checked ? checked.value : 'webm';
}

function isAudioEnabled() {
  const checked = document.querySelector('input[name="audioEnabled"]:checked');
  return checked ? checked.value === 'on' : true;
}

function setAppStatus(kind, text) {
  els.statusBadge.className = `status-badge status-${kind}`;
  els.statusBadge.textContent = text;
}

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const sec = String(totalSec % 60).padStart(2, '0');
  return `${min}:${sec}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function updateModeBadges() {
  const mode = getSelectedRecordMode();
  const audioOn = isAudioEnabled();

  els.modeBadge.textContent = mode === 'mp4' ? 'FFmpeg併用 (MP4)' : 'RecordRTCのみ (WebM)';
  els.audioBadge.textContent = audioOn ? '音声あり' : '音声なし';
  els.audioBadge.className = audioOn ? 'pill pill-accent' : 'pill pill-muted';

  els.audioSource.disabled = !audioOn || state.isRecording || state.isConverting;
}

function updateControlLocks() {
  const busy = state.isRecording || state.isConverting;
  const hasCamera = Boolean(state.stream);

  els.toggleCameraBtn.textContent = hasCamera ? 'カメラ停止' : 'カメラ開始';
  els.toggleCameraBtn.disabled = busy;

  els.startRecordBtn.disabled = !hasCamera || busy;
  els.stopRecordBtn.disabled = !state.isRecording;

  for (const radio of els.recordModeRadios) {
    radio.disabled = busy;
  }
  for (const radio of els.audioEnabledRadios) {
    radio.disabled = busy;
  }

  els.videoSource.disabled = busy;
  els.audioSource.disabled = busy || !isAudioEnabled();
  els.resolutionSelect.disabled = busy;
  els.preloadFfmpegBtn.disabled = state.ffmpegLoaded || Boolean(state.ffmpegLoadingPromise) || state.isConverting;
}

function applyMirrorState() {
  els.previewVideo.classList.toggle('mirrored', els.mirrorToggle.checked);
}

async function populateDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    log('navigator.mediaDevices.enumerateDevices が利用できません。', 'WARN');
    return;
  }

  const prevVideo = els.videoSource.value;
  const prevAudio = els.audioSource.value;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const videoDevices = devices.filter((d) => d.kind === 'videoinput');
  const audioDevices = devices.filter((d) => d.kind === 'audioinput');

  els.videoSource.innerHTML = '';
  if (videoDevices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'カメラが見つかりません';
    els.videoSource.appendChild(opt);
  } else {
    videoDevices.forEach((device, idx) => {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      opt.textContent = device.label || `カメラ ${idx + 1}`;
      els.videoSource.appendChild(opt);
    });
    if (prevVideo && videoDevices.some((d) => d.deviceId === prevVideo)) {
      els.videoSource.value = prevVideo;
    }
  }

  els.audioSource.innerHTML = '';
  if (audioDevices.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'マイクが見つかりません';
    els.audioSource.appendChild(opt);
  } else {
    audioDevices.forEach((device, idx) => {
      const opt = document.createElement('option');
      opt.value = device.deviceId;
      opt.textContent = device.label || `マイク ${idx + 1}`;
      els.audioSource.appendChild(opt);
    });
    if (prevAudio && audioDevices.some((d) => d.deviceId === prevAudio)) {
      els.audioSource.value = prevAudio;
    }
  }
}

function stopAudioMeter() {
  if (state.meterRafId) {
    cancelAnimationFrame(state.meterRafId);
    state.meterRafId = null;
  }
  if (state.audioCtx) {
    state.audioCtx.close().catch(() => {});
    state.audioCtx = null;
    state.analyser = null;
  }
  els.audioMeterFill.style.width = '0%';
  els.audioMeterText.textContent = isAudioEnabled() ? '停止中' : '音声なし';
}

function startAudioMeter(stream) {
  stopAudioMeter();

  const audioTracks = stream.getAudioTracks();
  if (!isAudioEnabled() || audioTracks.length === 0) {
    els.audioMeterText.textContent = '音声なし';
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    els.audioMeterText.textContent = '非対応';
    return;
  }

  const audioCtx = new AudioContextClass();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }

  const source = audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  state.audioCtx = audioCtx;
  state.analyser = analyser;

  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  const tick = () => {
    if (!state.analyser) return;
    state.analyser.getByteTimeDomainData(dataArray);
    let peak = 0;
    for (let i = 0; i < dataArray.length; i += 1) {
      const v = Math.abs(dataArray[i] - 128) / 128;
      if (v > peak) peak = v;
    }
    const percent = Math.min(100, Math.round(peak * 180));
    els.audioMeterFill.style.width = `${percent}%`;
    els.audioMeterText.textContent = `${percent}%`;
    state.meterRafId = requestAnimationFrame(tick);
  };

  state.meterRafId = requestAnimationFrame(tick);
}

function buildMediaConstraints() {
  const videoId = els.videoSource.value;
  const audioId = els.audioSource.value;
  const res = els.resolutionSelect.value;

  const videoConstraint = {};
  if (videoId) {
    videoConstraint.deviceId = { exact: videoId };
  }
  if (res !== 'default') {
    const [w, h] = res.split('x').map(Number);
    if (w && h) {
      videoConstraint.width = { ideal: w };
      videoConstraint.height = { ideal: h };
    }
  }

  let audioConstraint = false;
  if (isAudioEnabled()) {
    audioConstraint = audioId ? { deviceId: { exact: audioId } } : true;
  }

  return {
    video: Object.keys(videoConstraint).length > 0 ? videoConstraint : true,
    audio: audioConstraint,
  };
}

function stopCamera() {
  stopAudioMeter();
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
  els.previewVideo.srcObject = null;
  els.previewPlaceholder.classList.remove('hidden');
  setAppStatus('idle', '待機中');
  updateControlLocks();
  log('カメラを停止しました。');
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const msg = 'getUserMedia がサポートされていないか、安全なコンテキスト (http://localhost / https://) ではありません。';
    log(msg, 'ERROR');
    alert(msg);
    return;
  }

  // 既存ストリームがあれば先に解放
  if (state.stream) {
    stopCamera();
  }

  const constraints = buildMediaConstraints();
  log(`カメラ起動中: ${JSON.stringify(constraints)}`);

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.stream = stream;
    els.previewVideo.srcObject = stream;
    els.previewPlaceholder.classList.add('hidden');

    await populateDevices();

    const vTrack = stream.getVideoTracks()[0];
    const aTrack = stream.getAudioTracks()[0];
    if (vTrack) {
      els.videoSource.value = vTrack.getSettings().deviceId || els.videoSource.value;
      const s = vTrack.getSettings();
      log(`映像トラック有効: ${vTrack.label} (${s.width || '?'}x${s.height || '?'} @ ${s.frameRate ? Math.round(s.frameRate) : '?'}fps)`);
    }
    if (aTrack) {
      els.audioSource.value = aTrack.getSettings().deviceId || els.audioSource.value;
      log(`音声トラック有効: ${aTrack.label}`);
    } else {
      log('音声トラックなし (映像のみ)');
    }

    startAudioMeter(stream);
    setAppStatus('preview', 'プレビュー中');
    updateControlLocks();
  } catch (err) {
    log(`カメラ/マイク取得エラー: ${err.name} - ${err.message}`, 'ERROR');
    alert(`カメラまたはマイクの取得に失敗しました:\n${err.name}: ${err.message}`);
    setAppStatus('idle', '待機中');
    updateControlLocks();
  }
}

function pickSupportedWebMMimeType(hasAudio) {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'video/webm';
  }
  const candidates = hasAudio
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm'];

  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

async function ensureFFmpegLoaded() {
  if (state.ffmpegLoaded && state.ffmpeg) {
    return state.ffmpeg;
  }
  if (state.ffmpegLoadingPromise) {
    return state.ffmpegLoadingPromise;
  }

  state.ffmpegLoadingPromise = (async () => {
    const startMs = performance.now();
    els.ffmpegStatusText.textContent = '読込中 (初回はWASM約31MBを取得)...';
    updateControlLocks();
    log('FFmpeg.wasm を読み込んでいます...');

    const ffmpeg = new FFmpeg();
    ffmpeg.on('log', ({ message }) => {
      if (message && !message.startsWith('frame=')) {
        log(`[FFmpeg] ${message}`);
      }
    });
    ffmpeg.on('progress', ({ progress }) => {
      if (!state.isConverting) return;
      if (Number.isFinite(progress) && progress >= 0 && progress <= 1) {
        const pct = Math.round(progress * 100);
        els.conversionProgressBar.style.width = `${pct}%`;
        els.conversionPercent.textContent = `${pct}%`;
      }
    });

    // CDN上のworker.jsは相対importを含むため、同一オリジンBlobモジュール経由で読み込む
    if (!state.classWorkerURL) {
      const workerBootstrap = new Blob(
        [`import "${FFMPEG_WORKER_CDN_URL}";`],
        { type: 'text/javascript' }
      );
      state.classWorkerURL = URL.createObjectURL(workerBootstrap);
    }

    const coreURL = await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, 'application/wasm');

    await ffmpeg.load({
      coreURL,
      wasmURL,
      classWorkerURL: state.classWorkerURL,
    });

    state.ffmpeg = ffmpeg;
    state.ffmpegLoaded = true;
    const elapsedSec = ((performance.now() - startMs) / 1000).toFixed(2);
    els.ffmpegStatusText.textContent = `読込済み (${elapsedSec}秒)`;
    log(`FFmpeg.wasm 読込完了 (${elapsedSec}秒)`);
    return ffmpeg;
  })();

  try {
    return await state.ffmpegLoadingPromise;
  } catch (err) {
    state.ffmpegLoaded = false;
    state.ffmpeg = null;
    els.ffmpegStatusText.textContent = '読込失敗 (ログを確認してください)';
    throw err;
  } finally {
    state.ffmpegLoadingPromise = null;
    updateControlLocks();
  }
}

async function convertWebmToMp4(webmBlob, hasAudio) {
  state.isConverting = true;
  setAppStatus('converting', 'MP4変換中');
  updateControlLocks();

  els.conversionBox.classList.remove('hidden');
  els.conversionMessage.textContent = 'FFmpeg.wasm 準備中...';
  els.conversionProgressBar.style.width = '5%';
  els.conversionPercent.textContent = '...';

  const convertStart = performance.now();
  const ffmpeg = await ensureFFmpegLoaded();

  const inputName = 'input.webm';
  const outputName = 'output.mp4';

  try {
    els.conversionMessage.textContent = 'FFmpegでMP4へ変換中...';
    els.conversionProgressBar.style.width = '15%';
    await ffmpeg.writeFile(inputName, await fetchFile(webmBlob));

    const args = [
      '-i', inputName,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
    ];

    if (hasAudio) {
      args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-an');
    }

    args.push('-movflags', '+faststart', outputName);

    log(`FFmpeg実行: ffmpeg ${args.join(' ')}`);
    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      throw new Error(`FFmpegが終了コード ${exitCode} で終了しました。`);
    }

    const data = await ffmpeg.readFile(outputName);
    els.conversionProgressBar.style.width = '100%';
    els.conversionPercent.textContent = '100%';

    const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });
    const convertMs = performance.now() - convertStart;
    log(`MP4変換完了: ${formatBytes(mp4Blob.size)} (${(convertMs / 1000).toFixed(2)}秒)`);
    return { blob: mp4Blob, convertMs };
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
    state.isConverting = false;
    els.conversionBox.classList.add('hidden');
    setAppStatus(state.stream ? 'preview' : 'idle', state.stream ? 'プレビュー中' : '待機中');
    updateControlLocks();
  }
}

function startRecording() {
  if (!state.stream) {
    alert('先にカメラを開始してください。');
    return;
  }
  if (typeof window.RecordRTC !== 'function') {
    const msg = 'RecordRTC が読み込まれていません。ネットワーク接続を確認してください。';
    log(msg, 'ERROR');
    alert(msg);
    return;
  }

  const mode = getSelectedRecordMode();
  const hasAudio = state.stream.getAudioTracks().length > 0;
  const mimeType = pickSupportedWebMMimeType(hasAudio);

  log(`録画開始: 方式=${mode.toUpperCase()}, 音声=${hasAudio ? 'あり' : 'なし'}, RecordRTC mimeType=${mimeType}`);

  const recorder = new window.RecordRTC(state.stream, {
    type: 'video',
    mimeType,
    disableLogs: true,
  });

  recorder.startRecording();
  state.recorder = recorder;
  state.isRecording = true;
  state.recordStartedAt = performance.now();

  els.recTimer.textContent = '00:00';
  els.recOverlay.classList.remove('hidden');
  setAppStatus('recording', '録画中');
  updateControlLocks();

  state.timerIntervalId = setInterval(() => {
    els.recTimer.textContent = formatDuration(performance.now() - state.recordStartedAt);
  }, 250);
}

function stopRecording() {
  if (!state.recorder || !state.isRecording) return;

  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
  els.recOverlay.classList.add('hidden');

  const recorder = state.recorder;
  const durationMs = performance.now() - state.recordStartedAt;
  const mode = getSelectedRecordMode();
  const hasAudio = state.stream ? state.stream.getAudioTracks().length > 0 : isAudioEnabled();

  state.isRecording = false;
  state.recorder = null;
  updateControlLocks();

  recorder.stopRecording(async () => {
    try {
      const webmBlob = recorder.getBlob();
      const rawMime = webmBlob.type || 'video/webm';
      log(`RecordRTC停止: ${formatBytes(webmBlob.size)} (${rawMime}, ${(durationMs / 1000).toFixed(2)}秒)`);

      let finalBlob = webmBlob;
      let ext = 'webm';
      let formatLabel = 'RecordRTC (WebM)';
      let convertMs = null;

      if (mode === 'mp4') {
        const result = await convertWebmToMp4(webmBlob, hasAudio);
        finalBlob = result.blob;
        ext = 'mp4';
        formatLabel = 'FFmpeg (MP4)';
        convertMs = result.convertMs;
      } else {
        setAppStatus(state.stream ? 'preview' : 'idle', state.stream ? 'プレビュー中' : '待機中');
      }

      addRecordingToHistory({
        blob: finalBlob,
        ext,
        formatLabel,
        hasAudio,
        durationMs,
        convertMs,
        mimeType: finalBlob.type || (ext === 'mp4' ? 'video/mp4' : 'video/webm'),
      });
    } catch (err) {
      log(`録画/変換処理エラー: ${err.message}`, 'ERROR');
      alert(`録画またはMP4変換中にエラーが発生しました:\n${err.message}`);
      setAppStatus(state.stream ? 'preview' : 'idle', state.stream ? 'プレビュー中' : '待機中');
    } finally {
      try {
        recorder.destroy();
      } catch {
        // ignore cleanup error
      }
      updateControlLocks();
    }
  });
}

function addRecordingToHistory(entry) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const audioTag = entry.hasAudio ? 'audio' : 'noaudio';
  const filename = `recording_${timestamp}_${audioTag}.${entry.ext}`;
  const url = URL.createObjectURL(entry.blob);

  const item = {
    id,
    filename,
    url,
    ...entry,
  };

  state.history.unshift(item);
  selectHistoryItem(id);
  renderHistoryList();
}

function selectHistoryItem(id) {
  const item = state.history.find((h) => h.id === id);
  if (!item) return;

  state.activeHistoryId = id;
  els.playbackVideo.src = item.url;
  els.playbackPlaceholder.classList.add('hidden');
  els.downloadBtn.disabled = false;

  els.metaFormat.textContent = item.formatLabel;
  els.metaAudio.textContent = item.hasAudio ? 'あり' : 'なし';
  els.metaSize.textContent = formatBytes(item.blob.size);
  els.metaDuration.textContent = `${(item.durationMs / 1000).toFixed(2)} 秒`;
  els.metaConvertTime.textContent = item.convertMs != null ? `${(item.convertMs / 1000).toFixed(2)} 秒` : 'なし (直接出力)';
  els.metaMime.textContent = item.mimeType;

  renderHistoryList();
}

function triggerDownload(item) {
  const a = document.createElement('a');
  a.href = item.url;
  a.download = item.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  log(`ダウンロード開始: ${item.filename} (${formatBytes(item.blob.size)})`);
}

function renderHistoryList() {
  els.clearHistoryBtn.disabled = state.history.length === 0;
  els.historyList.innerHTML = '';

  if (state.history.length === 0) {
    const li = document.createElement('li');
    li.className = 'history-empty';
    li.textContent = 'まだ録画はありません。';
    els.historyList.appendChild(li);
    return;
  }

  for (const item of state.history) {
    const li = document.createElement('li');
    li.className = `history-item ${item.id === state.activeHistoryId ? 'active' : ''}`;

    const info = document.createElement('div');
    info.className = 'history-item-info';

    const title = document.createElement('span');
    title.className = 'history-item-title';
    title.textContent = `${item.formatLabel} / ${item.hasAudio ? '音声あり' : '音声なし'}`;

    const sub = document.createElement('span');
    sub.className = 'history-item-sub';
    const convText = item.convertMs != null ? ` / 変換 ${(item.convertMs / 1000).toFixed(1)}s` : '';
    sub.textContent = `${formatBytes(item.blob.size)} / ${(item.durationMs / 1000).toFixed(1)}s${convText}`;

    info.appendChild(title);
    info.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'history-item-actions';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn btn-outline btn-xs';
    playBtn.textContent = '再生';
    playBtn.addEventListener('click', () => selectHistoryItem(item.id));

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn btn-primary btn-xs';
    dlBtn.textContent = '保存';
    dlBtn.addEventListener('click', () => triggerDownload(item));

    actions.appendChild(playBtn);
    actions.appendChild(dlBtn);

    li.appendChild(info);
    li.appendChild(actions);
    els.historyList.appendChild(li);
  }
}

function clearHistory() {
  for (const item of state.history) {
    URL.revokeObjectURL(item.url);
  }
  state.history = [];
  state.activeHistoryId = null;

  els.playbackVideo.removeAttribute('src');
  els.playbackVideo.load();
  els.playbackPlaceholder.classList.remove('hidden');
  els.downloadBtn.disabled = true;

  els.metaFormat.textContent = '-';
  els.metaAudio.textContent = '-';
  els.metaSize.textContent = '-';
  els.metaDuration.textContent = '-';
  els.metaConvertTime.textContent = '-';
  els.metaMime.textContent = '-';

  renderHistoryList();
  log('録画履歴をクリアしました。');
}

function initEventListeners() {
  els.toggleCameraBtn.addEventListener('click', () => {
    if (state.stream) {
      stopCamera();
    } else {
      startCamera();
    }
  });

  els.startRecordBtn.addEventListener('click', startRecording);
  els.stopRecordBtn.addEventListener('click', stopRecording);
  els.mirrorToggle.addEventListener('change', applyMirrorState);

  for (const radio of els.recordModeRadios) {
    radio.addEventListener('change', () => {
      updateModeBadges();
      log(`録画方式を切り替えました: ${getSelectedRecordMode() === 'mp4' ? 'RecordRTC + FFmpeg (MP4)' : 'RecordRTCのみ (WebM)'}`);
    });
  }

  for (const radio of els.audioEnabledRadios) {
    radio.addEventListener('change', async () => {
      updateModeBadges();
      log(`音声設定を切り替えました: ${isAudioEnabled() ? '音声あり' : '音声なし'}`);
      if (state.stream && !state.isRecording) {
        await startCamera();
      }
    });
  }

  const restartIfActive = async () => {
    if (state.stream && !state.isRecording) {
      await startCamera();
    }
  };
  els.videoSource.addEventListener('change', restartIfActive);
  els.audioSource.addEventListener('change', restartIfActive);
  els.resolutionSelect.addEventListener('change', restartIfActive);

  els.preloadFfmpegBtn.addEventListener('click', async () => {
    try {
      await ensureFFmpegLoaded();
    } catch (err) {
      log(`FFmpeg事前読込失敗: ${err.message}`, 'ERROR');
      alert(`FFmpeg.wasm の読み込みに失敗しました:\n${err.message}`);
    }
  });

  els.downloadBtn.addEventListener('click', () => {
    const item = state.history.find((h) => h.id === state.activeHistoryId);
    if (item) {
      triggerDownload(item);
    }
  });

  els.clearHistoryBtn.addEventListener('click', clearHistory);
  els.clearLogBtn.addEventListener('click', () => {
    els.logOutput.textContent = '';
  });

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      populateDevices().catch(() => {});
    });
  }
}

async function init() {
  if (window.location.protocol === 'file:') {
    els.protocolWarning.classList.remove('hidden');
    log('file:// で開かれています。http://localhost 経由での実行を推奨します。', 'WARN');
  }

  applyMirrorState();
  updateModeBadges();
  updateControlLocks();
  initEventListeners();

  try {
    await populateDevices();
  } catch (err) {
    log(`デバイス列挙エラー: ${err.message}`, 'WARN');
  }

  log('アプリ準備完了。「カメラ開始」を押してプレビューを開始してください。');
}

init();
