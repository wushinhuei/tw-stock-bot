import {
  MIN_SEGMENT_SECONDS,
  clamp,
  formatTime,
  parseTime,
  getCrossfadeSeconds,
  getFileExtension,
  isSupportedAudioFile,
  estimateMp3Bytes,
  buildLoopUnitFilter,
  makeOutputFilename,
  validateSelection,
  getPlaybackSeconds,
  scheduleWindow,
} from "./core.mjs";
import { FFmpeg } from "./vendor/ffmpeg/index.js";
import { fetchFile, toBlobURL } from "./vendor/util/index.js";

const FFMPEG_CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

const $ = (selector) => document.querySelector(selector);
const elements = {
  file: $("#audio-file"), drop: $("#drop-zone"), fileCard: $("#file-card"), editor: $("#editor"),
  fileName: $("#file-name"), fileMeta: $("#file-meta"), replace: $("#replace-file"),
  canvas: $("#waveform"), startRange: $("#loop-start"), endRange: $("#loop-end"), fill: $("#range-fill"),
  startTime: $("#start-time"), endTime: $("#end-time"), segmentDuration: $("#segment-duration"),
  hours: $("#hours"), minutes: $("#minutes"), seconds: $("#seconds"),
  play: $("#play"), playLabel: $("#play-label"), status: $("#status"), remaining: $("#remaining"),
  progress: $("#progress-bar"), message: $("#message"),
  export: $("#export"), exportLabel: $("#export-label"), exportEstimate: $("#export-estimate"),
  exportProgress: $("#export-progress"), exportProgressBar: $("#export-progress-bar"),
};

let audioContext;
let audioBuffer;
let sourceFile;
let activeSession;
let waveformPeaks = [];
let ffmpeg;
let ffmpegLoading;
let exportPhase = { base: 0, size: 0 };

function setMessage(text = "") { elements.message.textContent = text; }

function ensureContext() {
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  return audioContext;
}

async function loadFile(file) {
  stopPlayback();
  setMessage("");
  if (!isSupportedAudioFile(file)) {
    setMessage("請選擇常見音訊格式，例如 MP3、WAV、M4A、AAC、OGG、FLAC 或 WebM。");
    elements.file.value = "";
    return;
  }

  elements.drop.querySelector(".drop-title").textContent = "正在讀取音檔…";
  try {
    const data = await file.arrayBuffer();
    audioBuffer = await ensureContext().decodeAudioData(data.slice(0));
    if (audioBuffer.duration < MIN_SEGMENT_SECONDS) throw new Error(`音檔長度必須至少 ${MIN_SEGMENT_SECONDS} 秒。`);
    waveformPeaks = makePeaks(audioBuffer, 720);
    sourceFile = file;
    elements.fileName.textContent = file.name;
    elements.fileMeta.textContent = `${formatBytes(file.size)} · ${formatTime(audioBuffer.duration)}`;
    elements.startRange.max = audioBuffer.duration;
    elements.endRange.max = audioBuffer.duration;
    elements.startRange.value = 0;
    elements.endRange.value = audioBuffer.duration;
    elements.fileCard.hidden = false;
    elements.editor.hidden = false;
    elements.drop.hidden = true;
    updateSelection("load");
  } catch (error) {
    audioBuffer = null;
    sourceFile = null;
    setMessage(error.message || "瀏覽器無法讀取這個音訊格式，請換一個檔案再試。");
  } finally {
    elements.drop.querySelector(".drop-title").textContent = "點一下選擇，或將音檔拖到這裡";
  }
}

function makePeaks(buffer, count) {
  const channel = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(channel.length / count));
  return Array.from({ length: count }, (_, index) => {
    let peak = 0;
    const end = Math.min(channel.length, (index + 1) * block);
    for (let i = index * block; i < end; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
    return peak;
  });
}

