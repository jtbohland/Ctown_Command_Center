import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizeName, extractKeeperRightsPlayer } from "../../lib/normalize-trade-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Value Engine Constants (shared with backfill-trade-verdicts.ts) ───
const BASE_VALUE = 10000;
const POWER = 0.6;
const KEEPERS_PER_TEAM = 4;
const RIGHTS_VALUE_MULTIPLIER = 1.0;

const LEAGUE_SIZE_BY_YEAR: Record<number, number> = {
  2019: 10, 2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 10,
  2025: 11, 2026: 11, 2027: 11, 2028: 11,
};
const DEFAULT_LEAGUE_SIZE = 11;

// Future-pick time discounts (applied once)
const FUTURE_PICK_DISCOUNT: Record<number, number> = { 0: 1.00, 1: 0.80, 2: 0.65 };
const DEFAULT_FUTURE_DISCOUNT = 0.50;
function getFuturePickDiscount(pickYear: number, referenceDraftYear: number): number {
  const yearsAhead = Math.max(0, pickYear - referenceDraftYear);
  return FUTURE_PICK_DISCOUNT[yearsAhead] ?? DEFAULT_FUTURE_DISCOUNT;
}

const UNRANKED_BASELINE: Record<string, number> = {
  QB: 175, RB: 225, WR: 250, TE: 200, K: 300, DEF: 300,
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

const FAIR_TOLERANCE = 5;
const VERDICT_SCALE = 1.0;

function getVerdict(pctDiff: number): { label: string; severity: string } {
  const absDiff = Math.abs(pctDiff);
  const t1 = FAIR_TOLERANCE;
  const t2 = FAIR_TOLERANCE + 10 * VERDICT_SCALE;
  const t3 = FAIR_TOLERANCE + 20 * VERDICT_SCALE;
  if (absDiff <= t1) return { label: "Fair Catch", severity: "fair" };
  if (absDiff <= t2) return { label: "Edge Rush", severity: "slight" };
  if (absDiff <= t3) return { label: "Pick Six", severity: "clear" };
  return { label: "Flag on the Play", severity: "robbery" };
}

function seasonToDraftYear(season: string): number {
  const parts = season.split("-");
  if (parts.length === 2 && parts[1].length === 2) {
    const prefix = parts[0].substring(0, 2);
    return parseInt(prefix + parts[1], 10);
  }
  return parseInt(parts[0], 10) || 2024;
}

const NFL_WEEK1_TUESDAY: Record<string, string> = {
  "2018-19": "2018-09-04", "2019-20": "2019-09-03", "2020-21": "2020-09-08",
  "2021-22": "2021-09-07", "2022-23": "2022-09-06", "2023-24": "2023-09-05",
  "2024-25": "2024-09-03", "2025-26": "2025-09-02",
};

const REGULAR_SEASON_WEEKS: Record<string, number> = {
  "2018-19": 17, "2019-20": 17, "2020-21": 17, "2021-22": 18,
  "2022-23": 18, "2023-24": 18, "2024-25": 18, "2025-26": 18,
};

function getSeasonPhaseInfo(tradeDate: string, season: string) {
  const week1Tuesday = NFL_WEEK1_TUESDAY[season];
  const totalWeeks = REGULAR_SEASON_WEEKS[season] ?? 18;
  if (!week1Tuesday) return { lastCompletedWeek: 0, seasonPhase: "preseason" as const, actualsWeight: 0, totalWeeks };
  const tradeDateMs = new Date(tradeDate).getTime();
  const week1Ms = new Date(week1Tuesday).getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  if (tradeDateMs < week1Ms) return { lastCompletedWeek: 0, seasonPhase: "preseason" as const, actualsWeight: 0, totalWeeks };
  const weeksElapsed = Math.floor((tradeDateMs - week1Ms) / msPerWeek);
  const lastCompletedWeek = Math.min(weeksElapsed, totalWeeks);
  let seasonPhase: string; let actualsWeight: number;
  if (lastCompletedWeek === 0) { seasonPhase = "preseason"; actualsWeight = 0; }
  else if (lastCompletedWeek <= 4) { seasonPhase = "early"; actualsWeight = 0.10 + (lastCompletedWeek - 1) * (0.10 / 3); }
  else if (lastCompletedWeek <= 10) { seasonPhase = "mid"; actualsWeight = 0.25 + (lastCompletedWeek - 5) * (0.10 / 5); }
  else if (lastCompletedWeek <= totalWeeks) {
    seasonPhase = "late";
    const lateWeeks = totalWeeks - 11 + 1;
    actualsWeight = 0.40 + (lastCompletedWeek - 11) * (0.10 / (lateWeeks - 1));
    actualsWeight = Math.min(actualsWeight, 0.50);
  } else { seasonPhase = "postseason"; actualsWeight = 0.85; }
  if (lastCompletedWeek >= totalWeeks) { seasonPhase = "postseason"; actualsWeight = 0.85; }
  actualsWeight = Math.round(actualsWeight * 1000) / 1000;
  return { lastCompletedWeek, seasonPhase, actualsWeight, totalWeeks };
}

interface WeeklyActualsRow {
  player_name: string; position: string; season: string;
  week_1: number | null; week_2: number | null; week_3: number | null; week_4: number | null;
  week_5: number | null; week_6: number | null; week_7: number | null; week_8: number | null;
  week_9: number | null; week_10: number | null; week_11: number | null; week_12: number | null;
  week_13: number | null; week_14: number | null; week_15: number | null; week_16: number | null;
  week_17: number | null; week_18: number | null;
}

const WeeklyActualsSchema = z.object({
  player_name: z.string(), position: z.string(), season: z.string(),
  week_1: z.coerce.number().nullable(), week_2: z.coerce.number().nullable(),
  week_3: z.coerce.number().nullable(), week_4: z.coerce.number().nullable(),
  week_5: z.coerce.number().nullable(), week_6: z.coerce.number().nullable(),
  week_7: z.coerce.number().nullable(), week_8: z.coerce.number().nullable(),
  week_9: z.coerce.number().nullable(), week_10: z.coerce.number().nullable(),
  week_11: z.coerce.number().nullable(), week_12: z.coerce.number().nullable(),
  week_13: z.coerce.number().nullable(), week_14: z.coerce.number().nullable(),
  week_15: z.coerce.number().nullable(), week_16: z.coerce.number().nullable(),
  week_17: z.coerce.number().nullable(), week_18: z.coerce.number().nullable(),
});

function computeThroughCutoff(row: WeeklyActualsRow, lastWeek: number) {
  let total = 0; let games = 0;
  const wv: (number | null)[] = [
    row.week_1, row.week_2, row.week_3, row.week_4, row.week_5, row.week_6,
    row.week_7, row.week_8, row.week_9, row.week_10, row.week_11, row.week_12,
    row.week_13, row.week_14, row.week_15, row.week_16, row.week_17, row.week_18,
  ];
  for (let w = 0; w < lastWeek && w < wv.length; w++) {
    const pts = wv[w];
    if (pts !== null && pts !== undefined) { total += pts; games++; }
  }
  const ppg = games > 0 ? Math.round((total / games) * 100) / 100 : 0;
  total = Math.round(total * 100) / 100;
  return { totalPoints: total, gamesPlayed: games, ppg };
}

function computePositionalPercentiles(
  players: Array<{ normalizedName: string; position: string; totalPoints: number; ppg: number; gamesPlayed: number }>,
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
      const totalPtsPercentile = Math.round(((totalInPos - ptsRank + 1) / totalInPos) * 100 * 10) / 10;
      const ppgPercentile = ppgTotal > 0 ? Math.round(((ppgTotal - ppgRank + 1) / ppgTotal) * 100 * 10) / 10 : 0;
      const actualsValue = Math.round((0.60 * totalPtsPercentile + 0.40 * ppgPercentile) * 10) / 10;
      result.set(p.normalizedName, actualsValue);
    }
  }
  return result;
}

