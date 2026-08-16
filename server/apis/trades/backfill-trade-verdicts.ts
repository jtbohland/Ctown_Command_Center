import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizeName, extractKeeperRightsPlayer } from "../../lib/normalize-trade-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Value Engine Constants (shared with evaluate-trade.ts) ───
const BASE_VALUE = 10000;
const POWER = 0.6;
const KEEPERS_PER_TEAM = 4;
const RIGHTS_VALUE_MULTIPLIER = 1.0; // exclusive keeper rights = 100% of underlying player

// C-Town league size by draft year (explicit for all configured years)
const LEAGUE_SIZE_BY_YEAR: Record<number, number> = {
  2019: 10, 2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 10,
  2025: 11, 2026: 11, 2027: 11, 2028: 11,
};
const DEFAULT_LEAGUE_SIZE = 11;

// ─── Future-pick time discounts ───
// Applied once: base_pick_value × discount.
// years_ahead = pick_year − reference_draft_year (the trade's valuation year).
const FUTURE_PICK_DISCOUNT: Record<number, number> = {
  0: 1.00,  // same draft year
  1: 0.80,  // one year ahead
  2: 0.65,  // two years ahead
};
const DEFAULT_FUTURE_DISCOUNT = 0.50; // 3+ years ahead

function getFuturePickDiscount(pickYear: number, referenceDraftYear: number): number {
  const yearsAhead = Math.max(0, pickYear - referenceDraftYear);
  return FUTURE_PICK_DISCOUNT[yearsAhead] ?? DEFAULT_FUTURE_DISCOUNT;
}

// ─── Position-specific unranked baselines ───
// Used when a player has a resolved identity but no current-season ADP.
// These represent bottom-tier positional values — never assign zero.
const UNRANKED_BASELINE: Record<string, number> = {
  QB: 175,
  RB: 225,
  WR: 250,
  TE: 200,
  K: 300,
  DEF: 300,
};
const DEFAULT_UNRANKED_BASELINE = 275;

function getUnrankedBaseline(position: string | null): number {
  if (!position) return DEFAULT_UNRANKED_BASELINE;
  return UNRANKED_BASELINE[position.toUpperCase()] ?? DEFAULT_UNRANKED_BASELINE;
}

function getLeagueSize(year: number): number {
  return LEAGUE_SIZE_BY_YEAR[year] ?? DEFAULT_LEAGUE_SIZE;
}

function getKeeperOffset(year: number): number {
  return getLeagueSize(year) * KEEPERS_PER_TEAM;
}

function pickToExpectedAdp(round: number, year: number, pickInRound?: number): number {
  const leagueSize = getLeagueSize(year);
  const startOfRound = (round - 1) * leagueSize + 1;
  const endOfRound = round * leagueSize;
  const draftPosition = pickInRound
    ? startOfRound + pickInRound - 1
    : (startOfRound + endOfRound) / 2;
  return draftPosition + getKeeperOffset(year);
}

function calcValue(adpRank: number): number {
  if (adpRank <= 0) return 0;
  return BASE_VALUE * Math.pow(1 / adpRank, POWER);
}

// ─── Verdict thresholds ───
const FAIR_TOLERANCE = 5;
const VERDICT_SCALE = 1.0;

function getVerdict(pctDiff: number): { label: string; emoji: string; severity: string } {
  const absDiff = Math.abs(pctDiff);
  const t1 = FAIR_TOLERANCE;
  const t2 = FAIR_TOLERANCE + 10 * VERDICT_SCALE;
  const t3 = FAIR_TOLERANCE + 20 * VERDICT_SCALE;
  if (absDiff <= t1) return { label: "Fair Catch", emoji: "🧤", severity: "fair" };
  if (absDiff <= t2) return { label: "Edge Rush", emoji: "📈", severity: "slight" };
  if (absDiff <= t3) return { label: "Pick Six", emoji: "🏆", severity: "clear" };
  return { label: "Flag on the Play", emoji: "🚩", severity: "robbery" };
}

// ─── Season string → draft year (e.g. "2023-24" → 2024) ───
function seasonToDraftYear(season: string): number {
  const parts = season.split("-");
  if (parts.length === 2 && parts[1].length === 2) {
    const prefix = parts[0].substring(0, 2);
    return parseInt(prefix + parts[1], 10);
  }
  return parseInt(parts[0], 10) || 2024;
}

// ─── NFL Season Calendar ───
const NFL_WEEK1_TUESDAY: Record<string, string> = {
  "2018-19": "2018-09-04",
  "2019-20": "2019-09-03",
  "2020-21": "2020-09-08",
  "2021-22": "2021-09-07",
  "2022-23": "2022-09-06",
  "2023-24": "2023-09-05",
  "2024-25": "2024-09-03",
  "2025-26": "2025-09-02",
};

const REGULAR_SEASON_WEEKS: Record<string, number> = {
  "2018-19": 17,
  "2019-20": 17,
  "2020-21": 17, // 2020 NFL season: 16 games / 17 weeks (pre-expansion)
  "2021-22": 18, // 2021 NFL season onward: 17 games / 18 weeks
  "2022-23": 18,
  "2023-24": 18,
  "2024-25": 18,
  "2025-26": 18,
};

function getSeasonPhaseInfo(tradeDate: string, season: string) {
  const week1Tuesday = NFL_WEEK1_TUESDAY[season];
  const totalWeeks = REGULAR_SEASON_WEEKS[season] ?? 18;

  if (!week1Tuesday) {
    return {
      lastCompletedWeek: 0,
      seasonPhase: "preseason" as const,
      actualsWeight: 0,
      totalWeeks,
    };
  }

  const tradeDateMs = new Date(tradeDate).getTime();
  const week1Ms = new Date(week1Tuesday).getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  if (tradeDateMs < week1Ms) {
    return {
      lastCompletedWeek: 0,
      seasonPhase: "preseason" as const,
      actualsWeight: 0,
      totalWeeks,
    };
  }

  const weeksElapsed = Math.floor((tradeDateMs - week1Ms) / msPerWeek);
  const lastCompletedWeek = Math.min(weeksElapsed, totalWeeks);

  let seasonPhase: "preseason" | "early" | "mid" | "late" | "postseason";
  let actualsWeight: number;

  if (lastCompletedWeek === 0) {
    seasonPhase = "preseason";
    actualsWeight = 0;
  } else if (lastCompletedWeek <= 4) {
    seasonPhase = "early";
    actualsWeight = 0.10 + (lastCompletedWeek - 1) * (0.10 / 3);
  } else if (lastCompletedWeek <= 10) {
    seasonPhase = "mid";
    actualsWeight = 0.25 + (lastCompletedWeek - 5) * (0.10 / 5);
  } else if (lastCompletedWeek <= totalWeeks) {
    seasonPhase = "late";
    const lateWeeks = totalWeeks - 11 + 1;
    actualsWeight = 0.40 + (lastCompletedWeek - 11) * (0.10 / (lateWeeks - 1));
    actualsWeight = Math.min(actualsWeight, 0.50);
  } else {
    seasonPhase = "postseason";
    actualsWeight = 0.85;
  }

  if (lastCompletedWeek >= totalWeeks) {
    seasonPhase = "postseason";
    actualsWeight = 0.85;
  }

  actualsWeight = Math.round(actualsWeight * 1000) / 1000;

  return { lastCompletedWeek, seasonPhase, actualsWeight, totalWeeks };
}