function drawWaveform() {
  const canvas = elements.canvas;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!audioBuffer) return;

  const startRatio = Number(elements.startRange.value) / audioBuffer.duration;
  const endRatio = Number(elements.endRange.value) / audioBuffer.duration;
  ctx.fillStyle = "rgba(238, 114, 93, .10)";
  ctx.fillRect(startRatio * rect.width, 0, (endRatio - startRatio) * rect.width, rect.height);
  ctx.strokeStyle = "#8fa099";
  ctx.lineWidth = 1.25;
  const center = rect.height / 2;
  waveformPeaks.forEach((peak, index) => {
    const x = index / waveformPeaks.length * rect.width;
    const height = Math.max(1, peak * rect.height * .72);
    ctx.beginPath();
    ctx.moveTo(x, center - height / 2);
    ctx.lineTo(x, center + height / 2);
    ctx.stroke();
  });
}

function updateSelection(source) {
  if (!audioBuffer) return;
  if (activeSession && source !== "load") stopPlayback();
  let start = Number(elements.startRange.value);
  let end = Number(elements.endRange.value);

  if (source === "start-time") {
    const parsed = parseTime(elements.startTime.value);
    if (parsed === null) return setMessage("開始時間格式不正確，請輸入 mm:ss 或 hh:mm:ss。");
    start = parsed;
  } else if (source === "end-time") {
    const parsed = parseTime(elements.endTime.value);
    if (parsed === null) return setMessage("結束時間格式不正確，請輸入 mm:ss 或 hh:mm:ss。");
    end = parsed;
  }

  if (source === "start" || source === "start-time") start = Math.min(start, end - MIN_SEGMENT_SECONDS);
  if (source === "end" || source === "end-time") end = Math.max(end, start + MIN_SEGMENT_SECONDS);
  start = clamp(start, 0, audioBuffer.duration - MIN_SEGMENT_SECONDS);
  end = clamp(end, start + MIN_SEGMENT_SECONDS, audioBuffer.duration);
  elements.startRange.value = start;
  elements.endRange.value = end;
  elements.startTime.value = formatTime(start);
  elements.endTime.value = formatTime(end);
  elements.segmentDuration.textContent = formatTime(end - start);
  elements.fill.style.left = `${start / audioBuffer.duration * 100}%`;
  elements.fill.style.width = `${(end - start) / audioBuffer.duration * 100}%`;
  setMessage("");
  drawWaveform();
}

function makeCurve(kind, length = 64) {
  return Float32Array.from({ length }, (_, index) => {
    const x = index / (length - 1);
    return kind === "in" ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2);
  });
}

const fadeInCurve = makeCurve("in");
const fadeOutCurve = makeCurve("out");

function scheduleSource(session, event) {
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = audioBuffer;
  source.connect(gain).connect(session.master);
  const fade = Math.min(session.crossfade, event.duration / 2);
  if (event.fadeIn && fade > 0) {
    gain.gain.setValueAtTime(0, event.startAt);
    gain.gain.setValueCurveAtTime(fadeInCurve, event.startAt, fade);
  } else {
    gain.gain.setValueAtTime(1, event.startAt);
  }
  if (event.hasNext && fade > 0) {
    gain.gain.setValueCurveAtTime(fadeOutCurve, event.startAt + event.duration - fade, fade);
  }
  source.start(event.startAt, session.selection.start, event.duration);
  session.sources.add(source);
  source.onended = () => session.sources.delete(source);
}

function fillSchedule(session) {
  const result = scheduleWindow({
    nextStart: session.nextStart,
    now: session.startedAt,
    horizon: audioContext.currentTime + 12,
    sessionEnd: session.endsAt,
    segmentDuration: session.selection.duration,
    crossfade: session.crossfade,
  });
  result.events.forEach((event) => scheduleSource(session, event));
  session.nextStart = result.nextStart;
}

