export const MIN_SEGMENT_SECONDS = 3;
export const MAX_PLAY_SECONDS = 4 * 60 * 60;
export const SUPPORTED_AUDIO_EXTENSIONS = Object.freeze(["mp3", "wav", "m4a", "aac", "ogg", "oga", "flac", "webm"]);

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function formatTime(seconds, tenths = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const secText = tenths ? secs.toFixed(1).padStart(4, "0") : Math.floor(secs).toString().padStart(2, "0");
  return hours > 0
    ? `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secText}`
    : `${minutes.toString().padStart(2, "0")}:${secText}`;
}

export function parseTime(value) {
  const parts = String(value).trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export function getCrossfadeSeconds(segmentDuration) {
  return Math.min(3, Math.max(0.15, segmentDuration * 0.18));
}

export function getFileExtension(filename) {
  const match = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function isSupportedAudioFile(file) {
  if (!file) return false;
  const extension = getFileExtension(file.name);
  return SUPPORTED_AUDIO_EXTENSIONS.includes(extension) || String(file.type).startsWith("audio/");
}

export function estimateMp3Bytes(seconds, bitrateKbps = 192) {
  return Math.ceil(Math.max(0, Number(seconds) || 0) * bitrateKbps * 1000 / 8);
}

export function buildLoopUnitFilter({ start, end, crossfade }) {
  const safeStart = Number(start).toFixed(3);
  const safeEnd = Number(end).toFixed(3);
  const safeCrossfade = Number(crossfade).toFixed(3);
  return `[0:a]atrim=start=${safeStart}:end=${safeEnd},asetpts=PTS-STARTPTS,asplit=2[body][head];`
    + `[head]atrim=end=${safeCrossfade},asetpts=PTS-STARTPTS[loophead];`
    + `[body]atrim=start=${safeCrossfade},asetpts=PTS-STARTPTS[looptail];`
    + `[looptail][loophead]acrossfade=d=${safeCrossfade}:c1=tri:c2=tri[loop]`;
}

export function makeOutputFilename(filename) {
  const extension = getFileExtension(filename);
  const original = String(filename);
  const base = (extension ? original.slice(0, -(extension.length + 1)) : original)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim() || "audio";
  return `${base}_seamless_loop.mp3`;
}

export function validateSelection(start, end, audioDuration) {
  const safeStart = clamp(start, 0, audioDuration);
  const safeEnd = clamp(end, 0, audioDuration);
  if (safeEnd - safeStart < MIN_SEGMENT_SECONDS) {
    throw new Error(`循環片段至少需要 ${MIN_SEGMENT_SECONDS} 秒。`);
  }
  return { start: safeStart, end: safeEnd, duration: safeEnd - safeStart };
}

export function getPlaybackSeconds(hours, minutes, seconds) {
  const total = Math.floor(clamp(hours, 0, 4)) * 3600
    + Math.floor(clamp(minutes, 0, 59)) * 60
    + Math.floor(clamp(seconds, 0, 59));
  if (total <= 0) throw new Error("播放時間至少需要 1 秒。")
  if (total > MAX_PLAY_SECONDS) throw new Error("播放時間最長為 4 小時。")
  return total;
}

export function scheduleWindow({ nextStart, now, horizon, sessionEnd, segmentDuration, crossfade }) {
  const events = [];
  const stride = segmentDuration - crossfade;
  let cursor = nextStart;
  while (cursor < Math.min(horizon, sessionEnd)) {
    const duration = Math.min(segmentDuration, sessionEnd - cursor);
    if (duration > 0) {
      events.push({
        startAt: cursor,
        duration,
        fadeIn: cursor > now,
        hasNext: cursor + stride < sessionEnd,
      });
    }
    cursor += stride;
  }
  return { events, nextStart: cursor };
}