// ─── Weekly actuals computation ───
interface WeeklyActualsRow {
  player_name: string;
  position: string;
  season: string;
  week_1: number | null;
  week_2: number | null;
  week_3: number | null;
  week_4: number | null;
  week_5: number | null;
  week_6: number | null;
  week_7: number | null;
  week_8: number | null;
  week_9: number | null;
  week_10: number | null;
  week_11: number | null;
  week_12: number | null;
  week_13: number | null;
  week_14: number | null;
  week_15: number | null;
  week_16: number | null;
  week_17: number | null;
  week_18: number | null;
}

const WeeklyActualsSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  season: z.string(),
  week_1: z.coerce.number().nullable(),
  week_2: z.coerce.number().nullable(),
  week_3: z.coerce.number().nullable(),
  week_4: z.coerce.number().nullable(),
  week_5: z.coerce.number().nullable(),
  week_6: z.coerce.number().nullable(),
  week_7: z.coerce.number().nullable(),
  week_8: z.coerce.number().nullable(),
  week_9: z.coerce.number().nullable(),
  week_10: z.coerce.number().nullable(),
  week_11: z.coerce.number().nullable(),
  week_12: z.coerce.number().nullable(),
  week_13: z.coerce.number().nullable(),
  week_14: z.coerce.number().nullable(),
  week_15: z.coerce.number().nullable(),
  week_16: z.coerce.number().nullable(),
  week_17: z.coerce.number().nullable(),
  week_18: z.coerce.number().nullable(),
});

function computeThroughCutoff(row: WeeklyActualsRow, lastWeek: number) {
  let total = 0;
  let games = 0;

  const weekValues: (number | null)[] = [
    row.week_1, row.week_2, row.week_3, row.week_4,
    row.week_5, row.week_6, row.week_7, row.week_8,
    row.week_9, row.week_10, row.week_11, row.week_12,
    row.week_13, row.week_14, row.week_15, row.week_16,
    row.week_17, row.week_18,
  ];

  for (let w = 0; w < lastWeek && w < weekValues.length; w++) {
    const pts = weekValues[w];
    if (pts !== null && pts !== undefined) {
      total += pts;
      games++;
    }
  }

  const ppg = games > 0 ? Math.round((total / games) * 100) / 100 : 0;
  total = Math.round(total * 100) / 100;

  return { totalPoints: total, gamesPlayed: games, ppg };
}

function computePositionalPercentiles(
  players: Array<{
    normalizedName: string;
    position: string;
    totalPoints: number;
    ppg: number;
    gamesPlayed: number;
  }>,
): Map<string, number> {
  const byPosition = new Map<string, typeof players>();
  for (const p of players) {
    const pos = p.position.toUpperCase();
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(p);
  }

  const result = new Map<string, number>();

  for (const [, group] of byPosition.entries()) {
    const totalInPos = group.length;

    const byPts = [...group].sort((a, b) => b.totalPoints - a.totalPoints);
    const ptsRankMap = new Map<string, number>();
    byPts.forEach((p, i) => ptsRankMap.set(p.normalizedName, i + 1));

    const byPpg = [...group].filter(p => p.gamesPlayed > 0).sort((a, b) => b.ppg - a.ppg);
    const ppgRankMap = new Map<string, number>();
    const ppgTotal = byPpg.length;
    byPpg.forEach((p, i) => ppgRankMap.set(p.normalizedName, i + 1));

    for (const p of group) {
      const ptsRank = ptsRankMap.get(p.normalizedName) ?? totalInPos;
      const ppgRank = ppgRankMap.get(p.normalizedName) ?? ppgTotal;

      const totalPtsPercentile = Math.round(
        ((totalInPos - ptsRank + 1) / totalInPos) * 100 * 10
      ) / 10;
      const ppgPercentile = ppgTotal > 0
        ? Math.round(((ppgTotal - ppgRank + 1) / ppgTotal) * 100 * 10) / 10
        : 0;

      const actualsValue = Math.round(
        (0.60 * totalPtsPercentile + 0.40 * ppgPercentile) * 10
      ) / 10;

      result.set(p.normalizedName, actualsValue);
    }
  }

  return result;
}

// ─── Identity and ADP Status Types ───
type IdentityStatus = "resolved" | "resolved_identity_no_coverage" | "unresolved" | "keeper_rights";
type AdpStatus =
  | "current_season_adp"
  | "adp_table_match_after_alias"
  | "no_current_season_adp"
  | "historical_adp_exists"
  | "outside_export_range"
  | "not_found_in_uploaded_adp_exports";
type FallbackType =
  | "none"
  | "adp_table_match_after_alias"
  | "position_baseline_fallback"
  | "resolved_identity_no_coverage";
type Confidence = "high" | "medium" | "low";

// ─── Schemas ───
const TradeRow = z.object({
  id: z.coerce.number(),
  trade_number: z.coerce.number(),
  season: z.string(),
  trade_date: z.string().nullable(),
  team_a_id: z.coerce.number(),
  team_b_id: z.coerce.number(),
  trade_type: z.string().nullable(),
  team_c_id: z.coerce.number().nullable(),
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
  position: z.string(),
});

const VerdictResult = z.object({
  tradeId: z.number(),
  tradeNumber: z.number(),
  season: z.string(),
  verdictLabel: z.string(),
  verdictEmoji: z.string(),
  verdictSeverity: z.string(),
  winnerTeamId: z.number().nullable(),
  pctDifference: z.number(),
  absoluteGap: z.number(),
  relativeGap: z.number(),
  teamATotal: z.number(),
  teamBTotal: z.number(),
  teamCTotal: z.number().nullable(),
  status: z.enum(["valued", "incomplete", "skipped"]),
  reason: z.string().nullable(),
  blendInfo: z.string().nullable(),
  identityStatus: z.string(),
  adpStatus: z.string(),
  fallbackUsed: z.boolean(),
  actualsUsed: z.boolean(),
  rightsUsed: z.boolean(),
  confidence: z.string(),
  confidenceReasons: z.array(z.string()),
  unresolvedAssetCount: z.number(),
  unresolvedAssetNames: z.array(z.string()),
  rightsAssumptions: z.array(z.string()),
});

