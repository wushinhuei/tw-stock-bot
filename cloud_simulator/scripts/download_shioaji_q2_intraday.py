#!/usr/bin/env python3
"""Download 2026 Q2 Taiwan stock intraday history for point-in-time replay.

Primary purpose:
- Fill the missing intraday history needed to replay the frozen strategy.
- Preserve 1-minute bars and derive deterministic 5-minute / 15-minute bars.
- Never use future data to create historical signals.

Credentials are read only from environment variables:
  SJ_API_KEY
  SJ_SEC_KEY

The script does NOT place orders and does not activate a CA certificate.
The API key should have Market/Data permission only.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import os
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from zoneinfo import ZoneInfo

try:
    import shioaji as sj
except ImportError as exc:  # pragma: no cover - runtime dependency
    raise SystemExit("Missing dependency: pip install -U shioaji") from exc

TAIPEI = ZoneInfo("Asia/Taipei")
DEFAULT_START = "2026-03-20"
DEFAULT_END = "2026-06-30"
DEFAULT_UNIVERSE = Path("data/backtest/2026Q2/q2_top100_union.json")
DEFAULT_OUTPUT = Path("data/backtest/2026Q2/intraday")


@dataclass(frozen=True)
class Bar:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float
    amount: float | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--universe", default=str(DEFAULT_UNIVERSE))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--start", default=DEFAULT_START)
    parser.add_argument("--end", default=DEFAULT_END)
    parser.add_argument("--sleep", type=float, default=0.25, help="Pause between API calls")
    parser.add_argument("--max-symbols", type=int, default=0, help="0 means all")
    parser.add_argument("--resume", action="store_true", default=True)
    parser.add_argument("--no-resume", action="store_false", dest="resume")
    parser.add_argument("--retry", type=int, default=3)
    return parser.parse_args()


def date_chunks(start: str, end: str, max_days: int = 30) -> list[tuple[str, str]]:
    first = date.fromisoformat(start)
    last = date.fromisoformat(end)
    chunks: list[tuple[str, str]] = []
    cursor = first
    while cursor <= last:
        # Shioaji requires each requested range to be <= 30 days.
        chunk_end = min(last, cursor + timedelta(days=max_days - 1))
        chunks.append((cursor.isoformat(), chunk_end.isoformat()))
        cursor = chunk_end + timedelta(days=1)
    return chunks


def load_symbols(path: Path) -> list[str]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("symbols", [])
    symbols = []
    for row in rows:
        code = str(row.get("symbol", "") if isinstance(row, dict) else row).strip()
        if code.isdigit() and len(code) == 4:
            symbols.append(code)
    return list(dict.fromkeys(symbols))


def timestamp_to_taipei(value) -> datetime:
    if isinstance(value, datetime):
        current = value
        if current.tzinfo is None:
            return current.replace(tzinfo=TAIPEI)
        return current.astimezone(TAIPEI)

    # Shioaji commonly returns nanosecond unix integers for Python Kbars.
    try:
        number = int(value)
        if abs(number) > 10**14:
            seconds = number / 1_000_000_000
        elif abs(number) > 10**11:
            seconds = number / 1_000
        else:
            seconds = number
        return datetime.fromtimestamp(seconds, tz=timezone.utc).astimezone(TAIPEI)
    except (TypeError, ValueError, OverflowError):
        pass

    text = str(value)
    # numpy.datetime64 string form, normally local exchange time in Shioaji examples.
    text = text.replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=TAIPEI)
    return parsed.astimezone(TAIPEI)


def finite(value, fallback=0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback


def bars_from_kbars(kbars) -> list[Bar]:
    timestamps = list(getattr(kbars, "ts", []) or [])
    opens = list(getattr(kbars, "Open", []) or [])
    highs = list(getattr(kbars, "High", []) or [])
    lows = list(getattr(kbars, "Low", []) or [])
    closes = list(getattr(kbars, "Close", []) or [])
    volumes = list(getattr(kbars, "Volume", []) or [])
    amounts = list(getattr(kbars, "Amount", []) or [])
    count = min(len(timestamps), len(opens), len(highs), len(lows), len(closes), len(volumes))
    result: list[Bar] = []
    for index in range(count):
        ts = timestamp_to_taipei(timestamps[index])
        # Normal stock session only. Keep 13:30 auction if present.
        hhmm = ts.hour * 60 + ts.minute
        if hhmm < 9 * 60 or hhmm > 13 * 60 + 30:
            continue
        op = finite(opens[index], float("nan"))
        hi = finite(highs[index], float("nan"))
        lo = finite(lows[index], float("nan"))
        cl = finite(closes[index], float("nan"))
        if not all(math.isfinite(x) and x > 0 for x in (op, hi, lo, cl)):
            continue
        amount = finite(amounts[index], 0.0) if index < len(amounts) else None
        result.append(Bar(ts, op, hi, lo, cl, finite(volumes[index], 0.0), amount))
    return result


def bucket_start(ts: datetime, minutes: int) -> datetime:
    session_start = ts.replace(hour=9, minute=0, second=0, microsecond=0)
    offset = int((ts - session_start).total_seconds() // 60)
    bucket_offset = max(0, (offset // minutes) * minutes)
    return session_start + timedelta(minutes=bucket_offset)


def aggregate(bars: Iterable[Bar], minutes: int) -> list[Bar]:
    grouped: dict[datetime, list[Bar]] = defaultdict(list)
    for bar in bars:
        grouped[bucket_start(bar.timestamp, minutes)].append(bar)
    output: list[Bar] = []
    for key in sorted(grouped):
        rows = sorted(grouped[key], key=lambda item: item.timestamp)
        output.append(Bar(
            key,
            rows[0].open,
            max(row.high for row in rows),
            min(row.low for row in rows),
            rows[-1].close,
            sum(row.volume for row in rows),
            sum((row.amount or 0) for row in rows) if any(row.amount is not None for row in rows) else None,
        ))
    return output


def write_gzip_csv(path: Path, symbol: str, bars: list[Bar], interval: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["symbol", "timestamp", "trade_date", "interval", "open", "high", "low", "close", "volume", "amount"])
        for bar in bars:
            writer.writerow([
                symbol,
                bar.timestamp.isoformat(),
                bar.timestamp.date().isoformat(),
                interval,
                f"{bar.open:.6f}",
                f"{bar.high:.6f}",
                f"{bar.low:.6f}",
                f"{bar.close:.6f}",
                f"{bar.volume:.6f}",
                "" if bar.amount is None else f"{bar.amount:.6f}",
            ])


def fetch_symbol(api, symbol: str, start: str, end: str, retry: int, sleep_seconds: float) -> list[Bar]:
    contract = api.contracts.get(symbol)
    if contract is None:
        raise RuntimeError(f"Shioaji contract not found: {symbol}")
    rows: list[Bar] = []
    for chunk_start, chunk_end in date_chunks(start, end):
        last_error = None
        for attempt in range(1, retry + 1):
            try:
                kbars = api.kbars(contract=contract, start=chunk_start, end=chunk_end, timeout=30000)
                rows.extend(bars_from_kbars(kbars))
                last_error = None
                break
            except Exception as exc:  # pragma: no cover - network/runtime
                last_error = exc
                if attempt < retry:
                    time.sleep(min(5.0, attempt * 1.5))
        if last_error is not None:
            raise last_error
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)
    # de-duplicate by timestamp when chunk boundaries/provider overlap.
    unique = {bar.timestamp.isoformat(): bar for bar in rows}
    return [unique[key] for key in sorted(unique)]


def main() -> int:
    args = parse_args()
    api_key = os.environ.get("SJ_API_KEY", "").strip()
    secret_key = os.environ.get("SJ_SEC_KEY", "").strip()
    if not api_key or not secret_key:
        print("SJ_API_KEY / SJ_SEC_KEY are required. Do not store them in Git.", file=sys.stderr)
        return 2

    universe_path = Path(args.universe)
    output_dir = Path(args.output_dir)
    symbols = load_symbols(universe_path)
    if args.max_symbols > 0:
        symbols = symbols[: args.max_symbols]

    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "manifest.json"
    manifest = {
        "schemaVersion": 1,
        "source": "Shioaji historical Kbars",
        "purpose": "2026Q2 frozen-strategy point-in-time replay",
        "period": {"start": args.start, "end": args.end},
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "policy": {
            "futureLeakage": "forbidden",
            "rawInterval": "1m",
            "derivedIntervals": ["5m", "15m"],
            "session": "09:00-13:30 Asia/Taipei",
            "credentials": "environment only; Market/Data permission recommended",
        },
        "requestedSymbols": len(symbols),
        "completeSymbols": [],
        "errors": {},
    }

    api = sj.Shioaji(simulation=False)
    api.login(api_key=api_key, secret_key=secret_key, subscribe_trade=False, receive_window=60000)

    try:
        for index, symbol in enumerate(symbols, start=1):
            raw_path = output_dir / "1m" / f"{symbol}.csv.gz"
            five_path = output_dir / "5m" / f"{symbol}.csv.gz"
            fifteen_path = output_dir / "15m" / f"{symbol}.csv.gz"
            if args.resume and raw_path.exists() and five_path.exists() and fifteen_path.exists():
                manifest["completeSymbols"].append(symbol)
                print(f"[{index}/{len(symbols)}] {symbol} resume-skip")
                continue
            try:
                one_minute = fetch_symbol(api, symbol, args.start, args.end, args.retry, args.sleep)
                five_minute = aggregate(one_minute, 5)
                fifteen_minute = aggregate(one_minute, 15)
                write_gzip_csv(raw_path, symbol, one_minute, "1m")
                write_gzip_csv(five_path, symbol, five_minute, "5m")
                write_gzip_csv(fifteen_path, symbol, fifteen_minute, "15m")
                manifest["completeSymbols"].append(symbol)
                print(f"[{index}/{len(symbols)}] {symbol}: 1m={len(one_minute)} 5m={len(five_minute)} 15m={len(fifteen_minute)}")
            except Exception as exc:  # pragma: no cover - network/runtime
                manifest["errors"][symbol] = str(exc)
                print(f"[{index}/{len(symbols)}] {symbol} ERROR: {exc}", file=sys.stderr)
            manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
            manifest["completeCount"] = len(set(manifest["completeSymbols"]))
            manifest["errorCount"] = len(manifest["errors"])
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    finally:
        try:
            api.logout()
        except Exception:
            pass

    manifest["completeSymbols"] = sorted(set(manifest["completeSymbols"]))
    manifest["completeCount"] = len(manifest["completeSymbols"])
    manifest["errorCount"] = len(manifest["errors"])
    manifest["status"] = "complete" if not manifest["errors"] else "partial"
    manifest["generatedAt"] = datetime.now(timezone.utc).isoformat()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "status": manifest["status"],
        "requested": manifest["requestedSymbols"],
        "complete": manifest["completeCount"],
        "errors": manifest["errorCount"],
        "manifest": str(manifest_path),
    }, ensure_ascii=False, indent=2))
    return 0 if manifest["status"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
