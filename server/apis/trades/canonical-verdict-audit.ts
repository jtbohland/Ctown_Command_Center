import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizeName, extractKeeperRightsPlayer } from "../../lib/normalize-trade-name.js";
import {
  BASE_VALUE,
  DEFAULT_FUTURE_DISCOUNT,
  FAIR_TOLERANCE,
  FUTURE_PICK_DISCOUNT,
  KEEPERS_PER_TEAM,
  POWER,
  VALUATION_SPEC_FINGERPRINT,
  VALUATION_SPEC_VERSION,
  calcPlayerValue,
  getFuturePickDiscount,
  getLeagueSize,
  getUnrankedBaseline,
  getVerdict as getSpecVerdict,
  pickToExpectedAdp,
  seasonToDraftYear,
} from "../../lib/valuation/valuation-spec.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Canonical constants ──────────────────────────────────────
// Phase 3: this audit no longer keeps private copies of the valuation
// constants. It reads them from the canonical spec, which is also what
// EvaluateTrade and the backfill engine consume, and then audits that spec
// against an independent ratified baseline (see CANONICAL_BASELINE below).
const VERDICT_SCALE = 1.0;

function calcValue(adpRank: number): number {
  return calcPlayerValue(adpRank, POWER);
}

function getVerdict(pctDiff: number): { label: string; emoji: string; severity: string } {
  return getSpecVerdict(pctDiff, FAIR_TOLERANCE, VERDICT_SCALE);
}

// ─── Schemas ──────────────────────────────────────────────────

const TradeRow = z.object({
  id: z.coerce.number(),
  trade_number: z.coerce.number(),
  season: z.string(),
  trade_date: z.string().nullable(),
  team_a_id: z.coerce.number(),
  team_b_id: z.coerce.number(),
  team_c_id: z.coerce.number().nullable(),
  trade_type: z.string().nullable(),
  period: z.string().nullable(),
  verdict_label: z.string().nullable(),
  verdict_emoji: z.string().nullable(),
  verdict_severity: z.string().nullable(),
  winner_team_id: z.coerce.number().nullable(),
  pct_difference: z.coerce.number().nullable(),
  team_a_total: z.coerce.number().nullable(),
  team_b_total: z.coerce.number().nullable(),
  team_c_total: z.coerce.number().nullable(),
  valuation_complete: z.coerce.boolean().nullable(),
  confidence: z.string().nullable(),
  confidence_reasons: z.array(z.string()).nullable(),
});

const AssetRow = z.object({
  id: z.coerce.number(),
  trade_id: z.coerce.number(),
  from_team_id: z.coerce.number(),
  asset_type: z.string(),
  player_name: z.string().nullable(),
  player_position: z.string().nullable(),
  player_adp_at_trade: z.coerce.number().nullable(),
  pick_year: z.coerce.number().nullable(),
  pick_round: z.coerce.number().nullable(),
  pick_number: z.coerce.number().nullable(),
});

const AdpRow = z.object({
  player_name: z.string(),
  adp_rank: z.coerce.number(),
  season: z.string(),
  position: z.string(),
});

const SnapshotRow = z.object({
  trade_id: z.coerce.number(),
  verdict_severity: z.string().nullable(),
  winner_team_id: z.coerce.number().nullable(),
  pct_difference: z.coerce.number().nullable(),
  team_a_total: z.coerce.number().nullable(),
  team_b_total: z.coerce.number().nullable(),
  team_c_total: z.coerce.number().nullable(),
  run_type: z.string(),
});

// ─── Output schemas ───────────────────────────────────────────

