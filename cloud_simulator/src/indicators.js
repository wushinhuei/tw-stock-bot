'use strict';

function finite(values) { return values.map(Number).filter(Number.isFinite); }
function last(values) { return values.length ? values[values.length - 1] : null; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }

function sma(values, period) {
  const rows = finite(values);
  if (rows.length < period) return null;
  return rows.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function emaSeries(values, period) {
  const rows = finite(values);
  if (!rows.length) return [];
  const factor = 2 / (period + 1);
  const out = [rows[0]];
  for (let i = 1; i < rows.length; i += 1) out.push(rows[i] * factor + out[i - 1] * (1 - factor));
  return out;
}

function rsi(values, period = 14) {
  const rows = finite(values);
  if (rows.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = rows.length - period; i < rows.length; i += 1) {
    const change = rows[i] - rows[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  if (!losses) return 100;
  return 100 - (100 / (1 + gains / losses));
}

function macd(values) {
  const rows = finite(values);
  if (rows.length < 26) return { value: null, signal: null, histogram: null };
  const fast = emaSeries(rows, 12);
  const slow = emaSeries(rows, 26);
  const line = rows.map((_, i) => fast[i] - slow[i]);
  const signal = emaSeries(line, 9);
  return { value: last(line), signal: last(signal), histogram: last(line) - last(signal) };
}

function atr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length <= period) return null;
  const ranges = [];
  for (let i = 1; i < bars.length; i += 1) {
    const high = Number(bars[i].high);
    const low = Number(bars[i].low);
    const prev = Number(bars[i - 1].close);
    ranges.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  return sma(ranges, period);
}

function obvSeries(bars) {
  if (!Array.isArray(bars) || !bars.length) return [];
  const out = [0];
  for (let i = 1; i < bars.length; i += 1) {
    const close = Number(bars[i].close);
    const previous = Number(bars[i - 1].close);
    const volume = Number(bars[i].volume || 0);
    out.push(out[i - 1] + (close > previous ? volume : close < previous ? -volume : 0));
  }
  return out;
}

function analyzeObv(bars, maPeriod = 42, breakoutPeriod = 20) {
  const values = obvSeries(bars);
  const current = last(values);
  const ma = sma(values, maPeriod);
  const previousMa = values.length > maPeriod ? sma(values.slice(0, -1), maPeriod) : null;
  const priorBars = bars.slice(-(breakoutPeriod + 1), -1);
  const priorPriceHigh = priorBars.length ? Math.max(...priorBars.map(row => Number(row.close))) : null;
  const priorObvHigh = values.length > breakoutPeriod ? Math.max(...values.slice(-(breakoutPeriod + 1), -1)) : null;
  const priceBreakout = priorPriceHigh != null && Number(last(bars).close) > priorPriceHigh;
  const obvBreakout = priorObvHigh != null && current > priorObvHigh;
  const rising = values.length >= 6 && current > values[values.length - 6];
  return {
    value: current,
    ma42: ma,
    aboveMa42: ma != null && current > ma,
    risingMa42: ma != null && previousMa != null && ma >= previousMa,
    rising,
    priceBreakout,
    obvBreakout,
    breakoutConfirmed: priceBreakout && obvBreakout,
    bullish: ma != null && current > ma && rising,
    topDivergence: priceBreakout && !obvBreakout
  };
}

function vwap(bars) {
  let volume = 0;
  let value = 0;
  for (const bar of bars || []) {
    const rowVolume = Number(bar.volume || 0);
    const typical = (Number(bar.high) + Number(bar.low) + Number(bar.close)) / 3;
    volume += rowVolume;
    value += typical * rowVolume;
  }
  return volume ? value / volume : null;
}

module.exports = { analyzeObv, atr, clamp, emaSeries, macd, obvSeries, rsi, sma, vwap };