// ─── Per-asset detail for audit trail ───
interface AssetDetail {
  assetId: number;
  playerName: string | null;
  assetType: string;
  identityStatus: IdentityStatus;
  adpStatus: AdpStatus;
  fallbackType: FallbackType;
  value: number;
  resolved: boolean;
  usedFallback: boolean;
  blended: boolean;
  confidence: Confidence;
  isKeeperRights: boolean;
  underlyingPlayer: string | null;
  rightsAssumption: string | null;
  fallbackBaseline: number | null;
  matchedAdpName: string | null;
  matchedAdpRank: number | null;
  // Pick discount audit fields
  futureDiscount: number | null;
  valueBeforeDiscount: number | null;
  yearsAhead: number | null;
}

// ─── Summary schemas for the report ───
const UnresolvedAssetEntry = z.object({
  tradeId: z.number(),
  tradeNumber: z.number(),
  season: z.string(),
  playerName: z.string(),
  identityStatus: z.string(),
  adpStatus: z.string(),
});

const AssetDetailEntry = z.object({
  tradeId: z.number(),
  tradeNumber: z.number(),
  season: z.string(),
  tradeDate: z.string().nullable(),
  assetId: z.number(),
  playerName: z.string().nullable(),
  assetType: z.string(),
  fromTeamId: z.number(),
  identityStatus: z.string(),
  adpStatus: z.string(),
  fallbackType: z.string(),
  value: z.number(),
  resolved: z.boolean(),
  usedFallback: z.boolean(),
  blended: z.boolean(),
  confidence: z.string(),
  isKeeperRights: z.boolean(),
  underlyingPlayer: z.string().nullable(),
  rightsAssumption: z.string().nullable(),
  fallbackBaseline: z.number().nullable(),
  matchedAdpName: z.string().nullable(),
  matchedAdpRank: z.number().nullable(),
  // Pick-specific fields
  pickYear: z.number().nullable(),
  pickRound: z.number().nullable(),
  pickNumber: z.number().nullable(),
  pickExpectedAdp: z.number().nullable(),
  // Pick discount audit fields
  futureDiscount: z.number().nullable(),
  valueBeforeDiscount: z.number().nullable(),
  yearsAhead: z.number().nullable(),
  // Actuals detail
  actualsPercentile: z.number().nullable(),
  actualsWeight: z.number().nullable(),
  seasonPhase: z.string().nullable(),
  lastCompletedWeek: z.number().nullable(),
});