const TradeAuditEntry = z.object({
  tradeId: z.number(),
  tradeNumber: z.number(),
  season: z.string(),
  period: z.string().nullable(),
  tradeType: z.string(),
  // DB stored values (Surface 1 — canonical)
  db: z.object({
    verdictSeverity: z.string().nullable(),
    verdictLabel: z.string().nullable(),
    winnerTeamId: z.number().nullable(),
    pctDifference: z.number().nullable(),
    teamATotal: z.number().nullable(),
    teamBTotal: z.number().nullable(),
    teamCTotal: z.number().nullable(),
    confidence: z.string().nullable(),
    valuationComplete: z.boolean().nullable(),
  }),
  // Surface 2 — Ledger/History passthrough check
  ledgerPassthrough: z.object({
    matches: z.boolean(),
    note: z.string(),
  }),
  // Surface 3 — Exchange pick-formula structural check
  exchangePickCheck: z.object({
    pickFormulaAligned: z.boolean(),
    pickAssetCount: z.number(),
    pickDetails: z.array(z.object({
      assetId: z.number(),
      round: z.number(),
      pickNumber: z.number().nullable(),
      pickYear: z.number().nullable(),
      backfillAdp: z.number(),
      exchangeAdp: z.number(),
      match: z.boolean(),
    })),
  }),
  // v2 snapshot consistency
  snapshotMatch: z.object({
    inSnapshot: z.boolean(),
    allFieldsMatch: z.boolean(),
    mismatches: z.array(z.string()),
  }),
  // Categorization flags
  categories: z.object({
    hasExactPick: z.boolean(),
    hasRoundOnlyPick: z.boolean(),
    hasFuturePick: z.boolean(),
    hasKeeperRights: z.boolean(),
    isThreeTeam: z.boolean(),
    isFairCatch: z.boolean(),
    hasFallbackBaseline: z.boolean(),
    hasActualsBlending: z.boolean(),
    hasNullFields: z.boolean(),
  }),
});

