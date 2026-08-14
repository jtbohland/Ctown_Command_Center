---
name: No Test Data in Production Views
description: Test trades and test data must never appear in the app's
  public-facing features like the trade ledger, verdicts, or Déjà Vu results.
  Triggered when creating test records, running test APIs, or debugging trade
  data.
accessType: on_demand
isEnabled: true
createdAt: 2026-08-14T16:48:36.129Z
---

## No Test Data in Production Views

- **Test records** (trades, players, assets) must **never** be visible in the app's public-facing features:
  - Trade Ledger
  - Trade Verdicts / Déjà Vu results
  - Roster valuations
  - Any user-facing list or card
- Clark **can** create and run test data via `testApi` or direct DB queries for validation purposes
- After testing, **always clean up** test records from the database before finalizing
- If cleanup isn't possible immediately, flag it to the user
- Examples of test data to watch for: `TEST_DUPE_CHECK` player, trades with non-standard season formats like `"2026"` or `"2025-2026"`
