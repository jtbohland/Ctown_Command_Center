---
name: PPR Leader Data Plan
description: "Canonical player-valuation behavior: blended ADP/Actuals formula
  with trade-date-aware cutoffs. Triggered when discussing trade formula,
  in-season scoring, player performance data, or actuals valuation."
accessType: on_demand
isEnabled: true
createdAt: 2026-08-11T17:41:46.340Z
---

## PPR Leader Data — Implemented

**Status:** Phase A complete — `ComputeTradeActuals` API built and validated

**Architecture:** Server-side API computes trade-date-aware actuals through cutoff. Client handles display, slider inputs, blending, and calculation audit.

**Canonical Formula:**
```
player_value = baseline × (1 - actuals_weight) + actuals_value × actuals_weight + dynasty_adjustments
```

**No ADP/Actuals toggle.** Every trade automatically gets the right blend based on trade date.

**Phase-based weighting:**
| Phase | Weeks | Actuals Weight |
|-------|-------|---------------|
| Preseason | 0 | 0% |
| Early | 1-4 | 10-20% |
| Mid | 5-10 | 25-35% |
| Late | 11-17/18 | 40-50% |
| Postseason | all | 85% |

**Actuals Value (0-100 normalized):**
```
actualsValue = 60% positional total-pts percentile + 40% positional PPG percentile
```

**API:** `ComputeTradeActuals` — accepts array of `{tradeId, season, tradeDate}`, returns per-player cutoff stats, position percentiles, and phase-based weight.

**Data:** `ffwr_season_actuals` has weekly columns (week_1 through week_18) for exact cutoffs. 7 seasons, 4,652 players.

**Next steps:** Client-side integration into trade-utils.ts, UI updates to remove toggle, dealer slider rework.