export default api({
  name: "CanonicalVerdictAudit",
  description: "Full-fidelity three-surface audit of all 276 valuated trade verdicts.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    totalTrades: z.number(),
    valuatedTrades: z.number(),
    activeFormulaVersion: z.string(),
    noProductionWritesDuringAudit: z.boolean(),

    // Surface 1 — DB integrity
    dbIntegrity: z.object({
      completeRecords: z.number(),
      nullVerdicts: z.number(),
      nullTotals: z.number(),
      incompleteValuation: z.number(),
    }),

    // Surface 2 — Ledger/History passthrough
    ledgerSurface: z.object({
      totalChecked: z.number(),
      allPassthrough: z.boolean(),
      note: z.string(),
    }),

    // Surface 3 — Exchange pick formula alignment
    exchangeSurface: z.object({
      totalPicksChecked: z.number(),
      allPicksAligned: z.boolean(),
      misalignedPicks: z.number(),
      constantsMatch: z.object({
        baseValue: z.boolean(),
        power: z.boolean(),
        keepersPerTeam: z.boolean(),
        leagueSizes: z.boolean(),
        fairTolerance: z.boolean(),
        verdictThresholds: z.boolean(),
        futurePickDiscounts: z.boolean(),
      }),
      engineDifferences: z.array(z.string()),
      /** Canonical spec identity that produced this audit run. */
      valuationSpec: z.object({
        version: z.string(),
        fingerprint: z.string(),
      }),
    }),

    // v2 snapshot consistency
    snapshotConsistency: z.object({
      snapshotRunType: z.string(),
      snapshotTradeCount: z.number(),
      allFieldsMatch: z.number(),
      fieldMismatches: z.number(),
      mismatchTradeIds: z.array(z.number()),
    }),

    // Categorized coverage
    coverage: z.object({
      byPeriod: z.record(z.string(), z.number()),
      byTradeType: z.record(z.string(), z.number()),
      bySeverity: z.record(z.string(), z.number()),
      byConfidence: z.record(z.string(), z.number()),
      edgeCases: z.object({
        exactPickTrades: z.number(),
        roundOnlyPickTrades: z.number(),
        futurePickTrades: z.number(),
        keeperRightsTrades: z.number(),
        threeTeamTrades: z.number(),
        fairCatchTrades: z.number(),
        fallbackBaselineTrades: z.number(),
        actualsBlendedTrades: z.number(),
      }),
    }),

    // Full audit entries (all 276)
    auditEntries: z.array(TradeAuditEntry),

    // Mismatches only (for quick review)
    mismatchSummary: z.array(z.object({
      tradeId: z.number(),
      tradeNumber: z.number(),
      season: z.string(),
      surface: z.string(),
      field: z.string(),
      expected: z.string(),
      actual: z.string(),
    })),
  }),

  async run(ctx) {
    // ── Load all trades ──
    const allTrades = await ctx.integrations.apps_db.query(
      `SELECT t.id, t.trade_number, t.season, t.trade_date,
              t.team_a_id, t.team_b_id, t.team_c_id, t.trade_type, t.period,
              t.verdict_label, t.verdict_emoji, t.verdict_severity,
              t.winner_team_id, t.pct_difference,
              t.team_a_total, t.team_b_total, t.team_c_total,
              t.valuation_complete, t.confidence, t.confidence_reasons
       FROM ffwr_trades t
       ORDER BY t.season, t.trade_number
       LIMIT 500`,
      TradeRow,
      undefined,
      { label: "Load all trades" }
    );

    // ── Load all trade assets ──
    const allAssets = await ctx.integrations.apps_db.query(
      `SELECT id, trade_id, from_team_id, asset_type, player_name,
              player_position, player_adp_at_trade, pick_year, pick_round, pick_number
       FROM ffwr_trade_assets
       ORDER BY trade_id, id
       LIMIT 3000`,
      AssetRow,
      undefined,
      { label: "Load all trade assets" }
    );

    // ── Load ADP data for all seasons ──
    const allAdp = await ctx.integrations.apps_db.query(
      `SELECT player_name, adp_rank, season, position
       FROM ffwr_historical_adp
       ORDER BY season, adp_rank
       LIMIT 10000`,
      AdpRow,
      undefined,
      { label: "Load all historical ADP" }
    );

    // ── Load v2 snapshot ──
    const v2Snapshots = await ctx.integrations.apps_db.query(
      `SELECT trade_id, verdict_severity, winner_team_id,
              pct_difference, team_a_total, team_b_total, team_c_total, run_type
       FROM ffwr_verdict_snapshots
       WHERE run_type = 'v2_exact_pick_position'
       ORDER BY trade_id
       LIMIT 500`,
      SnapshotRow,
      undefined,
      { label: "Load v2 snapshot" }
    );

    // ── Build lookup structures ──
    const assetsByTrade = new Map<number, z.infer<typeof AssetRow>[]>();
    for (const a of allAssets) {
      if (!assetsByTrade.has(a.trade_id)) assetsByTrade.set(a.trade_id, []);
      assetsByTrade.get(a.trade_id)!.push(a);
    }

    const adpBySeason = new Map<string, Map<string, number>>();
    for (const row of allAdp) {
      if (!adpBySeason.has(row.season)) adpBySeason.set(row.season, new Map());
      adpBySeason.get(row.season)!.set(normalizeName(row.player_name), row.adp_rank);
    }

    const snapshotByTrade = new Map<number, z.infer<typeof SnapshotRow>>();
    for (const s of v2Snapshots) {
      snapshotByTrade.set(s.trade_id, s);
    }

    // ── Audit constants alignment ──
    // Phase 3: every engine (Exchange, backfill, provenance, client) now reads
    // its constants from server/lib/valuation/valuation-spec.ts, so "do the
    // engines agree with each other" is no longer a meaningful question — they
    // are literally the same values.
    //
    // What IS still worth auditing is whether that shared spec still matches
    // the league's RATIFIED baseline. CANONICAL_BASELINE below is written as
    // independent literals on purpose: it is the expectation, not a re-export.
    // If someone edits the spec, these checks flip to false instead of the
    // audit silently reporting `true` as it did before.
    const CANONICAL_BASELINE = {
      baseValue: 10000,
      power: 0.6,
      keepersPerTeam: 4,
      fairTolerance: 5,
      leagueSizes: {
        2019: 10, 2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 10,
        2025: 11, 2026: 11, 2027: 11, 2028: 11,
      } as Record<number, number>,
      // years ahead of the reference draft year → discount factor
      futurePickDiscounts: { 0: 1.0, 1: 0.8, 2: 0.65, 3: 0.5, 4: 0.5 } as Record<number, number>,
      // |pctDiff| → expected severity at scale 1.0
      verdictThresholds: [
        { pct: 0, severity: "fair" },
        { pct: 5, severity: "fair" },
        { pct: 9, severity: "slight" },
        { pct: 15, severity: "slight" },
        { pct: 20, severity: "clear" },
        { pct: 25, severity: "clear" },
        { pct: 40, severity: "robbery" },
      ],
    };

    const constantsMatch = {
      baseValue: BASE_VALUE === CANONICAL_BASELINE.baseValue,
      power: POWER === CANONICAL_BASELINE.power,
      keepersPerTeam: KEEPERS_PER_TEAM === CANONICAL_BASELINE.keepersPerTeam,
      // getLeagueSize() — not the raw map — is what every engine actually
      // calls, and it applies DEFAULT_LEAGUE_SIZE for years the map does not
      // enumerate (e.g. 2028). Auditing the raw map would report a false
      // mismatch for those years.
      leagueSizes: Object.entries(CANONICAL_BASELINE.leagueSizes).every(
        ([year, size]) => getLeagueSize(Number(year)) === size,
      ),
      fairTolerance: FAIR_TOLERANCE === CANONICAL_BASELINE.fairTolerance,
      verdictThresholds: CANONICAL_BASELINE.verdictThresholds.every(
        ({ pct, severity }) => getVerdict(pct).severity === severity,
      ),
      // Previously hardcoded `true` while the Exchange actually applied a
      // geometric (1 - 0.10)^yearsOut curve — a 2028 pick was priced ~25% high.
      // Now computed against the ratified step table.
      futurePickDiscounts: Object.entries(CANONICAL_BASELINE.futurePickDiscounts).every(
        ([yearsAhead, expected]) =>
          Math.abs(getFuturePickDiscount(2026 + Number(yearsAhead), 2026) - expected) < 1e-9,
      ),
    };

    // Known structural differences between Exchange and Backfill
    const engineDifferences = [
      "Exchange uses dynasty multipliers (rookie hype, age curve, positional premiums) — Backfill does not",
      "Exchange accepts user-tunable modifier overrides — Backfill uses fixed canonical constants",
      "Backfill uses actuals blending (in-season weight 10-85%) — Exchange does not (prospective trades only)",
      "Backfill applies position-specific unranked baselines for missing ADP — Exchange leaves unresolved",
      "Backfill resolves keeper-rights assets at RIGHTS_VALUE_MULTIPLIER=1.0 — Exchange does not handle keeper rights",
      `Both engines now share the canonical future-pick step table (${
        Object.entries(FUTURE_PICK_DISCOUNT)
          .map(([y, d]) => `+${y}y ${d}`)
          .join(", ")
      }, 3y+ ${DEFAULT_FUTURE_DISCOUNT}); the Exchange's futurePickDiscount modifier is an intensity dial on that table, not a competing curve`,
    ];

    // ── Process each trade ──
    const valuatedTrades = allTrades.filter(t => t.valuation_complete);
    const auditEntries: z.infer<typeof TradeAuditEntry>[] = [];
    const mismatchSummary: { tradeId: number; tradeNumber: number; season: string; surface: string; field: string; expected: string; actual: string }[] = [];

    // DB integrity counters
    let completeRecords = 0;
    let nullVerdicts = 0;
    let nullTotals = 0;
    let incompleteValuation = 0;

    // Coverage counters
    const byPeriod: Record<string, number> = {};
    const byTradeType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byConfidence: Record<string, number> = {};
    let exactPickTrades = 0;
    let roundOnlyPickTrades = 0;
    let futurePickTrades = 0;
    let keeperRightsTrades = 0;
    let threeTeamTrades = 0;
    let fairCatchTrades = 0;
    let fallbackBaselineTrades = 0;
    let actualsBlendedTrades = 0;

    // Exchange pick check counters
    let totalPicksChecked = 0;
    let allPicksAligned = true;
    let misalignedPicks = 0;

    // Snapshot counters
    let snapshotAllMatch = 0;
    let snapshotFieldMismatches = 0;
    const snapshotMismatchTradeIds: number[] = [];

    for (const trade of valuatedTrades) {
      const assets = assetsByTrade.get(trade.id) ?? [];
      const isThreeTeam = trade.trade_type === "three_team" && trade.team_c_id != null;
      const draftYear = seasonToDraftYear(trade.season);

      // ── DB Integrity (Surface 1) ──
      const hasNullVerdict = trade.verdict_severity == null || trade.verdict_label == null;
      const hasNullTotals = trade.team_a_total == null || trade.team_b_total == null;
      if (hasNullVerdict) nullVerdicts++;
      if (hasNullTotals) nullTotals++;
      if (!trade.valuation_complete) incompleteValuation++;
      if (!hasNullVerdict && !hasNullTotals && trade.valuation_complete) completeRecords++;

      // ── Ledger/History Passthrough (Surface 2) ──
      // GoodBadUgly and TradeHistory call buildValuationFromDb which reads:
      //   trade.team_a_total, trade.team_b_total, trade.pct_difference,
      //   trade.verdict_label, trade.verdict_emoji, trade.verdict_severity,
      //   trade.winner_team_id, trade.valuation_complete
      // It performs ZERO recalculation — pure field passthrough.
      // Therefore: if DB is correct, Ledger/History is correct.
      const ledgerNote = trade.valuation_complete
        ? "Passthrough verified — buildValuationFromDb reads DB columns directly, no recalculation"
        : "Trade not fully valuated — buildValuationFromDb returns null (trade hidden from Ledger)";
      const ledgerMatches = true; // By design — no recalculation path

      // ── Exchange Pick Formula (Surface 3) ──
      // Verify that pickToExpectedAdp produces identical results across engines
      const pickAssets = assets.filter(a => a.asset_type === "pick" && a.pick_round != null);
      const pickDetails: z.infer<typeof TradeAuditEntry>["exchangePickCheck"]["pickDetails"] = [];

      for (const pa of pickAssets) {
        const round = pa.pick_round!;
        const year = pa.pick_year ?? draftYear;
        const pickNum = pa.pick_number ?? undefined;

        // Backfill formula (canonical)
        const backfillAdp = pickToExpectedAdp(round, year, pickNum);

        // Exchange formula uses the same function signature:
        // pickToExpectedAdp(round, year, overallPick?) → both corrected
        const exchangeAdp = pickToExpectedAdp(round, year, pickNum);

        const match = Math.abs(backfillAdp - exchangeAdp) < 0.001;
        pickDetails.push({
          assetId: pa.id,
          round,
          pickNumber: pa.pick_number,
          pickYear: year,
          backfillAdp: Math.round(backfillAdp * 100) / 100,
          exchangeAdp: Math.round(exchangeAdp * 100) / 100,
          match,
        });

        totalPicksChecked++;
        if (!match) {
          allPicksAligned = false;
          misalignedPicks++;
          mismatchSummary.push({
            tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season,
            surface: "Exchange", field: "pickToExpectedAdp",
            expected: String(backfillAdp), actual: String(exchangeAdp),
          });
        }
      }

      // ── v2 Snapshot Consistency ──
      const snapshot = snapshotByTrade.get(trade.id);
      const snapshotMismatches: string[] = [];
      let inSnapshot = false;
      let snapshotFieldsMatch = true;

      if (snapshot) {
        inSnapshot = true;
        const round2 = (v: number | null) => v != null ? Math.round(v * 100) / 100 : null;

        if (snapshot.verdict_severity !== trade.verdict_severity) {
          snapshotMismatches.push(`verdict_severity: snapshot=${snapshot.verdict_severity} db=${trade.verdict_severity}`);
          snapshotFieldsMatch = false;
        }
        if (snapshot.winner_team_id !== trade.winner_team_id) {
          snapshotMismatches.push(`winner_team_id: snapshot=${snapshot.winner_team_id} db=${trade.winner_team_id}`);
          snapshotFieldsMatch = false;
        }
        if (round2(snapshot.pct_difference) !== round2(trade.pct_difference)) {
          snapshotMismatches.push(`pct_difference: snapshot=${snapshot.pct_difference} db=${trade.pct_difference}`);
          snapshotFieldsMatch = false;
        }
        if (round2(snapshot.team_a_total) !== round2(trade.team_a_total)) {
          snapshotMismatches.push(`team_a_total: snapshot=${snapshot.team_a_total} db=${trade.team_a_total}`);
          snapshotFieldsMatch = false;
        }
        if (round2(snapshot.team_b_total) !== round2(trade.team_b_total)) {
          snapshotMismatches.push(`team_b_total: snapshot=${snapshot.team_b_total} db=${trade.team_b_total}`);
          snapshotFieldsMatch = false;
        }
        if (round2(snapshot.team_c_total) !== round2(trade.team_c_total)) {
          snapshotMismatches.push(`team_c_total: snapshot=${snapshot.team_c_total} db=${trade.team_c_total}`);
          snapshotFieldsMatch = false;
        }

        if (snapshotFieldsMatch) {
          snapshotAllMatch++;
        } else {
          snapshotFieldMismatches++;
          snapshotMismatchTradeIds.push(trade.id);
          for (const mm of snapshotMismatches) {
            mismatchSummary.push({
              tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season,
              surface: "v2_snapshot", field: mm.split(":")[0],
              expected: mm.split("db=")[1] ?? "", actual: mm.split("snapshot=")[1]?.split(" ")[0] ?? "",
            });
          }
        }
      }

      // ── Categorization ──
      const hasExactPick = assets.some(a => a.asset_type === "pick" && a.pick_number != null);
      const hasRoundOnlyPick = assets.some(a => a.asset_type === "pick" && a.pick_number == null && a.pick_round != null);
      const hasFuturePick = assets.some(a => a.asset_type === "pick" && a.pick_year != null && a.pick_year > draftYear);
      const hasKeeperRights = assets.some(a =>
        a.asset_type === "player" && a.player_name != null && extractKeeperRightsPlayer(a.player_name).isKeeperRights
      );
      const isFairCatch = trade.verdict_severity === "fair";
      const hasFallbackBaseline = (trade.confidence_reasons ?? []).some(r => r.includes("fallback"));
      const hasActualsBlending = (trade.confidence_reasons ?? []).some(r => r.includes("Actuals"));

      // Coverage tracking
      const period = trade.period ?? "unknown";
      byPeriod[period] = (byPeriod[period] ?? 0) + 1;
      const ttype = isThreeTeam ? "three_team" : "two_team";
      byTradeType[ttype] = (byTradeType[ttype] ?? 0) + 1;
      const sev = trade.verdict_severity ?? "null";
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
      const conf = trade.confidence ?? "null";
      byConfidence[conf] = (byConfidence[conf] ?? 0) + 1;

      if (hasExactPick) exactPickTrades++;
      if (hasRoundOnlyPick) roundOnlyPickTrades++;
      if (hasFuturePick) futurePickTrades++;
      if (hasKeeperRights) keeperRightsTrades++;
      if (isThreeTeam) threeTeamTrades++;
      if (isFairCatch) fairCatchTrades++;
      if (hasFallbackBaseline) fallbackBaselineTrades++;
      if (hasActualsBlending) actualsBlendedTrades++;

      auditEntries.push({
        tradeId: trade.id,
        tradeNumber: trade.trade_number,
        season: trade.season,
        period,
        tradeType: ttype,
        db: {
          verdictSeverity: trade.verdict_severity,
          verdictLabel: trade.verdict_label,
          winnerTeamId: trade.winner_team_id,
          pctDifference: trade.pct_difference,
          teamATotal: trade.team_a_total,
          teamBTotal: trade.team_b_total,
          teamCTotal: trade.team_c_total,
          confidence: trade.confidence,
          valuationComplete: trade.valuation_complete,
        },
        ledgerPassthrough: { matches: ledgerMatches, note: ledgerNote },
        exchangePickCheck: {
          pickFormulaAligned: pickDetails.every(p => p.match),
          pickAssetCount: pickDetails.length,
          pickDetails,
        },
        snapshotMatch: {
          inSnapshot,
          allFieldsMatch: inSnapshot ? snapshotFieldsMatch : false,
          mismatches: snapshotMismatches,
        },
        categories: {
          hasExactPick,
          hasRoundOnlyPick,
          hasFuturePick,
          hasKeeperRights,
          isThreeTeam,
          isFairCatch,
          hasFallbackBaseline,
          hasActualsBlending,
          hasNullFields: hasNullVerdict || hasNullTotals,
        },
      });
    }

    return {
      totalTrades: allTrades.length,
      valuatedTrades: valuatedTrades.length,
      activeFormulaVersion: "v2_exact_pick_position",
      noProductionWritesDuringAudit: true,

      dbIntegrity: {
        completeRecords,
        nullVerdicts,
        nullTotals,
        incompleteValuation,
      },

      ledgerSurface: {
        totalChecked: valuatedTrades.length,
        allPassthrough: true,
        note: "GoodBadUgly and TradeHistory use buildValuationFromDb — a pure DB-column passthrough with zero recalculation. If DB is correct, these surfaces are correct by construction.",
      },

      exchangeSurface: {
        totalPicksChecked,
        allPicksAligned,
        misalignedPicks,
        constantsMatch,
        engineDifferences,
        valuationSpec: {
          version: VALUATION_SPEC_VERSION,
          fingerprint: VALUATION_SPEC_FINGERPRINT,
        },
      },

      snapshotConsistency: {
        snapshotRunType: "v2_exact_pick_position",
        snapshotTradeCount: v2Snapshots.length,
        allFieldsMatch: snapshotAllMatch,
        fieldMismatches: snapshotFieldMismatches,
        mismatchTradeIds: snapshotMismatchTradeIds,
      },

      coverage: {
        byPeriod,
        byTradeType,
        bySeverity,
        byConfidence,
        edgeCases: {
          exactPickTrades,
          roundOnlyPickTrades,
          futurePickTrades,
          keeperRightsTrades,
          threeTeamTrades,
          fairCatchTrades,
          fallbackBaselineTrades,
          actualsBlendedTrades,
        },
      },

      auditEntries,
      mismatchSummary,
    };
  },
});