// ─── Types ───
type IdentityStatus = "resolved" | "resolved_identity_no_coverage" | "unresolved" | "keeper_rights";
type AdpStatus = "current_season_adp" | "adp_table_match_after_alias" | "no_current_season_adp" | "historical_adp_exists" | "outside_export_range" | "not_found_in_uploaded_adp_exports";
type FallbackType = "none" | "adp_table_match_after_alias" | "position_baseline_fallback" | "resolved_identity_no_coverage";
type Confidence = "high" | "medium" | "low";

const TradeRow = z.object({
  id: z.coerce.number(), trade_number: z.coerce.number(), season: z.string(),
  trade_date: z.string().nullable(), team_a_id: z.coerce.number(), team_b_id: z.coerce.number(),
  trade_type: z.string().nullable(), team_c_id: z.coerce.number().nullable(),
});

const AssetRow = z.object({
  id: z.coerce.number(), trade_id: z.coerce.number(), from_team_id: z.coerce.number(),
  asset_type: z.string(), player_name: z.string().nullable(), player_position: z.string().nullable(),
  player_adp_at_trade: z.coerce.number().nullable(), pick_year: z.coerce.number().nullable(),
  pick_round: z.coerce.number().nullable(), pick_number: z.coerce.number().nullable(),
});

const AdpRow = z.object({ player_name: z.string(), adp_rank: z.coerce.number(), position: z.string() });

// ─── Output row schemas ───
const TradeReportRow = z.object({
  tradeId: z.number(),
  tradeNumber: z.number(),
  season: z.string(),
  tradeDate: z.string().nullable(),
  tradeType: z.string(),
  seasonPhase: z.string(),
  lastCompletedWeek: z.number(),
  actualsWeight: z.number(),
  teamAId: z.number(),
  teamBId: z.number(),
  teamCId: z.number().nullable(),
  teamATotal: z.number(),
  teamBTotal: z.number(),
  teamCTotal: z.number().nullable(),
  status: z.string(),
  verdictLabel: z.string(),
  verdictSeverity: z.string(),
  winnerTeamId: z.number().nullable(),
  pctDifference: z.number(),
  absoluteGap: z.number(),
  relativeGap: z.number(),
  confidence: z.string(),
  fallbackUsed: z.boolean(),
  actualsUsed: z.boolean(),
  rightsUsed: z.boolean(),
  unresolvedCount: z.number(),
});

