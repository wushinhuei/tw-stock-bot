export const MIN_SEGMENT_SECONDS = 3;
export const MAX_PLAY_SECONDS = 4 * 60 * 60;

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

export function hasMp3Signature(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer, 0, Math.min(arrayBuffer.byteLength, 3));
  if (bytes.length < 2) return false;
  if (bytes.length >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  const versionBits = (bytes[1] >> 3) & 0x03;
  const layerBits = (bytes[1] >> 1) & 0x03;
  return bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && versionBits !== 0x01 && layerBits !== 0;
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