async function startPlayback() {
  try {
    if (!audioBuffer) throw new Error("請先選擇音檔。");
    const selection = validateSelection(elements.startRange.value, elements.endRange.value, audioBuffer.duration);
    const totalSeconds = getPlaybackSeconds(elements.hours.value, elements.minutes.value, elements.seconds.value);
    const context = ensureContext();
    await context.resume();
    const startedAt = context.currentTime + .08;
    const endsAt = startedAt + totalSeconds;
    const master = context.createGain();
    master.connect(context.destination);
    master.gain.setValueAtTime(1, startedAt);
    const tail = Math.min(.08, totalSeconds / 3);
    master.gain.setValueAtTime(1, Math.max(startedAt, endsAt - tail));
    master.gain.linearRampToValueAtTime(0, endsAt);
    activeSession = {
      startedAt, endsAt, master, selection, totalSeconds,
      crossfade: getCrossfadeSeconds(selection.duration), nextStart: startedAt,
      sources: new Set(), scheduler: null, ticker: null,
    };
    fillSchedule(activeSession);
    activeSession.scheduler = window.setInterval(() => activeSession && fillSchedule(activeSession), 2000);
    activeSession.ticker = window.setInterval(updateProgress, 250);
    elements.play.classList.add("is-playing");
    elements.playLabel.textContent = "停止播放";
    elements.status.textContent = "正在無縫播放";
    elements.remaining.textContent = formatTime(totalSeconds, false);
    setMessage("");
  } catch (error) {
    setMessage(error.message || "無法開始播放，請重新設定後再試。");
  }
}

function updateProgress() {
  if (!activeSession) return;
  const elapsed = clamp(audioContext.currentTime - activeSession.startedAt, 0, activeSession.totalSeconds);
  const remaining = Math.max(0, activeSession.totalSeconds - elapsed);
  elements.progress.style.width = `${elapsed / activeSession.totalSeconds * 100}%`;
  elements.remaining.textContent = formatTime(remaining, false);
  if (audioContext.currentTime >= activeSession.endsAt) stopPlayback(true);
}

function stopPlayback(completed = false) {
  if (activeSession) {
    clearInterval(activeSession.scheduler);
    clearInterval(activeSession.ticker);
    activeSession.sources.forEach((source) => { try { source.stop(); } catch {} });
    try { activeSession.master.disconnect(); } catch {}
    activeSession = null;
  }
  elements.play.classList.remove("is-playing");
  elements.playLabel.textContent = "開始無縫播放";
  elements.status.textContent = completed ? "播放完成" : "準備完成";
  if (completed) elements.progress.style.width = "100%";
  else elements.progress.style.width = "0%";
  try {
    const total = getPlaybackSeconds(elements.hours.value, elements.minutes.value, elements.seconds.value);
    elements.remaining.textContent = formatTime(total, false);
  } catch {
    elements.remaining.textContent = "00:00";
  }
}

function setExportProgress(percent, label) {
  const safePercent = clamp(percent, 0, 100);
  elements.exportProgress.hidden = false;
  elements.exportProgressBar.style.width = `${safePercent}%`;
  if (label) elements.exportLabel.textContent = label;
}

function updateExportEstimate() {
  try {
    const total = getPlaybackSeconds(elements.hours.value, elements.minutes.value, elements.seconds.value);
    elements.exportEstimate.textContent = `預估檔案大小約 ${formatBytes(estimateMp3Bytes(total))}`;
  } catch {
    elements.exportEstimate.textContent = "請先設定有效的播放時間";
  }
}

function setExportBusy(isBusy) {
  elements.export.disabled = isBusy;
  elements.export.classList.toggle("is-working", isBusy);
  [
    elements.file, elements.replace, elements.play, elements.startRange, elements.endRange,
    elements.startTime, elements.endTime, elements.hours, elements.minutes, elements.seconds,
  ].forEach((control) => { control.disabled = isBusy; });
}

async function ensureFfmpeg() {
  if (ffmpeg?.loaded) return ffmpeg;
  if (ffmpegLoading) return ffmpegLoading;

  ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) => {
    const normalized = clamp(progress, 0, 1);
    setExportProgress(exportPhase.base + normalized * exportPhase.size);
  });
  ffmpegLoading = (async () => {
    setExportProgress(3, "載入轉檔元件…");
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });
    setExportProgress(12, "準備音檔…");
    return ffmpeg;
  })();

  try {
    return await ffmpegLoading;
  } catch (error) {
    ffmpeg?.terminate();
    ffmpeg = null;
    throw error;
  } finally {
    ffmpegLoading = null;
  }
}