const AssetReportRow = z.object({
  tradeId: z.number(),
  tradeNumber: z.number(),
  season: z.string(),
  tradeDate: z.string().nullable(),
  assetId: z.number(),
  fromTeamId: z.number(),
  assetType: z.string(),
  playerName: z.string().nullable(),
  identityStatus: z.string(),
  adpStatus: z.string(),
  fallbackType: z.string(),
  confidence: z.string(),
  value: z.number(),
  usedFallback: z.boolean(),
  blended: z.boolean(),
  isKeeperRights: z.boolean(),
  underlyingPlayer: z.string().nullable(),
  fallbackBaseline: z.number().nullable(),
  matchedAdpRank: z.number().nullable(),
  actualsPercentile: z.number().nullable(),
  actualsWeight: z.number().nullable(),
  pickRound: z.number().nullable(),
  pickNumber: z.number().nullable(),
  pickYear: z.number().nullable(),
  pickExpectedAdp: z.number().nullable(),
  futureDiscount: z.number().nullable(),
  valueBeforeDiscount: z.number().nullable(),
  yearsAhead: z.number().nullable(),
});

const ProductionDiffRow = z.object({
  tradeId: z.number(),
  tradeNumber: z.number(),
  season: z.string(),
  oldVerdict: z.string().nullable(),
  newVerdict: z.string(),
  oldWinner: z.number().nullable(),
  newWinner: z.number().nullable(),
  oldPct: z.number().nullable(),
  newPct: z.number(),
  oldTeamATotal: z.number().nullable(),
  newTeamATotal: z.number(),
  oldTeamBTotal: z.number().nullable(),
  newTeamBTotal: z.number(),
  oldStatus: z.string(),
  newStatus: z.string(),
});

const ExistingVerdictRow = z.object({
  id: z.coerce.number(),
  verdict_label: z.string().nullable(),
  verdict_severity: z.string().nullable(),
  winner_team_id: z.coerce.number().nullable(),
  pct_difference: z.coerce.number().nullable(),
  team_a_total: z.coerce.number().nullable(),
  team_b_total: z.coerce.number().nullable(),
  valuation_complete: z.boolean().nullable(),
});

