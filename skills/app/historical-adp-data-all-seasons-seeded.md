---
name: Historical ADP Data - All Seasons Seeded
description: Reference for all historical ADP seasons seeded into
  ffwr_historical_adp. Triggered when discussing ADP data, trade valuations,
  player values, seeding data, or season data availability.
accessType: on_demand
isEnabled: true
createdAt: 2026-08-12T15:39:29.681Z
---

# Historical ADP Data — Fully Seeded Seasons

All ADP data lives in the **`ffwr_historical_adp`** table in Apps Database (`c6e32cf4-ca66-42ae-aeb3-58c84ffae574`).

## Season Inventory

| Season | Players | Source | Status |
|--------|---------|--------|--------|
| 2018-19 | 388 | FantasyPros CSV | ✅ Complete |
| 2019-20 | 955 | FantasyPros CSV | ✅ Complete |
| 2020-21 | 506 | FantasyPros CSV | ✅ Complete |
| 2021-22 | 411 | FantasyPros CSV | ✅ Complete |
| 2022-23 | 292 | FantasyPros CSV | ✅ Complete |
| 2023-24 | 509 | FantasyPros CSV | ✅ Complete |
| 2024-25 | 852 | FantasyPros CSV | ✅ Complete |
| 2025-26 | 891 | FantasyPros CSV | ✅ Complete |
| 2026-27 | 511 | FantasyPros CSV | ✅ Complete |

**Total: 9 seasons, 5,315 player-season records**

## Season Naming Convention
- Format: `YYYY-YY` (e.g. `2026-27`)
- The first year is when the NFL season starts (drafts happen), the second is when it ends (playoffs/Super Bowl)
- "Current season" as of Aug 2026 = **2026-27**

## Seeding Details
- **API used:** `SeedAdpFromCsv`
- **Input field:** `csvData` (not `csvText`)
- **Batch size:** ~160 rows per batch (API size limits)
- **First batch:** `replaceExisting: true` to clear existing data for that season
- **Subsequent batches:** `replaceExisting: false`
- **Auto-skipped positions:** DST and K (kickers) — only QB, RB, WR, TE are stored
- **CSV format:** FantasyPros "Overall ADP" export with columns: Rank, Player (Bye), POS, ESPN, Sleeper, CBS, NFL, RTSports, Fantrax, AVG, Real-Time

## DO NOT re-seed these seasons. They are complete and verified.