async function exportMp3() {
  const filesToDelete = [];
  stopPlayback();
  setMessage("");
  setExportBusy(true);

  try {
    if (!sourceFile || !audioBuffer) throw new Error("請先選擇音檔。");
    const selection = validateSelection(elements.startRange.value, elements.endRange.value, audioBuffer.duration);
    const totalSeconds = getPlaybackSeconds(elements.hours.value, elements.minutes.value, elements.seconds.value);
    const crossfade = getCrossfadeSeconds(selection.duration);
    const engine = await ensureFfmpeg();
    const jobId = Date.now().toString(36);
    const inputExtension = getFileExtension(sourceFile.name) || "audio";
    const inputPath = `input-${jobId}.${inputExtension}`;
    const cyclePath = `cycle-${jobId}.wav`;
    const outputPath = `output-${jobId}.mp3`;
    filesToDelete.push(inputPath, cyclePath, outputPath);

    await engine.writeFile(inputPath, await fetchFile(sourceFile));
    exportPhase = { base: 15, size: 30 };
    setExportProgress(15, "製作無縫循環片段…");
    const cycleResult = await engine.exec([
      "-i", inputPath,
      "-filter_complex", buildLoopUnitFilter({ ...selection, crossfade }),
      "-map", "[loop]", "-vn", "-ar", "44100", "-ac", "2",
      "-c:a", "pcm_s16le", cyclePath,
    ]);
    if (cycleResult !== 0) throw new Error("無縫片段製作失敗，請換一個音檔再試。");

    const tail = Math.min(.08, totalSeconds / 3);
    const fadeStart = Math.max(0, totalSeconds - tail);
    exportPhase = { base: 45, size: 52 };
    setExportProgress(45, "轉換為 MP3…");
    const encodeResult = await engine.exec([
      "-stream_loop", "-1", "-i", cyclePath,
      "-t", totalSeconds.toFixed(3),
      "-af", `afade=t=out:st=${fadeStart.toFixed(3)}:d=${tail.toFixed(3)}`,
      "-c:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      outputPath,
    ]);
    if (encodeResult !== 0) throw new Error("MP3 轉檔失敗，請縮短播放時間後再試。");

    const data = await engine.readFile(outputPath);
    const blob = new Blob([data.buffer], { type: "audio/mpeg" });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = makeOutputFilename(sourceFile.name);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
    setExportProgress(100, "MP3 已下載");
    setMessage(`完成：${anchor.download}（${formatBytes(blob.size)}）`);
  } catch (error) {
    elements.exportProgress.hidden = true;
    elements.exportProgressBar.style.width = "0%";
    setMessage(error.message || "轉檔失敗，請稍後再試。");
  } finally {
    if (ffmpeg?.loaded) {
      await Promise.all(filesToDelete.map((path) => ffmpeg.deleteFile(path).catch(() => {})));
    }
    setExportBusy(false);
    if (elements.exportLabel.textContent !== "MP3 已下載") elements.exportLabel.textContent = "產生並下載 MP3";
  }
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

elements.file.addEventListener("change", () => loadFile(elements.file.files[0]));
elements.replace.addEventListener("click", () => elements.file.click());
elements.startRange.addEventListener("input", () => updateSelection("start"));
elements.endRange.addEventListener("input", () => updateSelection("end"));
elements.startTime.addEventListener("change", () => updateSelection("start-time"));
elements.endTime.addEventListener("change", () => updateSelection("end-time"));
elements.play.addEventListener("click", () => activeSession ? stopPlayback() : startPlayback());
elements.export.addEventListener("click", exportMp3);
[elements.hours, elements.minutes, elements.seconds].forEach((input) => input.addEventListener("change", () => {
  stopPlayback();
  updateExportEstimate();
}));

for (const eventName of ["dragenter", "dragover"]) {
  elements.drop.addEventListener(eventName, (event) => { event.preventDefault(); elements.drop.classList.add("is-over"); });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.drop.addEventListener(eventName, (event) => { event.preventDefault(); elements.drop.classList.remove("is-over"); });
}
elements.drop.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
window.addEventListener("resize", drawWaveform);
window.addEventListener("beforeunload", () => stopPlayback());

stopPlayback();
updateExportEstimate();
