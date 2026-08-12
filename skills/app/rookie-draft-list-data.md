---
name: Rookie Draft List Data
description: Reference for rookie draft list CSVs and data. Triggered when
  discussing rookie drafts, draft picks, rookie values, or draft pick
  valuations.
accessType: on_demand
isEnabled: true
createdAt: 2026-08-12T15:39:29.692Z
---

# Rookie Draft List Data

Rookie draft pick data is used by the `EvaluateTrade` API to value draft pick assets in trades.

## How Draft Picks Are Valued
- The trade calculator uses a formula based on overall pick number
- **Rookie premium:** Graduated boost — pick 1 gets +20%, pick 128 gets +1% (quadratic falloff)
- `ROOKIE_MAX_PICK = 128` (NFL rounds 1-4)
- Premium applies via `getRookiePremium(overallPick)` function
- Picks are converted to an equivalent ADP rank: `pickRound * TOTAL_TEAMS` (11 teams)

## Draft Pick Asset Schema
```
{ type: "pick", pickYear: 2027, pickRound: 2, pickNumber: null }
```

## DO NOT re-import rookie data unless the user explicitly provides new rookie list CSVs.
