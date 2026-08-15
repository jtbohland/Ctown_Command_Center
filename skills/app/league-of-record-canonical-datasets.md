---
name: League of Record — Canonical Datasets
description: Authoritative rules for reading, interpreting, and auditing the
  three canonical League of Record CSVs (historical trades, 2026 draft order,
  2027 draft order). Triggered when referencing archived CSVs, auditing trade
  data, checking draft pick ownership, resolving data conflicts, or performing
  any operation against ffwr_league_records.
accessType: on_demand
isEnabled: true
createdAt: 2026-08-15T16:02:24.763Z
---

# League of Record — Canonical Datasets

These three uploaded CSVs are the **clean, canonical** League of Record datasets for C-Town Redux. Keep them as **three separate datasets**. Do not merge them, overwrite them with older versions, or infer missing facts.

## The Three Files

| # | Filename | Category |
|---|----------|----------|
| 1 | `ctown_historical_all_time_trades_2019_2026_final.csv` | Trades |
| 2 | `ctown_2026_present_day_draft_order.csv` | Draft Picks (2026) |
| 3 | `ctown_2027_present_day_draft_order.csv` | Draft Picks (2027) |

---

## 1. Historical Trades File

- **One row = one complete trade event** (276 trades, draft cycles 2019–2026: 273 two-team, 3 three-team)
- **Key fields:**
  - `trade_id` — unique identifier for the trade event
  - `draft_cycle_year` — the draft-order cycle/file containing the trade record
  - `trade_year` — calendar year the trade occurred
  - `trade_date` — date of the transaction
  - `trade_phase` — broad timing: `offseason`, `draft_weekend`, or `in_season`
  - `trade_phase_detail` — more specific timing label
  - `trade_type` — `two_team` or `three_team`
  - `team_1`, `team_2`, `team_3` — managers participating
  - `team_X_asset_Y` — an asset that team **traded away** (NOT received)

### Year Field Rules
- `draft_cycle_year` and `trade_year` serve **different purposes** — e.g. `draft_cycle_year=2020, trade_year=2019` = trade made during the 2020 draft cycle but executed in calendar 2019
- **Never replace one field with the other**

### Trade Summary Rules
- Include every nonblank asset for each team
- Blank asset fields = no additional recorded asset (not zero value)
- Keep one row as one trade — **never split a three-team trade into multiple trades**
- **Do not assume** team 1 received team 2's assets in a three-team trade
- **Do not declare a winner** from this file alone unless valuation is explicitly requested
- If received assets are displayed, label them as **inferred** unless an explicit destination mapping exists
- Source-reference numbers were intentionally removed — do not try to interpret parenthetical references

### Trade Timing Labels
Use the stored phase fields, don't recreate from guesswork:
- `offseason / postseason_offseason` — after playoffs/Super Bowl through offseason
- `offseason / pre_draft_offseason` — offseason trades before C-Town draft weekend
- `draft_weekend / draft_weekend` — during C-Town draft day/weekend
- `offseason / post_draft_preseason` — after C-Town draft, before regular season
- `in_season / regular_season` — during NFL regular season

For valuation cutoffs, use the actual `trade_date` and the season calendar. **Do not use `trade_phase_detail` as a substitute for the exact weekly cutoff.** C-Town treats NFL playoffs and Super Bowl as offseason activity.

---

## 2. 2026 Present-Day Draft Order

**File:** `ctown_2026_present_day_draft_order.csv`

- **Columns:** `draft_year` (2026), `round`, `pick` (1–121 overall), `pick_owner`, `from_manager`
- Each row = current ownership of one exact 2026 draft slot
- Blank `from_manager` = no acquired-from manager recorded — **do not invent an acquisition source**
- This is the **present-day ownership view**, not a trade-history replacement
- Use the historical trade file for underlying events; use this file for who **currently owns** each exact 2026 slot

---

## 3. 2027 Present-Day Draft Order

**File:** `ctown_2027_present_day_draft_order.csv`

- Same column definitions as 2026 file; 121 present-day slot rows
- Some owners are known from recorded pick transfers; others are **TBD**
- **TBD rules:**
  - TBD is intentional uncertainty, **not a manager name**
  - **Do not guess or fill TBD owners**
  - Do not treat the 2027 list as final post-season draft sequence (depends on completed 2026–27 season)
  - Use known rows for current ownership; keep unresolved rows visible for later reconciliation
- Blank `from_manager` = no acquisition source recorded

---

## League Continuity Rule

**Jordan → Carson franchise succession** beginning with the **2021 season**. This is a franchise succession event, **not a trade**. Preserve Jordan as the historical manager in older records, but treat Carson as the successor owner for inherited 2021+ assets and draft continuity.

Carryovers, layovers, and conditional-pick notes may affect later pick ownership — they **do not create new trades** and must not rewrite the original trade event, date, or historical participants.

---

## Audit & Data-Integrity Rules

- Use `trade_id` to identify a trade, **not date alone**
- **Do not deduplicate** trades solely because participants or dates repeat
- **Do not treat a pick number as a round** unless the text says so
- Keep exact pick numbers separate from round-only future-pick descriptions
- **Never use a blank or TBD value** as zero, unknown value, or permission to guess
- **Keep the three files separate** — preserve original filenames as dataset labels
- If a contradiction is found, **report the file, row, field, and conflicting values before changing anything**
- **Do not recalculate** historical valuations, winners, or verdicts as part of a data-ingestion audit

---

## Audit Pass Criteria

Do not declare the platform fully validated based only on successful code execution or aggregate counts.

The audit passes **only** when:
1. Every canonical row is accounted for
2. Every mismatch is listed and explained
3. Every score is reproducible from its source inputs
4. No future information leaks into historical valuations
5. Historical trade results reconcile to the canonical CSVs
6. 2026 ownership is fully resolved
7. 2027 TBD rows remain explicitly unresolved
8. Every verdict change is individually traceable

**Return a final GREEN / YELLOW / RED status for each area:**
- League of Record data
- Draft treasury
- Player valuation
- Pick valuation
- Historical trade verdicts
- Draft recommendations

**Do not modify production data until the complete audit report is reviewed.**

---

## Valuation Alignment

Use the three canonical CSVs together with season-specific ADP and labeled Actuals datasets.

### Player Assets
- Use ADP and dynasty/context inputs as the baseline
- **Integrate Actuals permanently** — do not create an ADP/Actuals toggle
- Use the **trade date** to determine the Actuals cutoff:
  - **Preseason:** no current-season Actuals
  - **In-season:** use only weekly data through the last completed week before the trade
  - **Postseason:** use final Actuals until the next season's ADP is available
- Normalize Actuals by position using total points, PPG, and games played
- **Missing ADP or Actuals must not equal zero**
- Show every player's baseline, Actuals cutoff, Actuals adjustment, and final value

### Draft Picks
- Use the **pick's draft year** — not trade year
- Apply the correct league size for that draft year
- Preserve exact slots and round-only future picks separately
- Apply keeper and future-year rules consistently

### Audit Requirements
Audit the Draft and C-Town Exchange using the **same production valuation functions**. Do not create a parallel approximation.

**Report must include:**
1. Formula and settings actually used
2. Source coverage and unmatched players
3. Player and pick score validation samples
4. Historical verdicts before and after canonical-data ingestion
5. Every changed verdict or winner
6. Any future-data leakage, missing input, contradiction, or unresolved record

**Do not overwrite production data until every discrepancy is explained.**
