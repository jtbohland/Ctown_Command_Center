---
name: PPR Leader Data Plan
description: "Future enhancement: import PPR scoring leader CSVs (2018-2026) for
  in-season trade valuations. Triggered when discussing trade formula, in-season
  scoring, or player performance data."
accessType: on_demand
isEnabled: true
createdAt: 2026-08-11T17:41:46.340Z
---

## PPR Leader Data — Planned Enhancement

**Status:** Design approved, CSVs available (2018-2026), not yet implemented

**Concept:** Dual-mode valuation based on trade `period`:
- **Off-season / Draft Day trades** → use ADP rank (pre-season expectations)
- **In-season trades** → use actual PPR points-per-game rank (reality)

**Approach:** Clean switch (not a blend). The formula `10,000 × (1/rank)^0.6` stays the same — only the rank source changes.

**Data needed:** `ffwr_season_stats` table with: `player_name, season, ppg, total_points, games_played, ppg_rank`

**Impact:** Will re-score all historical in-season trades with actual performance data. Some "robberies" may become smart mid-season moves.

**Fallback:** For players with insufficient game data (injured early, etc.), fall back to ADP.

**Build order:** Complete rookie/age/positional factors first, then add PPR leader data.
