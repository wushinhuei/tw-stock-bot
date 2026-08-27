# Apps Script backend for Taiwan stock simulation

This folder is the Apps Script version of the simulation backend. It is designed to replace GitHub Actions for intraday updates.

## Deploy

1. Create a new Google Apps Script project.
2. Copy `Code.gs` into the script editor.
3. Copy `appsscript.json` into Project Settings > Show appsscript.json manifest file.
4. Run `installRealtimeTradingTrigger()` once and authorize it.
5. Run `configureDailyHistoryUpdate()` once to install the 19:15 and 21:15 aligned market-history updates.
6. Run `configureMopsRollingUpdate()` once to install the 22:30 MOPS/TWSE OpenAPI update.
7. Deploy as Web app:
   - Execute as: Me
   - Who has access: Anyone
8. Copy the Web app URL into `web/apps_script_config.js`.

## MOPS rolling data

`updateMopsRollingData()` updates the existing Traditional-Chinese Drive folders with the minimum data used by analysis: company basics, monthly revenue, current quarterly financial tables, daily material messages, and exact filing timestamps found in official messages. Files are merged by stable keys so retries do not duplicate rows. Statutory deadlines are never substituted for an unavailable official filing timestamp.

The ten-year quarterly XBRL build remains a separate initial Cloud Run/local backfill because forty ZIP archives exceed a normal Apps Script execution window. Rolling OpenAPI updates preserve that archive and add newly published periods.

## Web API

- `?action=read` returns the latest stored dashboard state.
- `?action=status` returns a lightweight trade signature so the dashboard can refresh immediately when a background trade changes.
- `?action=refresh` fetches TWSE/Yahoo data immediately, recalculates simulation P&L, and stores the result.
- Add `callback=...` for JSONP. The GitHub Pages dashboard uses JSONP to avoid browser CORS issues.

## State

The script stores the latest scenario and simulation result in Script Properties. On first run it seeds state from the current GitHub raw dashboard files, so the existing 2026-08-10 simulation history is preserved.