export default api({
  name: "ProvenanceReport",
  description: "Generates row-level provenance audit for all 276 trades.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    summary: z.object({
      totalTrades: z.number(),
      distinctTradeIds: z.number(),
      totalPlayerAssets: z.number(),
      totalPickAssets: z.number(),
      valued: z.number(),
      incomplete: z.number(),
      skipped: z.number(),
      adpFallbacksUsed: z.number(),
      actualsBlendedCount: z.number(),
      fallbackBaselineCount: z.number(),
      rightsValuedCount: z.number(),
      tradesWithFallback: z.array(z.number()),
      tradesGenuinelyBlocked: z.array(z.number()),
      uniqueUnresolvedNames: z.array(z.string()),
    }),
    tradeRows: z.array(TradeReportRow),
    fallbackAssets: z.array(AssetReportRow),
    actualsBlendedAssets: z.array(AssetReportRow),
    keeperRightsAssets: z.array(AssetReportRow),
    pickAssets: z.array(AssetReportRow),
    threeTeamTrades: z.array(TradeReportRow),
    productionDiffs: z.array(ProductionDiffRow),
  }),

  async run(ctx) {
    // Load existing production verdicts for diff comparison
    const existingVerdicts = await ctx.integrations.apps_db.query(
      `SELECT id, verdict_label, verdict_severity, winner_team_id, pct_difference, team_a_total, team_b_total, valuation_complete FROM ffwr_trades ORDER BY id`,
      ExistingVerdictRow,
      undefined,
      { label: "Load existing production verdicts" }
    );
    const existingMap = new Map(existingVerdicts.map(v => [v.id, v]));

    // Load trades
    const trades = await ctx.integrations.apps_db.query(
      `SELECT id, trade_number, season, trade_date::text as trade_date, team_a_id, team_b_id, trade_type, team_c_id FROM ffwr_trades ORDER BY id`,
      TradeRow, undefined,
      { label: "Load all trades" }
    );

    // Load assets
    const allAssets = await ctx.integrations.apps_db.query(
      `SELECT id, trade_id, from_team_id, asset_type, player_name, player_position, player_adp_at_trade, pick_year, pick_round, pick_number FROM ffwr_trade_assets ORDER BY trade_id, id`,
      AssetRow, undefined,
      { label: "Load all trade assets" }
    );

    const assetsByTrade = new Map<number, z.infer<typeof AssetRow>[]>();
    for (const asset of allAssets) {
      if (!assetsByTrade.has(asset.trade_id)) assetsByTrade.set(asset.trade_id, []);
      assetsByTrade.get(asset.trade_id)!.push(asset);
    }

    // Load ADP
    const adpBySeason = new Map<string, Map<string, { adp: number; position: string }>>();
    const allAdpNamesEver = new Set<string>();

    const allAdpSeasons = await ctx.integrations.apps_db.query(
      `SELECT DISTINCT season FROM ffwr_historical_adp`, z.object({ season: z.string() }), undefined,
      { label: "List all ADP seasons" }
    );

    for (const { season } of allAdpSeasons) {
      const adpRows = await ctx.integrations.apps_db.query(
        `SELECT player_name, adp_rank, position FROM ffwr_historical_adp WHERE season = $1 ORDER BY adp_rank LIMIT 1000`,
        AdpRow, [season], { label: `ADP ${season}` }
      );
      const seasonMap = new Map<string, { adp: number; position: string }>();
      for (const row of adpRows) {
        const norm = normalizeName(row.player_name);
        seasonMap.set(norm, { adp: row.adp_rank, position: row.position });
        allAdpNamesEver.add(norm);
      }
      adpBySeason.set(season, seasonMap);
    }

    // Load actuals
    const allActualsNamesEver = new Set<string>();
    const actualsBySeason = new Map<string, WeeklyActualsRow[]>();

    const allActualsSeasons = await ctx.integrations.apps_db.query(
      `SELECT DISTINCT season FROM ffwr_season_actuals`, z.object({ season: z.string() }), undefined,
      { label: "List actuals seasons" }
    );

    for (const { season } of allActualsSeasons) {
      const rows = await ctx.integrations.apps_db.query(
        `SELECT player_name, position, season, week_1, week_2, week_3, week_4, week_5, week_6, week_7, week_8, week_9, week_10, week_11, week_12, week_13, week_14, week_15, week_16, week_17, week_18 FROM ffwr_season_actuals WHERE season = $1 ORDER BY overall_rank`,
        WeeklyActualsSchema, [season], { label: `Actuals ${season}` }
      );
      actualsBySeason.set(season, rows);
      for (const row of rows) allActualsNamesEver.add(normalizeName(row.player_name));
    }

    // ── Evaluate all trades ──
    const tradeRows: z.infer<typeof TradeReportRow>[] = [];
    const fallbackAssets: z.infer<typeof AssetReportRow>[] = [];
    const actualsBlendedAssets: z.infer<typeof AssetReportRow>[] = [];
    const keeperRightsAssets: z.infer<typeof AssetReportRow>[] = [];
    const pickAssetsList: z.infer<typeof AssetReportRow>[] = [];
    const threeTeamTrades: z.infer<typeof TradeReportRow>[] = [];
    const productionDiffs: z.infer<typeof ProductionDiffRow>[] = [];

    let valued = 0, incomplete = 0, skipped = 0;
    let adpFallbacksUsed = 0, actualsBlendedCount = 0, fallbackBaselineCount = 0, rightsValuedCount = 0;
    const tradesWithFallbackSet = new Set<number>();
    const tradesGenuinelyBlockedSet = new Set<number>();

    let totalPlayerAssets = 0, totalPickAssets = 0;

    for (const trade of trades) {
      const assets = assetsByTrade.get(trade.id) ?? [];
      if (assets.length === 0) { skipped++; continue; }

      const draftYear = seasonToDraftYear(trade.season);
      const isThreeTeam = trade.trade_type === "three_team" && trade.team_c_id != null;
      const seasonAdpMap = adpBySeason.get(trade.season);

      let phaseInfo = { lastCompletedWeek: 0, seasonPhase: "preseason", actualsWeight: 0, totalWeeks: 18 };
      let actualsPercentiles: Map<string, number> | null = null;

      if (trade.trade_date) {
        phaseInfo = getSeasonPhaseInfo(trade.trade_date, trade.season);
        if (phaseInfo.lastCompletedWeek > 0 && phaseInfo.actualsWeight > 0) {
          const seasonActuals = actualsBySeason.get(trade.season);
          if (seasonActuals && seasonActuals.length > 0) {
            const weekCutoff = phaseInfo.seasonPhase === "postseason" ? phaseInfo.totalWeeks : phaseInfo.lastCompletedWeek;
            const allPlayerStats: Array<{ normalizedName: string; position: string; totalPoints: number; ppg: number; gamesPlayed: number }> = [];
            for (const row of seasonActuals) {
              const cutoffStats = computeThroughCutoff(row, weekCutoff);
              allPlayerStats.push({ normalizedName: normalizeName(row.player_name), position: row.position.toUpperCase(), ...cutoffStats });
            }
            actualsPercentiles = computePositionalPercentiles(allPlayerStats);
          }
        }
      }

      // ── resolvePlayerValue (identical to backfill engine) ──
      function resolvePlayerValue(asset: z.infer<typeof AssetRow>) {
        const playerName = asset.player_name;
        if (!playerName) return { value: 0, resolved: false, usedFallback: false, blended: false, confidence: "low" as Confidence, identityStatus: "unresolved" as IdentityStatus, adpStatus: "not_found_in_uploaded_adp_exports" as AdpStatus, fallbackType: "none" as FallbackType, fallbackBaseline: null as number | null, matchedAdpRank: null as number | null, actualsPercentileVal: null as number | null, position: asset.player_position, isKeeperRights: false, underlyingPlayer: null as string | null };

        const nameNorm = normalizeName(playerName);
        let adp = asset.player_adp_at_trade;
        let usedFallback = false;
        let identityStatus: IdentityStatus = "resolved";
        let adpStatus: AdpStatus = "current_season_adp";
        let fallbackType: FallbackType = "none";
        let confidence: Confidence = "high";
        let position = asset.player_position;
        let fallbackBaseline: number | null = null;
        let matchedAdpRank: number | null = null;

        if (adp != null && adp > 0) {
          matchedAdpRank = adp;
        } else if (seasonAdpMap) {
          const lookup = seasonAdpMap.get(nameNorm);
          if (lookup) {
            adp = lookup.adp; position = position ?? lookup.position; matchedAdpRank = lookup.adp;
            adpStatus = "adp_table_match_after_alias"; fallbackType = "adp_table_match_after_alias";
            usedFallback = false;
          }
        }

        if (adp != null && adp > 0) {
          identityStatus = "resolved";
          if (adpStatus !== "adp_table_match_after_alias") adpStatus = "current_season_adp";
          confidence = "high";
        } else {
          const hasHistoricalAdp = allAdpNamesEver.has(nameNorm);
          const hasActuals = allActualsNamesEver.has(nameNorm);
          if (hasHistoricalAdp || hasActuals) {
            identityStatus = "resolved";
            adpStatus = hasHistoricalAdp ? "outside_export_range" : "no_current_season_adp";
            fallbackType = "position_baseline_fallback"; confidence = "low";
            if (!position) { for (const [, aRows] of actualsBySeason.entries()) { for (const row of aRows) { if (normalizeName(row.player_name) === nameNorm) { position = row.position; break; } } if (position) break; } }
            const baselineRank = getUnrankedBaseline(position);
            fallbackBaseline = baselineRank; adp = baselineRank; usedFallback = true;
          } else {
            identityStatus = "resolved_identity_no_coverage";
            adpStatus = "not_found_in_uploaded_adp_exports"; fallbackType = "resolved_identity_no_coverage";
            confidence = "low";
            const baselineRank = getUnrankedBaseline(position);
            fallbackBaseline = baselineRank; adp = baselineRank; usedFallback = true;
          }
        }

        const baselineValue = calcValue(adp!);
        let actualsPercentileVal: number | null = null;

        if (actualsPercentiles && phaseInfo.actualsWeight > 0) {
          const actualsVal = actualsPercentiles.get(nameNorm);
          if (actualsVal != null && actualsVal > 0) {
            actualsPercentileVal = actualsVal;
            const totalAdpPlayers = 300;
            const actualsAdpEquiv = Math.max(1, Math.round(totalAdpPlayers * (1 - actualsVal / 100) + 1));
            const actualsBaseValue = calcValue(actualsAdpEquiv);
            const blendedValue = baselineValue * (1 - phaseInfo.actualsWeight) + actualsBaseValue * phaseInfo.actualsWeight;
            return { value: blendedValue, resolved: true, usedFallback, blended: true, confidence: (fallbackBaseline != null ? "low" : (confidence === "high" ? "medium" : confidence)) as Confidence, identityStatus, adpStatus, fallbackType, fallbackBaseline, matchedAdpRank, actualsPercentileVal, position, isKeeperRights: false, underlyingPlayer: null as string | null };
          }
        }

        return { value: baselineValue, resolved: true, usedFallback, blended: false, confidence, identityStatus, adpStatus, fallbackType, fallbackBaseline, matchedAdpRank, actualsPercentileVal, position, isKeeperRights: false, underlyingPlayer: null as string | null };
      }

      // Asset valuation
      interface AssetResult { assetId: number; playerName: string | null; assetType: string; fromTeamId: number; value: number; resolved: boolean; usedFallback: boolean; blended: boolean; confidence: Confidence; identityStatus: IdentityStatus; adpStatus: AdpStatus; fallbackType: FallbackType; fallbackBaseline: number | null; matchedAdpRank: number | null; actualsPercentileVal: number | null; isKeeperRights: boolean; underlyingPlayer: string | null; pickRound: number | null; pickNumber: number | null; pickYear: number | null; pickExpectedAdp: number | null; futureDiscount: number | null; valueBeforeDiscount: number | null; yearsAhead: number | null; }

      const assetResults: AssetResult[] = [];
      for (const asset of assets) {
        if (asset.asset_type === "player") {
          totalPlayerAssets++;
          const playerName = asset.player_name ?? "";
          const krResult = extractKeeperRightsPlayer(playerName);

          if (krResult.isKeeperRights && krResult.underlyingPlayer) {
            const syntheticAsset = { ...asset, player_name: krResult.underlyingPlayer };
            const underlying = resolvePlayerValue(syntheticAsset);
            assetResults.push({
              assetId: asset.id, playerName: asset.player_name, assetType: "player", fromTeamId: asset.from_team_id,
              value: underlying.value * RIGHTS_VALUE_MULTIPLIER, resolved: underlying.resolved, usedFallback: underlying.usedFallback,
              blended: underlying.blended, confidence: underlying.confidence, identityStatus: "keeper_rights",
              adpStatus: underlying.adpStatus, fallbackType: underlying.fallbackType, fallbackBaseline: underlying.fallbackBaseline,
              matchedAdpRank: underlying.matchedAdpRank, actualsPercentileVal: underlying.actualsPercentileVal,
              isKeeperRights: true, underlyingPlayer: krResult.underlyingPlayer,
              pickRound: null, pickNumber: null, pickYear: null, pickExpectedAdp: null,
              futureDiscount: null, valueBeforeDiscount: null, yearsAhead: null,
            });
          } else {
            const result = resolvePlayerValue(asset);
            assetResults.push({
              assetId: asset.id, playerName: asset.player_name, assetType: "player", fromTeamId: asset.from_team_id,
              value: result.value, resolved: result.resolved, usedFallback: result.usedFallback,
              blended: result.blended, confidence: result.confidence, identityStatus: result.identityStatus,
              adpStatus: result.adpStatus, fallbackType: result.fallbackType, fallbackBaseline: result.fallbackBaseline,
              matchedAdpRank: result.matchedAdpRank, actualsPercentileVal: result.actualsPercentileVal,
              isKeeperRights: false, underlyingPlayer: null,
              pickRound: null, pickNumber: null, pickYear: null, pickExpectedAdp: null,
              futureDiscount: null, valueBeforeDiscount: null, yearsAhead: null,
            });
          }
        } else {
          totalPickAssets++;
          const year = asset.pick_year ?? draftYear;
          const round = asset.pick_round ?? 6;
          const pickNum = asset.pick_number ?? undefined;
          const expectedAdp = pickToExpectedAdp(round, year, pickNum);
          const basePickValue = calcValue(expectedAdp);
          const discount = getFuturePickDiscount(year, draftYear);
          const yearsAhead = Math.max(0, year - draftYear);
          assetResults.push({
            assetId: asset.id, playerName: asset.player_name, assetType: "pick", fromTeamId: asset.from_team_id,
            value: basePickValue * discount, resolved: true, usedFallback: false, blended: false,
            confidence: "high", identityStatus: "resolved", adpStatus: "current_season_adp",
            fallbackType: "none", fallbackBaseline: null, matchedAdpRank: null, actualsPercentileVal: null,
            isKeeperRights: false, underlyingPlayer: null,
            pickRound: round, pickNumber: pickNum ?? null, pickYear: year, pickExpectedAdp: expectedAdp,
            futureDiscount: discount, valueBeforeDiscount: basePickValue, yearsAhead,
          });
        }
      }

      // Track counters
      for (const ad of assetResults) {
        if (ad.usedFallback) adpFallbacksUsed++;
        if (ad.blended) actualsBlendedCount++;
        if (ad.fallbackBaseline != null) fallbackBaselineCount++;
        if (ad.isKeeperRights) rightsValuedCount++;
      }

      const tradeFallbackUsed = assetResults.some(a => a.usedFallback);
      const tradeActualsUsed = assetResults.some(a => a.blended);
      const tradeRightsUsed = assetResults.some(a => a.isKeeperRights);
      const tradeUnresolved = assetResults.filter(a => !a.resolved && a.assetType === "player");
      if (tradeFallbackUsed) tradesWithFallbackSet.add(trade.id);

      let tradeConfidence: Confidence = "high";
      for (const ad of assetResults) {
        if (ad.confidence === "low") { tradeConfidence = "low"; break; }
        if (ad.confidence === "medium") tradeConfidence = "medium";
      }

      // Build asset report rows and collect into special sections
      for (const ad of assetResults) {
        const row: z.infer<typeof AssetReportRow> = {
          tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season, tradeDate: trade.trade_date,
          assetId: ad.assetId, fromTeamId: ad.fromTeamId, assetType: ad.assetType, playerName: ad.playerName,
          identityStatus: ad.identityStatus, adpStatus: ad.adpStatus, fallbackType: ad.fallbackType,
          confidence: ad.confidence, value: Math.round(ad.value * 100) / 100,
          usedFallback: ad.usedFallback, blended: ad.blended, isKeeperRights: ad.isKeeperRights,
          underlyingPlayer: ad.underlyingPlayer, fallbackBaseline: ad.fallbackBaseline,
          matchedAdpRank: ad.matchedAdpRank, actualsPercentile: ad.actualsPercentileVal,
          actualsWeight: ad.blended ? phaseInfo.actualsWeight : null,
          pickRound: ad.pickRound, pickNumber: ad.pickNumber, pickYear: ad.pickYear, pickExpectedAdp: ad.pickExpectedAdp,
          futureDiscount: ad.futureDiscount, valueBeforeDiscount: ad.valueBeforeDiscount != null ? Math.round(ad.valueBeforeDiscount * 100) / 100 : null, yearsAhead: ad.yearsAhead,
        };
        if (ad.usedFallback) fallbackAssets.push(row);
        if (ad.blended) actualsBlendedAssets.push(row);
        if (ad.isKeeperRights) keeperRightsAssets.push(row);
        if (ad.assetType === "pick") pickAssetsList.push(row);
      }

      // Compute team totals & verdict
      if (isThreeTeam) {
        const teamIds = [trade.team_a_id, trade.team_b_id, trade.team_c_id!];
        const totals = new Map<number, number>();
        for (const tid of teamIds) totals.set(tid, 0);
        for (const ad of assetResults) {
          if (!ad.resolved && ad.assetType === "player") continue;
          totals.set(ad.fromTeamId, (totals.get(ad.fromTeamId) ?? 0) + ad.value);
        }
        const teamATotal = totals.get(trade.team_a_id) ?? 0;
        const teamBTotal = totals.get(trade.team_b_id) ?? 0;
        const teamCTotal = totals.get(trade.team_c_id!) ?? 0;
        const allTotals = Array.from(totals.entries());
        const avgTotal = allTotals.reduce((s, [, v]) => s + v, 0) / 3;
        const unresolvedCount = tradeUnresolved.length;
        const totalAssetCount = assetResults.length;

        if (unresolvedCount === totalAssetCount) {
          incomplete++; tradesGenuinelyBlockedSet.add(trade.id);
          tradeRows.push({ tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season, tradeDate: trade.trade_date, tradeType: "three_team", seasonPhase: phaseInfo.seasonPhase, lastCompletedWeek: phaseInfo.lastCompletedWeek, actualsWeight: phaseInfo.actualsWeight, teamAId: trade.team_a_id, teamBId: trade.team_b_id, teamCId: trade.team_c_id, teamATotal: Math.round(teamATotal * 100) / 100, teamBTotal: Math.round(teamBTotal * 100) / 100, teamCTotal: Math.round(teamCTotal * 100) / 100, status: "incomplete", verdictLabel: "Data Incomplete", verdictSeverity: "incomplete", winnerTeamId: null, pctDifference: 0, absoluteGap: 0, relativeGap: 0, confidence: tradeConfidence, fallbackUsed: tradeFallbackUsed, actualsUsed: tradeActualsUsed, rightsUsed: tradeRightsUsed, unresolvedCount });
          continue;
        }

        const sorted = allTotals.sort((a, b) => a[1] - b[1]);
        const bestDealTeamId = sorted[0][0];
        const pctSpread = avgTotal > 0 ? ((sorted[2][1] - sorted[0][1]) / avgTotal) * 100 : 0;
        const absoluteGap = sorted[2][1] - sorted[0][1];
        const hasUnresolved = unresolvedCount > 0;
        const verdict = hasUnresolved ? { label: "Data Incomplete", severity: "incomplete" } : getVerdict(pctSpread);
        const winnerTeamId = hasUnresolved ? null : (Math.abs(pctSpread) > FAIR_TOLERANCE ? bestDealTeamId : null);
        const status = hasUnresolved ? "incomplete" : "valued";
        if (status === "valued") valued++; else { incomplete++; tradesGenuinelyBlockedSet.add(trade.id); }

        const tradeRow: z.infer<typeof TradeReportRow> = { tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season, tradeDate: trade.trade_date, tradeType: "three_team", seasonPhase: phaseInfo.seasonPhase, lastCompletedWeek: phaseInfo.lastCompletedWeek, actualsWeight: phaseInfo.actualsWeight, teamAId: trade.team_a_id, teamBId: trade.team_b_id, teamCId: trade.team_c_id, teamATotal: Math.round(teamATotal * 100) / 100, teamBTotal: Math.round(teamBTotal * 100) / 100, teamCTotal: Math.round(teamCTotal * 100) / 100, status, verdictLabel: verdict.label, verdictSeverity: verdict.severity, winnerTeamId, pctDifference: Math.round(pctSpread * 10) / 10, absoluteGap: Math.round(absoluteGap * 100) / 100, relativeGap: Math.round(pctSpread * 10) / 10, confidence: tradeConfidence, fallbackUsed: tradeFallbackUsed, actualsUsed: tradeActualsUsed, rightsUsed: tradeRightsUsed, unresolvedCount };
        tradeRows.push(tradeRow);
        threeTeamTrades.push(tradeRow);
      } else {
        let teamATotal = 0; let teamBTotal = 0;
        const unresolvedCount = tradeUnresolved.length;
        const totalAssetCount = assetResults.length;
        for (const ad of assetResults) {
          if (!ad.resolved && ad.assetType === "player") continue;
          if (ad.fromTeamId === trade.team_a_id) teamATotal += ad.value; else teamBTotal += ad.value;
        }

        if (unresolvedCount === totalAssetCount) {
          incomplete++; tradesGenuinelyBlockedSet.add(trade.id);
          tradeRows.push({ tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season, tradeDate: trade.trade_date, tradeType: "two_team", seasonPhase: phaseInfo.seasonPhase, lastCompletedWeek: phaseInfo.lastCompletedWeek, actualsWeight: phaseInfo.actualsWeight, teamAId: trade.team_a_id, teamBId: trade.team_b_id, teamCId: null, teamATotal: 0, teamBTotal: 0, teamCTotal: null, status: "incomplete", verdictLabel: "Data Incomplete", verdictSeverity: "incomplete", winnerTeamId: null, pctDifference: 0, absoluteGap: 0, relativeGap: 0, confidence: tradeConfidence, fallbackUsed: tradeFallbackUsed, actualsUsed: tradeActualsUsed, rightsUsed: tradeRightsUsed, unresolvedCount });
          continue;
        }

        const avgValue = (teamATotal + teamBTotal) / 2;
        const pctDifference = avgValue > 0 ? ((teamBTotal - teamATotal) / avgValue) * 100 : 0;
        const absoluteGap = Math.abs(teamBTotal - teamATotal);
        const hasUnresolved = unresolvedCount > 0;
        const verdict = hasUnresolved ? { label: "Data Incomplete", severity: "incomplete" } : getVerdict(pctDifference);
        let winnerTeamId: number | null = null;
        if (!hasUnresolved && Math.abs(pctDifference) > FAIR_TOLERANCE) {
          winnerTeamId = pctDifference > 0 ? trade.team_a_id : trade.team_b_id;
        }
        const status = hasUnresolved ? "incomplete" : "valued";
        if (status === "valued") valued++; else { incomplete++; tradesGenuinelyBlockedSet.add(trade.id); }

        tradeRows.push({ tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season, tradeDate: trade.trade_date, tradeType: "two_team", seasonPhase: phaseInfo.seasonPhase, lastCompletedWeek: phaseInfo.lastCompletedWeek, actualsWeight: phaseInfo.actualsWeight, teamAId: trade.team_a_id, teamBId: trade.team_b_id, teamCId: null, teamATotal: Math.round(teamATotal * 100) / 100, teamBTotal: Math.round(teamBTotal * 100) / 100, teamCTotal: null, status, verdictLabel: verdict.label, verdictSeverity: verdict.severity, winnerTeamId, pctDifference: Math.round(pctDifference * 10) / 10, absoluteGap: Math.round(absoluteGap * 100) / 100, relativeGap: Math.round(Math.abs(pctDifference) * 10) / 10, confidence: tradeConfidence, fallbackUsed: tradeFallbackUsed, actualsUsed: tradeActualsUsed, rightsUsed: tradeRightsUsed, unresolvedCount });
      }

      // Production diff
      const existing = existingMap.get(trade.id);
      if (existing) {
        const currentRow = tradeRows[tradeRows.length - 1];
        const oldComplete = existing.valuation_complete === true;
        const newComplete = currentRow.status === "valued";
        const verdictChanged = existing.verdict_label !== currentRow.verdictLabel;
        const winnerChanged = existing.winner_team_id !== currentRow.winnerTeamId;
        const statusChanged = oldComplete !== newComplete;

        if (verdictChanged || winnerChanged || statusChanged) {
          productionDiffs.push({
            tradeId: trade.id, tradeNumber: trade.trade_number, season: trade.season,
            oldVerdict: existing.verdict_label, newVerdict: currentRow.verdictLabel,
            oldWinner: existing.winner_team_id, newWinner: currentRow.winnerTeamId,
            oldPct: existing.pct_difference, newPct: currentRow.pctDifference,
            oldTeamATotal: existing.team_a_total, newTeamATotal: currentRow.teamATotal,
            oldTeamBTotal: existing.team_b_total, newTeamBTotal: currentRow.teamBTotal,
            oldStatus: oldComplete ? "valued" : "incomplete", newStatus: currentRow.status,
          });
        }
      }
    }

    return {
      summary: {
        totalTrades: trades.length,
        distinctTradeIds: new Set(trades.map(t => t.id)).size,
        totalPlayerAssets: totalPlayerAssets,
        totalPickAssets: totalPickAssets,
        valued, incomplete, skipped,
        adpFallbacksUsed, actualsBlendedCount, fallbackBaselineCount, rightsValuedCount,
        tradesWithFallback: [...tradesWithFallbackSet],
        tradesGenuinelyBlocked: [...tradesGenuinelyBlockedSet],
        uniqueUnresolvedNames: [],
      },
      tradeRows,
      fallbackAssets,
      actualsBlendedAssets,
      keeperRightsAssets,
      pickAssets: pickAssetsList,
      threeTeamTrades,
      productionDiffs,
    };
  },
});
