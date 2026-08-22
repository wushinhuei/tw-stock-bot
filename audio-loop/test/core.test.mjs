import test from "node:test";
import assert from "node:assert/strict";
import {
  formatTime,
  parseTime,
  getCrossfadeSeconds,
  hasMp3Signature,
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

test("MP3 validation accepts ID3 and MPEG frame headers", () => {
  assert.equal(hasMp3Signature(Uint8Array.from([0x49, 0x44, 0x33]).buffer), true);
  assert.equal(hasMp3Signature(Uint8Array.from([0xff, 0xfb, 0x90]).buffer), true);
  assert.equal(hasMp3Signature(Uint8Array.from([0x52, 0x49, 0x46]).buffer), false);
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
