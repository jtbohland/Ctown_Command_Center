---
name: 2027 Draft Recommendations — Superlatives View
description: Ideas for next year's draft-day player recommendations UI.
  Triggered when discussing 2027 draft prep, player recommendations, draft-day
  suggestions, or recommendation tiles.
accessType: on_demand
isEnabled: true
createdAt: 2026-08-31T22:52:29.745Z
---

# 2027 Draft Day Recommendations — Superlatives-Style View

## 🎯 The Goal
Get JT graded **B+ to A+** with:
- **More steals than reaches**
- **Zero wasted picks** (no 2nd QB/TE when quality RB/WR are on the board)

Every recommendation should be optimized toward this outcome.

## Context
The Draft Recap superlatives tiles (Steals / Reaches / Perfect Picks / QB-TE Corner) turned out clean and easy to read under draft-day pressure. Adapt this layout for **live draft-day player recommendations**.

## Scope — What This Replaces
This new superlatives-style view **replaces only the "Biggest ADP Falls" list** that the current recommendations flag. It does NOT replace:
- **Player profiles** (positional needs, SOS, Vegas lines, implied points) — keep those
- **Positional scarcity analysis** — keep
- **Team need context** — keep
- **Keeper-aware filtering** — keep

The existing recommendation engine's rich player data stays. The superlatives tiles are a **better presentation** of the ADP-fall/value data specifically.

## Ideas to Explore
- **Top 5 Biggest Steals Available** — players who have fallen the most past their ADP and are still on the board (grab these!)
- **Top 5 Biggest Reaches to Avoid** — players whose ADP says "not yet" at your current pick slot (don't do this)
- **Top 5 Perfect Picks** — players whose ADP aligns perfectly with your current draft position (safe, solid value)
- **4th tile: Top 3 by Position** — best available RB, WR, QB, TE ranked by blended value
- All variables from the existing recommendation engine (ADP, positional scarcity, team need, keeper context) should feed into these buckets
- Leave space in the UI for positional needs, SOS, Vegas, implied points alongside the tiles

## Key Design Principles (from JT)
- Simple, scannable tiles — not a wall of data
- 1-line per player: name, position badge, ADP, pick slot context
- Color-coded (green/red/blue/purple) like the recap superlatives
- Works under time pressure — commissioner is on the clock
- **Surface the steals, flag the reaches, eliminate the waste**

**Status:** Brainstorm stage — discuss with JT before building. Come with ideas!
