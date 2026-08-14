---
name: Redux Rosters Live Valuation
description: Redux Rosters player values should use the blended ADP/Actuals
  formula, not raw ADP rank. Triggered when discussing roster card values,
  player valuations on rosters, or live scoring display.
accessType: on_demand
isEnabled: true
createdAt: 2026-08-13T23:49:39.518Z
---

## Redux Rosters — Live Player Valuation

The values displayed next to players on the Redux Rosters tab should use the **canonical blended valuation formula**, not raw `adp_rank`.

### Pre-season
- 100% ADP-weighted value (normalized 0-100 scale from ADP rank)
- Shows player trade value even before any games are played

### In-season
- Blended per the PPR Leader Data Plan phase weights:
  - Early (weeks 1-4): 10-20% actuals
  - Mid (weeks 5-10): 25-35% actuals
  - Late (weeks 11-18): 40-50% actuals
  - Postseason: 85% actuals

### Purpose
- Values are **live** — they update as weekly performance reports are uploaded
- Same values feed into **Deal Desk** recommendations and **Sound the Alarm** analysis
- Provides a single source of truth for player valuation across the entire app

### Display Format
- Show the blended value (0-100 scale) on roster cards
- Consider showing positional context (e.g. QB1, RB8) alongside the value