export default api({
  name: "BackfillTradeVerdicts",
  description: "Batch-evaluates all historical trades with enhanced identity/ADP status, fallback baselines, and actuals blending.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    dryRun: z.boolean().optional(),
    forceRecompute: z.boolean().optional(),
  }),

  output: z.object({
    totalTrades: z.number(),
    valued: z.number(),
    incomplete: z.number(),
    skipped: z.number(),
    adpFallbacksUsed: z.number(),
    actualsBlendedCount: z.number(),
    fallbackBaselineCount: z.number(),
    rightsValuedCount: z.number(),
    results: z.array(VerdictResult),
    // Summary sections for the dry-run report
    unresolvedAssets: z.array(UnresolvedAssetEntry),
    uniqueUnresolvedNames: z.array(z.string()),
    tradesWithFallback: z.array(z.number()),
    tradesGenuinelyBlocked: z.array(z.number()),
    // Per-asset detail for full audit report
    assetDetails: z.array(AssetDetailEntry),
  }),

  async run(ctx, { dryRun, forceRecompute }) {
    // ── Step 1: Ensure verdict columns exist ──
    await ctx.integrations.apps_db.execute(
      `ALTER TABLE ffwr_trades
       ADD COLUMN IF NOT EXISTS verdict_label TEXT,
       ADD COLUMN IF NOT EXISTS verdict_emoji TEXT,
       ADD COLUMN IF NOT EXISTS verdict_severity TEXT,
       ADD COLUMN IF NOT EXISTS winner_team_id INTEGER,
       ADD COLUMN IF NOT EXISTS pct_difference NUMERIC,
       ADD COLUMN IF NOT EXISTS team_a_total NUMERIC,
       ADD COLUMN IF NOT EXISTS team_b_total NUMERIC`,
      undefined,
      { label: "Ensure verdict columns exist" }
    );

    // ── Step 2: Load all trades ──
    const whereClause = forceRecompute
      ? ""
      : "WHERE valuation_complete IS NOT TRUE";

    const trades = await ctx.integrations.apps_db.query(
      `SELECT id, trade_number, season, trade_date::text as trade_date,
              team_a_id, team_b_id, trade_type, team_c_id
       FROM ffwr_trades ${whereClause}
       ORDER BY id`,
      TradeRow,
      undefined,
      { label: "Load trades to evaluate" }
    );

    if (trades.length === 0) {
      return {
        totalTrades: 0, valued: 0, incomplete: 0, skipped: 0,
        adpFallbacksUsed: 0, actualsBlendedCount: 0,
        fallbackBaselineCount: 0, rightsValuedCount: 0,
        results: [],
        unresolvedAssets: [], uniqueUnresolvedNames: [],
        tradesWithFallback: [], tradesGenuinelyBlocked: [],
        assetDetails: [],
      };
    }

    // ── Step 3: Load all trade assets ──
    const tradeIds = trades.map((t) => t.id);
    const allAssets = await ctx.integrations.apps_db.query(
      `SELECT id, trade_id, from_team_id, asset_type, player_name,
              player_position, player_adp_at_trade, pick_year, pick_round, pick_number
       FROM ffwr_trade_assets
       WHERE trade_id = ANY($1::int[])
       ORDER BY trade_id, id`,
      AssetRow,
      [tradeIds],
      { label: "Load all trade assets" }
    );

    const assetsByTrade = new Map<number, z.infer<typeof AssetRow>[]>();
    for (const asset of allAssets) {
      if (!assetsByTrade.has(asset.trade_id)) assetsByTrade.set(asset.trade_id, []);
      assetsByTrade.get(asset.trade_id)!.push(asset);
    }

    // ── Step 4: Load ADP data for ALL seasons (increased limit) ──
    const seasonsNeeded = new Set<string>();
    for (const t of trades) seasonsNeeded.add(t.season);

    // Maps: season → (normalizedName → { adp_rank, position })
    const adpBySeason = new Map<string, Map<string, { adp: number; position: string }>>();

    // Also collect all ADP across all seasons for historical existence checks
    const allAdpNamesEver = new Set<string>();

    for (const season of seasonsNeeded) {
      const adpRows = await ctx.integrations.apps_db.query(
        `SELECT player_name, adp_rank, position
         FROM ffwr_historical_adp WHERE season = $1
         ORDER BY adp_rank LIMIT 1000`,
        AdpRow,
        [season],
        { label: `Load ADP for ${season}` }
      );
      const seasonMap = new Map<string, { adp: number; position: string }>();
      for (const row of adpRows) {
        const norm = normalizeName(row.player_name);
        seasonMap.set(norm, { adp: row.adp_rank, position: row.position });
        allAdpNamesEver.add(norm);
      }
      adpBySeason.set(season, seasonMap);
      ctx.log.info(`ADP ${season}: ${adpRows.length} players loaded`);
    }

    // Also load ADP seasons NOT in the trade set for historical existence checks
    const allAdpSeasons = await ctx.integrations.apps_db.query(
      `SELECT DISTINCT season FROM ffwr_historical_adp`,
      z.object({ season: z.string() }),
      undefined,
      { label: "List all ADP seasons" }
    );

    for (const { season } of allAdpSeasons) {
      if (!adpBySeason.has(season)) {
        const adpRows = await ctx.integrations.apps_db.query(
          `SELECT player_name, adp_rank, position
           FROM ffwr_historical_adp WHERE season = $1
           ORDER BY adp_rank LIMIT 1000`,
          AdpRow,
          [season],
          { label: `Load historical ADP for ${season}` }
        );
        for (const row of adpRows) {
          allAdpNamesEver.add(normalizeName(row.player_name));
        }
      }
    }

    // ── Step 5: Load weekly actuals for in-season trades ──
    const actualsSeasons = new Set<string>();
    for (const t of trades) {
      if (t.trade_date) {
        const phaseInfo = getSeasonPhaseInfo(t.trade_date, t.season);
        if (phaseInfo.lastCompletedWeek > 0) {
          actualsSeasons.add(t.season);
        }
      }
    }

    // Also load actuals for fallback-path players (no ADP but have actuals)
    // We need actuals from all seasons to check existence
    const allActualsSeasons = await ctx.integrations.apps_db.query(
      `SELECT DISTINCT season FROM ffwr_season_actuals`,
      z.object({ season: z.string() }),
      undefined,
      { label: "List all actuals seasons" }
    );

    for (const { season } of allActualsSeasons) {
      actualsSeasons.add(season);
    }

    const actualsBySeason = new Map<string, WeeklyActualsRow[]>();
    const allActualsNamesEver = new Set<string>();

    for (const season of actualsSeasons) {
      const rows = await ctx.integrations.apps_db.query(
        `SELECT player_name, position, season,
                week_1, week_2, week_3, week_4, week_5, week_6,
                week_7, week_8, week_9, week_10, week_11, week_12,
                week_13, week_14, week_15, week_16, week_17, week_18
         FROM ffwr_season_actuals
         WHERE season = $1
         ORDER BY overall_rank`,
        WeeklyActualsSchema,
        [season],
        { label: `Load weekly actuals for ${season}` }
      );
      actualsBySeason.set(season, rows);
      for (const row of rows) {
        allActualsNamesEver.add(normalizeName(row.player_name));
      }
      ctx.log.info(`Actuals ${season}: ${rows.length} players loaded`);
    }

    // ── Step 6: Evaluate each trade ──
    const results: z.infer<typeof VerdictResult>[] = [];
    const allUnresolvedAssets: z.infer<typeof UnresolvedAssetEntry>[] = [];
    let valued = 0;
    let incomplete = 0;
    let skipped = 0;
    let adpFallbacksUsed = 0;
    let actualsBlendedCount = 0;
    let fallbackBaselineCount = 0;
    let rightsValuedCount = 0;
    const tradesWithFallbackSet = new Set<number>();
    const tradesGenuinelyBlockedSet = new Set<number>();
    const allAssetDetails: z.infer<typeof AssetDetailEntry>[] = [];

    for (const trade of trades) {
      const assets = assetsByTrade.get(trade.id) ?? [];

      if (assets.length === 0) {
        skipped++;
        results.push({
          tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season,
          verdictLabel: "No Assets", verdictEmoji: "❓", verdictSeverity: "unknown",
          winnerTeamId: null, pctDifference: 0, absoluteGap: 0, relativeGap: 0,
          teamATotal: 0, teamBTotal: 0, teamCTotal: null,
          status: "skipped", reason: "No assets found for this trade", blendInfo: null,
          identityStatus: "resolved", adpStatus: "current_season_adp",
          fallbackUsed: false, actualsUsed: false, rightsUsed: false,
          confidence: "high", confidenceReasons: [], unresolvedAssetCount: 0, unresolvedAssetNames: [],
          rightsAssumptions: [],
        });
        continue;
      }

      const draftYear = seasonToDraftYear(trade.season);
      const isThreeTeam = trade.trade_type === "three_team" && trade.team_c_id != null;
      const seasonAdpMap = adpBySeason.get(trade.season);

      // ── Determine actuals blend for this trade ──
      let phaseInfo: { lastCompletedWeek: number; seasonPhase: string; actualsWeight: number; totalWeeks: number } =
        { lastCompletedWeek: 0, seasonPhase: "preseason", actualsWeight: 0, totalWeeks: 18 };
      let actualsPercentiles: Map<string, number> | null = null;
      let blendInfo: string | null = null;

      if (trade.trade_date) {
        phaseInfo = getSeasonPhaseInfo(trade.trade_date, trade.season);

        if (phaseInfo.lastCompletedWeek > 0 && phaseInfo.actualsWeight > 0) {
          const seasonActuals = actualsBySeason.get(trade.season);
          if (seasonActuals && seasonActuals.length > 0) {
            const weekCutoff = phaseInfo.seasonPhase === "postseason"
              ? phaseInfo.totalWeeks
              : phaseInfo.lastCompletedWeek;

            const allPlayerStats: Array<{
              normalizedName: string;
              position: string;
              totalPoints: number;
              ppg: number;
              gamesPlayed: number;
            }> = [];

            for (const row of seasonActuals) {
              const cutoffStats = computeThroughCutoff(row, weekCutoff);
              allPlayerStats.push({
                normalizedName: normalizeName(row.player_name),
                position: row.position.toUpperCase(),
                ...cutoffStats,
              });
            }

            actualsPercentiles = computePositionalPercentiles(allPlayerStats);
            blendInfo = `${phaseInfo.seasonPhase} wk${phaseInfo.lastCompletedWeek} weight=${phaseInfo.actualsWeight}`;
          }
        }
      }

      // ── Enhanced resolvePlayerValue ──
      // Separates identity status from ADP status. Uses position-specific
      // unranked baseline when identity resolves but no current-season ADP.
      function resolvePlayerValue(asset: z.infer<typeof AssetRow>): AssetDetail {
        const playerName = asset.player_name;
        if (!playerName) {
          return {
            assetId: asset.id,
            playerName: null,
            assetType: asset.asset_type,
            identityStatus: "unresolved",
            adpStatus: "not_found_in_uploaded_adp_exports",
            fallbackType: "none",
            value: 0,
            resolved: false,
            usedFallback: false,
            blended: false,
            confidence: "low",
            isKeeperRights: false,
            underlyingPlayer: null,
            rightsAssumption: null,
            fallbackBaseline: null,
            matchedAdpName: null,
            matchedAdpRank: null,
            futureDiscount: null,
            valueBeforeDiscount: null,
            yearsAhead: null,
          };
        }

        const nameNorm = normalizeName(playerName);
        let adp = asset.player_adp_at_trade;
        let usedFallback = false;
        let identityStatus: IdentityStatus = "resolved";
        let adpStatus: AdpStatus = "current_season_adp";
        let fallbackType: FallbackType = "none";
        let confidence: Confidence = "high";
        let position = asset.player_position;
        let fallbackBaseline: number | null = null;
        let matchedAdpName: string | null = null;
        let matchedAdpRank: number | null = null;

        // Step A: Try to find current-season ADP (from stored value or table lookup)
        if (adp != null && adp > 0) {
          // Stored ADP from trade asset — direct match
          matchedAdpRank = adp;
        } else if (seasonAdpMap) {
          const lookup = seasonAdpMap.get(nameNorm);
          if (lookup) {
            adp = lookup.adp;
            position = position ?? lookup.position;
            matchedAdpRank = lookup.adp;
            // This is an ADP table match (possibly after alias normalization)
            // It is NOT a fallback — it's a real current-season ADP match.
            adpStatus = "adp_table_match_after_alias";
            fallbackType = "adp_table_match_after_alias";
            // Find the original ADP name for audit
            for (const [origName, entry] of Object.entries(Object.fromEntries(seasonAdpMap))) {
              if (origName === nameNorm) {
                // We can't recover the original ADP name from the normalized map directly,
                // but the match itself is confirmed. Log the normalized key.
                matchedAdpName = playerName; // original trade name that resolved
                break;
              }
            }
            usedFallback = false; // NOT a fallback — real ADP match
          }
        }

        // Step B: Determine identity + ADP status
        if (adp != null && adp > 0) {
          // Has current-season ADP → resolved identity
          identityStatus = "resolved";
          if (adpStatus !== "adp_table_match_after_alias") {
            adpStatus = "current_season_adp";
          }
          confidence = "high";
        } else {
          // No current-season ADP — check if identity resolves elsewhere
          const hasHistoricalAdp = allAdpNamesEver.has(nameNorm);
          const hasActuals = allActualsNamesEver.has(nameNorm);

          if (hasHistoricalAdp || hasActuals) {
            // Identity resolves — player exists in our data, just not in current-season ADP
            identityStatus = "resolved";
            adpStatus = hasHistoricalAdp ? "outside_export_range" : "no_current_season_adp";
            fallbackType = "position_baseline_fallback";
            confidence = "low";

            // Try to recover position from actuals if we don't have it
            if (!position) {
              for (const [, actualsRows] of actualsBySeason.entries()) {
                for (const row of actualsRows) {
                  if (normalizeName(row.player_name) === nameNorm) {
                    position = row.position;
                    break;
                  }
                }
                if (position) break;
              }
            }

            const baselineRank = getUnrankedBaseline(position);
            fallbackBaseline = baselineRank;
            adp = baselineRank;
            usedFallback = true;
          } else {
            // No ADP or actuals anywhere — but identity may still be known
            // (e.g., player was drafted in the NFL but never reached fantasy ADP/actuals thresholds)
            // Treat as resolved_identity_no_coverage: use position baseline, never assign zero
            identityStatus = "resolved_identity_no_coverage";
            adpStatus = "not_found_in_uploaded_adp_exports";
            fallbackType = "resolved_identity_no_coverage";
            confidence = "low";

            // Recover position from the asset record if available
            const baselineRank = getUnrankedBaseline(position);
            fallbackBaseline = baselineRank;
            adp = baselineRank;
            usedFallback = true;
          }
        }

        // Step C: Calculate base value
        const baselineValue = calcValue(adp!);

        // Step D: Apply actuals blend if in-season and we have percentile data
        if (actualsPercentiles && phaseInfo.actualsWeight > 0) {
          const actualsVal = actualsPercentiles.get(nameNorm);
          if (actualsVal != null && actualsVal > 0) {
            const totalAdpPlayers = 300;
            const actualsAdpEquiv = Math.max(1, Math.round(totalAdpPlayers * (1 - actualsVal / 100) + 1));
            const actualsBaseValue = calcValue(actualsAdpEquiv);

            const blendedValue =
              baselineValue * (1 - phaseInfo.actualsWeight) +
              actualsBaseValue * phaseInfo.actualsWeight;

            return {
              assetId: asset.id,
              playerName,
              assetType: asset.asset_type,
              identityStatus,
              adpStatus,
              fallbackType,
              value: blendedValue,
              resolved: true,
              usedFallback,
              blended: true,
              confidence: fallbackBaseline != null ? "low" : (confidence === "high" ? "medium" : confidence),
              isKeeperRights: false,
              underlyingPlayer: null,
              rightsAssumption: null,
              fallbackBaseline,
              matchedAdpName,
              matchedAdpRank,
              futureDiscount: null,
              valueBeforeDiscount: null,
              yearsAhead: null,
            };
          }
        }

        return {
          assetId: asset.id,
          playerName,
          assetType: asset.asset_type,
          identityStatus,
          adpStatus,
          fallbackType,
          value: baselineValue,
          resolved: true,
          usedFallback,
          blended: false,
          confidence,
          isKeeperRights: false,
          underlyingPlayer: null,
          rightsAssumption: null,
          fallbackBaseline,
          matchedAdpName,
          matchedAdpRank,
          futureDiscount: null,
          valueBeforeDiscount: null,
          yearsAhead: null,
        };
      }

      function valueAsset(asset: z.infer<typeof AssetRow>): AssetDetail {
        if (asset.asset_type === "player") {
          const playerName = asset.player_name ?? "";
          const krResult = extractKeeperRightsPlayer(playerName);

          if (krResult.isKeeperRights && krResult.underlyingPlayer) {
            // Value the underlying player with normal production function
            const underlyingName = krResult.underlyingPlayer;
            const syntheticAsset = { ...asset, player_name: underlyingName };
            const underlying = resolvePlayerValue(syntheticAsset);

            return {
              ...underlying,
              value: underlying.value * RIGHTS_VALUE_MULTIPLIER,
              isKeeperRights: true,
              underlyingPlayer: underlyingName,
              identityStatus: "keeper_rights",
              rightsAssumption: `exclusive_keeper_rights valued at ${RIGHTS_VALUE_MULTIPLIER * 100}% of underlying player (${underlyingName}), ADP-based value=${Math.round(underlying.value)}`,
            };
          }

          return resolvePlayerValue(asset);
        }

        // Pick asset — always resolved
        const year = asset.pick_year ?? draftYear;
        const round = asset.pick_round ?? 6;
        const pickNum = asset.pick_number ?? undefined;
        const basePickValue = calcValue(pickToExpectedAdp(round, year, pickNum));
        const discount = getFuturePickDiscount(year, draftYear);
        const yearsAhead = Math.max(0, year - draftYear);
        return {
          assetId: asset.id,
          playerName: asset.player_name,
          assetType: "pick",
          identityStatus: "resolved",
          adpStatus: "current_season_adp",
          fallbackType: "none" as FallbackType,
          value: basePickValue * discount,
          resolved: true,
          usedFallback: false,
          blended: false,
          confidence: "high",
          isKeeperRights: false,
          underlyingPlayer: null,
          rightsAssumption: null,
          fallbackBaseline: null,
          matchedAdpName: null,
          matchedAdpRank: null,
          futureDiscount: discount,
          valueBeforeDiscount: basePickValue,
          yearsAhead,
        };
      }

      // ── Evaluate all assets for this trade ──
      const assetDetails: AssetDetail[] = [];
      for (const asset of assets) {
        assetDetails.push(valueAsset(asset));
      }

      // ── Collect per-asset detail entries for audit report ──
      for (const ad of assetDetails) {
        const asset = assets.find(a => a.id === ad.assetId)!;
        const actualsPercentileValue = actualsPercentiles && ad.playerName
          ? actualsPercentiles.get(normalizeName(ad.playerName)) ?? null
          : null;
        allAssetDetails.push({
          tradeId: trade.id,
          tradeNumber: trade.trade_number,
          season: trade.season,
          tradeDate: trade.trade_date,
          assetId: ad.assetId,
          playerName: ad.playerName,
          assetType: ad.assetType,
          fromTeamId: asset.from_team_id,
          identityStatus: ad.identityStatus,
          adpStatus: ad.adpStatus,
          fallbackType: ad.fallbackType,
          value: Math.round(ad.value * 100) / 100,
          resolved: ad.resolved,
          usedFallback: ad.usedFallback,
          blended: ad.blended,
          confidence: ad.confidence,
          isKeeperRights: ad.isKeeperRights,
          underlyingPlayer: ad.underlyingPlayer,
          rightsAssumption: ad.rightsAssumption,
          fallbackBaseline: ad.fallbackBaseline,
          matchedAdpName: ad.matchedAdpName,
          matchedAdpRank: ad.matchedAdpRank,
          pickYear: asset.pick_year,
          pickRound: asset.pick_round,
          pickNumber: asset.pick_number,
          pickExpectedAdp: ad.assetType === "pick"
            ? pickToExpectedAdp(asset.pick_round ?? 6, asset.pick_year ?? draftYear, asset.pick_number ?? undefined)
            : null,
          futureDiscount: ad.futureDiscount,
          valueBeforeDiscount: ad.valueBeforeDiscount != null ? Math.round(ad.valueBeforeDiscount * 100) / 100 : null,
          yearsAhead: ad.yearsAhead,
          actualsPercentile: actualsPercentileValue,
          actualsWeight: ad.blended ? phaseInfo.actualsWeight : null,
          seasonPhase: phaseInfo.seasonPhase,
          lastCompletedWeek: phaseInfo.lastCompletedWeek,
        });
      }

      // Aggregate per-trade status fields
      // Only truly unresolved if identityStatus is literally "unresolved" (which no longer happens
      // since resolved_identity_no_coverage now produces a value). Keep this for backwards compat.
      const tradeUnresolved = assetDetails.filter(a => !a.resolved && a.assetType === "player");
      const tradeFallbackUsed = assetDetails.some(a => a.usedFallback);
      const tradeActualsUsed = assetDetails.some(a => a.blended);
      const tradeRightsUsed = assetDetails.some(a => a.isKeeperRights);
      const tradeRightsAssumptions = assetDetails
        .filter(a => a.rightsAssumption)
        .map(a => a.rightsAssumption!);

      // Track unresolved for summary
      for (const ur of tradeUnresolved) {
        allUnresolvedAssets.push({
          tradeId: trade.id,
          tradeNumber: trade.trade_number,
          season: trade.season,
          playerName: ur.playerName ?? "unknown",
          identityStatus: ur.identityStatus,
          adpStatus: ur.adpStatus,
        });
      }

      // Track counters
      for (const ad of assetDetails) {
        if (ad.usedFallback) adpFallbacksUsed++;
        if (ad.blended) actualsBlendedCount++;
        if (ad.fallbackBaseline != null) fallbackBaselineCount++;
        if (ad.isKeeperRights) rightsValuedCount++;
      }

      if (tradeFallbackUsed) tradesWithFallbackSet.add(trade.id);

      // Determine worst confidence among resolved assets
      let tradeConfidence: Confidence = "high";
      for (const ad of assetDetails) {
        if (ad.confidence === "low") { tradeConfidence = "low"; break; }
        if (ad.confidence === "medium") tradeConfidence = "medium";
      }

      // Compute human-readable confidence reasons
      const confidenceReasons: string[] = [];
      const hasBlended = assetDetails.some(ad => ad.blended);
      if (hasBlended && phaseInfo) {
        confidenceReasons.push(`In-season Actuals were available only through Week ${phaseInfo.lastCompletedWeek}`);
      }
      if (assetDetails.some(ad => ad.fallbackBaseline != null)) {
        confidenceReasons.push("One or more player assets used a position-specific fallback");
      }
      if (assetDetails.some(ad => ad.adpStatus === "no_current_season_adp" || ad.adpStatus === "outside_export_range")) {
        confidenceReasons.push("Current-season ADP was unavailable, but Actuals or historical data were available");
      }
      if (assetDetails.some(ad => ad.adpStatus === "adp_table_match_after_alias")) {
        confidenceReasons.push("A player name was matched through an approved alias");
      }
      if (assetDetails.some(ad => ad.assetType === "pick")) {
        const hasRoundOnly = assets.some(a => a.asset_type === "pick" && a.pick_number == null && a.pick_round != null);
        const hasFutureDiscount = assetDetails.some(ad => ad.futureDiscount != null && ad.futureDiscount < 1);
        if (hasRoundOnly || hasFutureDiscount) {
          confidenceReasons.push("A future or round-only pick required midpoint valuation and/or a future-year discount");
        }
      }
      if (assetDetails.some(ad => ad.isKeeperRights)) {
        confidenceReasons.push("The trade included exclusive keeper rights");
      }
      if (isThreeTeam) {
        confidenceReasons.push("The trade was a three-team transaction");
      }
      if (assetDetails.some(ad => ad.identityStatus === "resolved_identity_no_coverage")) {
        confidenceReasons.push("One or more assets had limited source coverage");
      }

      // Determine composite identity/adp status for the trade
      let tradeIdentityStatus: string = "resolved";
      let tradeAdpStatus: string = "current_season_adp";
      for (const ad of assetDetails) {
        if (ad.identityStatus === "unresolved") tradeIdentityStatus = "unresolved";
        else if (ad.identityStatus === "resolved_identity_no_coverage" && tradeIdentityStatus !== "unresolved") tradeIdentityStatus = "resolved_identity_no_coverage";
        else if (ad.identityStatus === "keeper_rights" && tradeIdentityStatus !== "unresolved" && tradeIdentityStatus !== "resolved_identity_no_coverage") tradeIdentityStatus = "keeper_rights";

        if (ad.adpStatus === "not_found_in_uploaded_adp_exports") tradeAdpStatus = "not_found_in_uploaded_adp_exports";
        else if (ad.adpStatus === "outside_export_range" && tradeAdpStatus !== "not_found_in_uploaded_adp_exports") tradeAdpStatus = "outside_export_range";
        else if (ad.adpStatus === "historical_adp_exists" && tradeAdpStatus !== "not_found_in_uploaded_adp_exports" && tradeAdpStatus !== "outside_export_range") tradeAdpStatus = "historical_adp_exists";
        else if (ad.adpStatus === "no_current_season_adp" && tradeAdpStatus === "current_season_adp") tradeAdpStatus = "no_current_season_adp";
        else if (ad.adpStatus === "adp_table_match_after_alias" && tradeAdpStatus === "current_season_adp") tradeAdpStatus = "adp_table_match_after_alias";
      }

      // ── Compute team totals and verdict ──
      if (isThreeTeam) {
        const teamIds = [trade.team_a_id, trade.team_b_id, trade.team_c_id!];
        const totals = new Map<number, number>();
        for (const tid of teamIds) totals.set(tid, 0);

        for (const ad of assetDetails) {
          if (!ad.resolved && ad.assetType === "player") continue; // skip truly unresolved
          const asset = assets.find(a => a.id === ad.assetId)!;
          totals.set(asset.from_team_id, (totals.get(asset.from_team_id) ?? 0) + ad.value);
        }

        const teamATotal = totals.get(trade.team_a_id) ?? 0;
        const teamBTotal = totals.get(trade.team_b_id) ?? 0;
        const teamCTotal = totals.get(trade.team_c_id!) ?? 0;
        const allTotals = Array.from(totals.entries());
        const avgTotal = allTotals.reduce((s, [, v]) => s + v, 0) / 3;

        const unresolvedCount = tradeUnresolved.length;
        const totalAssetCount = assetDetails.length;

        if (unresolvedCount === totalAssetCount) {
          incomplete++;
          tradesGenuinelyBlockedSet.add(trade.id);
          results.push({
            tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season,
            verdictLabel: "Data Incomplete", verdictEmoji: "⚠️", verdictSeverity: "incomplete",
            winnerTeamId: null, pctDifference: 0, absoluteGap: 0, relativeGap: 0,
            teamATotal, teamBTotal, teamCTotal,
            status: "incomplete", reason: `All ${totalAssetCount} assets unresolved`, blendInfo,
            identityStatus: tradeIdentityStatus, adpStatus: tradeAdpStatus,
            fallbackUsed: tradeFallbackUsed, actualsUsed: tradeActualsUsed, rightsUsed: tradeRightsUsed,
            confidence: tradeConfidence,
            confidenceReasons,
            unresolvedAssetCount: unresolvedCount,
            unresolvedAssetNames: tradeUnresolved.map(u => u.playerName ?? "unknown"),
            rightsAssumptions: tradeRightsAssumptions,
          });
          continue;
        }

        const sorted = allTotals.sort((a, b) => a[1] - b[1]);
        const bestDealTeamId = sorted[0][0];
        const pctSpread = avgTotal > 0 ? ((sorted[2][1] - sorted[0][1]) / avgTotal) * 100 : 0;
        const absoluteGap = sorted[2][1] - sorted[0][1];

        const hasUnresolved = unresolvedCount > 0;
        const verdict = hasUnresolved
          ? { label: "Data Incomplete", emoji: "⚠️", severity: "incomplete" }
          : getVerdict(pctSpread);

        const winnerTeamId = hasUnresolved ? null : (Math.abs(pctSpread) > FAIR_TOLERANCE ? bestDealTeamId : null);
        const status = hasUnresolved ? "incomplete" as const : "valued" as const;

        if (status === "valued") valued++;
        else { incomplete++; tradesGenuinelyBlockedSet.add(trade.id); }

        results.push({
          tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season,
          verdictLabel: verdict.label, verdictEmoji: verdict.emoji, verdictSeverity: verdict.severity,
          winnerTeamId,
          pctDifference: Math.round(pctSpread * 10) / 10,
          absoluteGap: Math.round(absoluteGap * 100) / 100,
          relativeGap: Math.round(pctSpread * 10) / 10,
          teamATotal: Math.round(teamATotal * 100) / 100,
          teamBTotal: Math.round(teamBTotal * 100) / 100,
          teamCTotal: Math.round(teamCTotal * 100) / 100,
          status,
          reason: hasUnresolved ? `${unresolvedCount}/${totalAssetCount} assets unresolved` : null,
          blendInfo,
          identityStatus: tradeIdentityStatus, adpStatus: tradeAdpStatus,
          fallbackUsed: tradeFallbackUsed, actualsUsed: tradeActualsUsed, rightsUsed: tradeRightsUsed,
          confidence: tradeConfidence,
          confidenceReasons,
          unresolvedAssetCount: unresolvedCount,
          unresolvedAssetNames: tradeUnresolved.map(u => u.playerName ?? "unknown"),
          rightsAssumptions: tradeRightsAssumptions,
        });
      } else {
        // Standard two-team trade
        let teamATotal = 0;
        let teamBTotal = 0;
        const unresolvedCount = tradeUnresolved.length;
        const totalAssetCount = assetDetails.length;

        for (const ad of assetDetails) {
          if (!ad.resolved && ad.assetType === "player") continue;
          const asset = assets.find(a => a.id === ad.assetId)!;
          if (asset.from_team_id === trade.team_a_id) {
            teamATotal += ad.value;
          } else {
            teamBTotal += ad.value;
          }
        }

        if (unresolvedCount === totalAssetCount) {
          incomplete++;
          tradesGenuinelyBlockedSet.add(trade.id);
          results.push({
            tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season,
            verdictLabel: "Data Incomplete", verdictEmoji: "⚠️", verdictSeverity: "incomplete",
            winnerTeamId: null, pctDifference: 0, absoluteGap: 0, relativeGap: 0,
            teamATotal: 0, teamBTotal: 0, teamCTotal: null,
            status: "incomplete", reason: `All ${totalAssetCount} assets unresolved`, blendInfo,
            identityStatus: tradeIdentityStatus, adpStatus: tradeAdpStatus,
            fallbackUsed: tradeFallbackUsed, actualsUsed: tradeActualsUsed, rightsUsed: tradeRightsUsed,
            confidence: tradeConfidence,
            confidenceReasons,
            unresolvedAssetCount: unresolvedCount,
            unresolvedAssetNames: tradeUnresolved.map(u => u.playerName ?? "unknown"),
            rightsAssumptions: tradeRightsAssumptions,
          });
          continue;
        }

        const avgValue = (teamATotal + teamBTotal) / 2;
        const pctDifference = avgValue > 0
          ? ((teamBTotal - teamATotal) / avgValue) * 100
          : 0;
        const absoluteGap = Math.abs(teamBTotal - teamATotal);

        const hasUnresolved = unresolvedCount > 0;
        const verdict = hasUnresolved
          ? { label: "Data Incomplete", emoji: "⚠️", severity: "incomplete" }
          : getVerdict(pctDifference);

        let winnerTeamId: number | null = null;
        if (!hasUnresolved && Math.abs(pctDifference) > FAIR_TOLERANCE) {
          winnerTeamId = pctDifference > 0 ? trade.team_a_id : trade.team_b_id;
        }

        const status = hasUnresolved ? "incomplete" as const : "valued" as const;
        if (status === "valued") valued++;
        else { incomplete++; tradesGenuinelyBlockedSet.add(trade.id); }

        results.push({
          tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season,
          verdictLabel: verdict.label, verdictEmoji: verdict.emoji, verdictSeverity: verdict.severity,
          winnerTeamId,
          pctDifference: Math.round(pctDifference * 10) / 10,
          absoluteGap: Math.round(absoluteGap * 100) / 100,
          relativeGap: Math.round(Math.abs(pctDifference) * 10) / 10,
          teamATotal: Math.round(teamATotal * 100) / 100,
          teamBTotal: Math.round(teamBTotal * 100) / 100,
          teamCTotal: null,
          status,
          reason: hasUnresolved ? `${unresolvedCount}/${totalAssetCount} assets unresolved` : null,
          blendInfo,
          identityStatus: tradeIdentityStatus, adpStatus: tradeAdpStatus,
          fallbackUsed: tradeFallbackUsed, actualsUsed: tradeActualsUsed, rightsUsed: tradeRightsUsed,
          confidence: tradeConfidence,
          confidenceReasons,
          unresolvedAssetCount: unresolvedCount,
          unresolvedAssetNames: tradeUnresolved.map(u => u.playerName ?? "unknown"),
          rightsAssumptions: tradeRightsAssumptions,
        });
      }
    }

    // ── Step 7: Write verdicts back to DB (unless dry run) ──
    if (!dryRun) {
      const valuedResults = results.filter((r) => r.status !== "skipped");

      if (valuedResults.length > 0) {
        const BATCH_SIZE = 50;
        for (let i = 0; i < valuedResults.length; i += BATCH_SIZE) {
          const batch = valuedResults.slice(i, i + BATCH_SIZE);

          for (const r of batch) {
            await ctx.integrations.apps_db.execute(
              `UPDATE ffwr_trades SET
                verdict_label = $1,
                verdict_emoji = $2,
                verdict_severity = $3,
                winner_team_id = $4,
                pct_difference = $5,
                team_a_total = $6,
                team_b_total = $7,
                valuation_complete = $8,
                team_c_total = $9,
                confidence = $10,
                confidence_reasons = $11
               WHERE id = $12`,
              [
                r.verdictLabel,
                r.verdictEmoji,
                r.verdictSeverity,
                r.winnerTeamId,
                r.pctDifference,
                r.teamATotal,
                r.teamBTotal,
                r.status === "valued",
                r.teamCTotal ?? null,
                r.confidence ?? null,
                r.confidenceReasons.length > 0 ? r.confidenceReasons : null,
                r.tradeId,
              ],
              { label: `Update verdict for trade #${r.tradeNumber}` }
            );
          }

          ctx.log.info(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(valuedResults.length / BATCH_SIZE)}`);
        }
      }

      // Also backfill player_adp_at_trade for assets that used ADP fallback
      if (adpFallbacksUsed > 0) {
        ctx.log.info(`Backfilling player_adp_at_trade for ~${adpFallbacksUsed} assets via ADP fallback...`);

        for (const trade of trades) {
          const tradeAssets = assetsByTrade.get(trade.id) ?? [];
          const seasonAdpMapLocal = adpBySeason.get(trade.season);
          if (!seasonAdpMapLocal) continue;

          for (const asset of tradeAssets) {
            if (asset.asset_type !== "player") continue;
            if (asset.player_adp_at_trade != null && asset.player_adp_at_trade > 0) continue;
            if (!asset.player_name) continue;

            const nameNorm = normalizeName(asset.player_name);
            const lookup = seasonAdpMapLocal.get(nameNorm);
            if (lookup) {
              await ctx.integrations.apps_db.execute(
                `UPDATE ffwr_trade_assets
                 SET player_adp_at_trade = $1, player_position = COALESCE(player_position, $2)
                 WHERE id = $3`,
                [lookup.adp, lookup.position, asset.id],
                { label: `Backfill ADP for ${asset.player_name}` }
              );
            }
          }
        }
        ctx.log.info("ADP backfill complete");
      }
    }

    // ── Build summary ──
    const uniqueUnresolvedNames = [...new Set(allUnresolvedAssets.map(a => a.playerName))];

    ctx.log.info(`Done: ${valued} valued, ${incomplete} incomplete, ${skipped} skipped, ${adpFallbacksUsed} ADP fallbacks, ${actualsBlendedCount} actuals-blended, ${fallbackBaselineCount} baseline-fallbacks, ${rightsValuedCount} rights-valued`);

    return {
      totalTrades: trades.length,
      valued,
      incomplete,
      skipped,
      adpFallbacksUsed,
      actualsBlendedCount,
      fallbackBaselineCount,
      rightsValuedCount,
      results,
      unresolvedAssets: allUnresolvedAssets,
      uniqueUnresolvedNames,
      tradesWithFallback: [...tradesWithFallbackSet],
      tradesGenuinelyBlocked: [...tradesGenuinelyBlockedSet],
      assetDetails: allAssetDetails,
    };
  },
});
