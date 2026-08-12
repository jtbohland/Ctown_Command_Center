---
name: Historical League Trades Data
description: Reference for historical league trade data seeded into the
  database. Triggered when discussing past trades, déjà vu trade matching, trade
  history, or league transaction records.
accessType: on_demand
isEnabled: true
createdAt: 2026-08-12T15:39:29.687Z
---

# Historical League Trades — Seeded Data

Historical league trades are stored in the **`ffwr_trades`** and **`ffwr_trade_assets`** tables in Apps Database.

## Key Facts
- Trades were imported from league history CSVs in earlier sessions
- The `EvaluateTrade` API uses these for **Déjà Vu** matching — finding similar historical trades to compare against
- Trade assets include both players and draft picks
- Each trade links two teams (teamA / teamB) with their respective assets

## DO NOT re-import historical trades unless the user explicitly provides new trade data.
