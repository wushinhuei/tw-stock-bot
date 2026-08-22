import test from "node:test";
import assert from "node:assert/strict";
import {
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
} from "../core.mjs";

test("formatTime formats short and hour-long values", () => {
  assert.equal(formatTime(65.24), "01:05.2");
  assert.equal(formatTime(3665, false), "01:01:05");
});

test("parseTime accepts common time formats and rejects invalid seconds", () => {
  assert.equal(parseTime("01:05.5"), 65.5);
  assert.equal(parseTime("1:02:03"), 3723);
  assert.equal(parseTime("1:75"), null);
});

test("selection must be at least three seconds", () => {
  assert.deepEqual(validateSelection(2, 8, 10), { start: 2, end: 8, duration: 6 });
  assert.throws(() => validateSelection(2, 4, 10), /至少需要 3 秒/);
});

test("playback time is bounded to four hours", () => {
  assert.equal(getPlaybackSeconds(1, 2, 3), 3723);
  assert.throws(() => getPlaybackSeconds(0, 0, 0), /至少需要 1 秒/);
});

test("crossfade is automatic and capped at three seconds", () => {
  assert.equal(getCrossfadeSeconds(20), 3);
  assert.ok(Math.abs(getCrossfadeSeconds(5) - .9) < Number.EPSILON);
});

test("common audio uploads are accepted without requiring MP3", () => {
  assert.equal(isSupportedAudioFile({ name: "voice.wav", type: "audio/wav" }), true);
  assert.equal(isSupportedAudioFile({ name: "voice.m4a", type: "" }), true);
  assert.equal(isSupportedAudioFile({ name: "voice.bin", type: "audio/custom" }), true);
  assert.equal(isSupportedAudioFile({ name: "notes.txt", type: "text/plain" }), false);
  assert.equal(getFileExtension("VOICE.FLAC"), "flac");
});

test("MP3 output helpers create a safe name and bitrate estimate", () => {
  assert.equal(makeOutputFilename("練習:版本.wav"), "練習-版本_seamless_loop.mp3");
  assert.equal(makeOutputFilename("recording"), "recording_seamless_loop.mp3");
  assert.equal(estimateMp3Bytes(1800), 43_200_000);
});

test("FFmpeg filter trims the selection and applies triangular crossfade", () => {
  const filter = buildLoopUnitFilter({ start: 4.2, end: 15.5, crossfade: 2 });
  assert.match(filter, /atrim=start=4\.200:end=15\.500/);
  assert.match(filter, /acrossfade=d=2\.000:c1=tri:c2=tri\[loop\]$/);
});

test("scheduler overlaps adjacent segments and stops at session end", () => {
  const result = scheduleWindow({
    nextStart: 100,
    now: 100,
    horizon: 130,
    sessionEnd: 125,
    segmentDuration: 10,
    crossfade: 2,
  });
  assert.deepEqual(result.events.map(({ startAt, duration, hasNext }) => ({ startAt, duration, hasNext })), [
    { startAt: 100, duration: 10, hasNext: true },
    { startAt: 108, duration: 10, hasNext: true },
    { startAt: 116, duration: 9, hasNext: true },
    { startAt: 124, duration: 1, hasNext: false },
  ]);
  assert.equal(result.nextStart, 132);
});
