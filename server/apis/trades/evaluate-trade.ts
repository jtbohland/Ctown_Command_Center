import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizeName, extractKeeperRightsPlayer } from "../../lib/normalize-trade-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Value Engine Constants (defaults — overridable via modifiers input) ───
const BASE_VALUE = 10000;
const DEFAULT_POWER = 0.6;
const KEEPERS_PER_TEAM = 4;

// C-Town league size by draft year: 10 teams 2019-2024, 11 teams 2025+
const LEAGUE_SIZE_BY_YEAR: Record<number, number> = {
  2019: 10, 2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 10,
  2025: 11, 2026: 11, 2027: 11,
};
const DEFAULT_LEAGUE_SIZE = 11;

function getLeagueSize(year: number): number {
  return LEAGUE_SIZE_BY_YEAR[year] ?? DEFAULT_LEAGUE_SIZE;
}

function getKeeperOffset(year: number): number {
  return getLeagueSize(year) * KEEPERS_PER_TEAM;
}

// ─── Dynasty Multiplier Constants ───────────────────────────
const ROOKIE_MAX_PICK = 128;
const ROOKIE_MIN_BOOST = 0.01;

function getRookiePremium(overallPick: number, maxBoost: number): number {
  if (overallPick < 1 || overallPick > ROOKIE_MAX_PICK) return 1.0;
  const t = (overallPick - 1) / (ROOKIE_MAX_PICK - 1);
  const boost = ROOKIE_MIN_BOOST + (maxBoost - ROOKIE_MIN_BOOST) * Math.pow(1 - t, 2);
  return 1 + boost;
}

function getRawAgeFactor(age: number): number {
  if (age <= 24) return 1.06;
  if (age <= 27) return 1.03;
  if (age <= 29) return 1.00;
  if (age <= 31) return 0.95;
  return 0.90;
}

function getAgeFactor(age: number, ageCurve: number): number {
  if (ageCurve === 0) return 1.0;
  const raw = getRawAgeFactor(age);
  return 1.0 + (raw - 1.0) * ageCurve;
}

// Future pick discount
const CURRENT_YEAR_FOR_DISCOUNT = 2026;
function getYearDiscount(year: number, perYearDiscount: number): number {
  const yearsOut = Math.max(0, year - CURRENT_YEAR_FOR_DISCOUNT);
  if (yearsOut === 0) return 1.0;
  return Math.pow(1 - perYearDiscount, yearsOut);
}

function pickToExpectedAdp(round: number, year: number, overallPick?: number): number {
  const leagueSize = getLeagueSize(year);
  const draftPosition = overallPick
    ? overallPick
    : ((round - 1) * leagueSize + 1 + round * leagueSize) / 2;
  return draftPosition + getKeeperOffset(year);
}

function calcValue(adpRank: number, power: number): number {
  if (adpRank <= 0) return 0;
  return BASE_VALUE * Math.pow(1 / adpRank, power);
}

function getVerdict(
  pctDiff: number,
  fairTolerance: number,
  verdictScale: number,
): { label: string; emoji: string; severity: string } {
  const absDiff = Math.abs(pctDiff);
  const t1 = fairTolerance;
  const t2 = fairTolerance + 10 * verdictScale;
  const t3 = fairTolerance + 20 * verdictScale;
  if (absDiff <= t1) return { label: "Fair Catch", emoji: "🧤", severity: "fair" };
  if (absDiff <= t2) return { label: "Edge Rush", emoji: "📈", severity: "slight" };
  if (absDiff <= t3) return { label: "Pick Six", emoji: "🏆", severity: "clear" };
  return { label: "Flag on the Play", emoji: "🚩", severity: "robbery" };
}

// ─── NFL Season Calendar (for live Actuals blending) ────────
// Week 1 Tuesday = the Tuesday of the first game week.
// All dates are the Tuesday that starts the "week 1 scoring window".
const NFL_WEEK1_TUESDAY: Record<string, string> = {
  "2018-19": "2018-09-04",
  "2019-20": "2019-09-03",
  "2020-21": "2020-09-08",
  "2021-22": "2021-09-07",
  "2022-23": "2022-09-06",
  "2023-24": "2023-09-05",
  "2024-25": "2024-09-03",
  "2025-26": "2025-09-02",
  "2026-27": "2026-09-08", // 2026 NFL season starts Wed Sep 9; Tuesday = Sep 8
};

const REGULAR_SEASON_WEEKS: Record<string, number> = {
  "2018-19": 17,
  "2019-20": 17,
  "2020-21": 17,
  "2021-22": 18,
  "2022-23": 18,
  "2023-24": 18,
  "2024-25": 18,
  "2025-26": 18,
  "2026-27": 18,
};

// The current season for the live Exchange
const CURRENT_SEASON = "2026-27";

type SeasonPhase = "preseason" | "early" | "mid" | "late" | "postseason";

interface PhaseInfo {
  lastCompletedWeek: number;
  seasonPhase: SeasonPhase;
  actualsWeight: number;
  totalWeeks: number;
}

/**
 * Determine the current NFL season phase and actuals weight based on a valuation date.
 * Weight scale (compounding — the more weeks, the more data, the more we trust actuals):
 *   Preseason:      0%
 *   Early (wk 1-4): 10% → 20%  (ramps ~3.3% per week)
 *   Mid (wk 5-10):  25% → 35%  (ramps ~2% per week)
 *   Late (wk 11-18):40% → 50%  (ramps ~1.4% per week)
 *   Postseason:     85%
 */
function getSeasonPhaseInfo(valuationDate: string, season: string): PhaseInfo {
  const week1Tuesday = NFL_WEEK1_TUESDAY[season];
  const totalWeeks = REGULAR_SEASON_WEEKS[season] ?? 18;

  if (!week1Tuesday) {
    return { lastCompletedWeek: 0, seasonPhase: "preseason", actualsWeight: 0, totalWeeks };
  }

  const valDateMs = new Date(valuationDate).getTime();
  const week1Ms = new Date(week1Tuesday).getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  if (valDateMs < week1Ms) {
    return { lastCompletedWeek: 0, seasonPhase: "preseason", actualsWeight: 0, totalWeeks };
  }

  const weeksElapsed = Math.floor((valDateMs - week1Ms) / msPerWeek);
  const lastCompletedWeek = Math.min(weeksElapsed, totalWeeks);

  let seasonPhase: SeasonPhase;
  let actualsWeight: number;

  if (lastCompletedWeek === 0) {
    seasonPhase = "preseason";
    actualsWeight = 0;
  } else if (lastCompletedWeek <= 4) {
    // Early: 10% at week 1, ramps to 20% at week 4
    seasonPhase = "early";
    actualsWeight = 0.10 + (lastCompletedWeek - 1) * (0.10 / 3);
  } else if (lastCompletedWeek <= 10) {
    // Mid: 25% at week 5, ramps to 35% at week 10
    seasonPhase = "mid";
    actualsWeight = 0.25 + (lastCompletedWeek - 5) * (0.10 / 5);
  } else if (lastCompletedWeek <= totalWeeks) {
    // Late: 40% at week 11, ramps to 50% at final week
    seasonPhase = "late";
    const lateWeeks = totalWeeks - 11 + 1;
    actualsWeight = 0.40 + (lastCompletedWeek - 11) * (0.10 / (lateWeeks - 1));
    actualsWeight = Math.min(actualsWeight, 0.50);
  } else {
    seasonPhase = "postseason";
    actualsWeight = 0.85;
  }

  // Override: if all regular season weeks are complete → postseason
  if (lastCompletedWeek >= totalWeeks) {
    seasonPhase = "postseason";
    actualsWeight = 0.85;
  }

  actualsWeight = Math.round(actualsWeight * 1000) / 1000;

  return { lastCompletedWeek, seasonPhase, actualsWeight, totalWeeks };
}

// ─── Weekly Actuals Computation (ported from backfill) ──────
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

interface PlayerCutoffStats {
  normalizedName: string;
  position: string;
  totalPoints: number;
  gamesPlayed: number;
  ppg: number;
}

function computeThroughCutoff(row: WeeklyActualsRow, lastWeek: number): { totalPoints: number; gamesPlayed: number; ppg: number } {
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

/**
 * Compute positional percentiles from through-cutoff stats.
 * Returns a Map<normalizedName, percentileValue (0-100)>.
 * Percentile = 60% total-pts rank + 40% PPG rank within position.
 */
function computePositionalPercentiles(
  players: PlayerCutoffStats[],
): Map<string, number> {
  const byPosition = new Map<string, PlayerCutoffStats[]>();
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
        ((totalInPos - ptsRank + 1) / totalInPos) * 100 * 10,
      ) / 10;
      const ppgPercentile = ppgTotal > 0
        ? Math.round(((ppgTotal - ppgRank + 1) / ppgTotal) * 100 * 10) / 10
        : 0;

      const actualsValue = Math.round(
        (0.60 * totalPtsPercentile + 0.40 * ppgPercentile) * 10,
      ) / 10;

      result.set(p.normalizedName, actualsValue);
    }
  }

  return result;
}

// ─── Schemas ────────────────────────────────────────────────

const AssetInputSchema = z.object({
  type: z.enum(["player", "pick"]),
  playerName: z.string().nullable().optional(),
  playerPosition: z.string().nullable().optional(),
  playerAdp: z.number().nullable().optional(),
  pickYear: z.number().nullable().optional(),
  pickRound: z.number().nullable().optional(),
  pickNumber: z.number().nullable().optional(),
});

// Per-player actuals detail (only present when actuals are blended)
const ActualsDetailSchema = z.object({
  totalPoints: z.number(),
  gamesPlayed: z.number(),
  ppg: z.number(),
  actualsPercentile: z.number(),
  adpOnlyValue: z.number(),      // value before blending
  actualsOnlyValue: z.number(),   // pure actuals-derived value
  actualsAdjustment: z.number(),  // difference: final - adpOnly
  finalBlendedValue: z.number(),  // value after blending
});

const ValuationSchema = z.object({
  name: z.string(),
  value: z.number(),
  adpUsed: z.number().nullable(),
  dynastyFactors: z.array(z.string()),
  valueStatus: z.enum(["resolved", "unresolved"]),
  actualsDetail: ActualsDetailSchema.nullable(),
});

const SideResultSchema = z.object({
  assets: z.array(ValuationSchema),
  totalValue: z.number(),
  hasUnresolved: z.boolean(),
  unresolvedReasons: z.array(z.string()),
});

// Top-level actuals context returned with every evaluation
const ActualsContextSchema = z.object({
  valuationDate: z.string(),
  season: z.string(),
  seasonPhase: z.string(),
  lastCompletedWeek: z.number(),
  weeksIncluded: z.number(),
  actualsWeight: z.number(),
  adpWeight: z.number(),
  actualsAvailable: z.boolean(),
  playersWithActuals: z.number(),
});

const DejaVuAssetSchema = z.object({
  assetType: z.string(),
  playerName: z.string().nullable(),
  playerPosition: z.string().nullable(),
  playerAdpAtTrade: z.coerce.number().nullable(),
  pickYear: z.number().nullable(),
  pickRound: z.number().nullable(),
  pickNumber: z.number().nullable(),
  fromTeamId: z.number(),
  fromTeamName: z.string(),
});

const DejaVuSchema = z.object({
  tradeNumber: z.number(),
  season: z.string(),
  tradeDate: z.string().nullable(),
  teamA: z.string(),
  teamB: z.string(),
  similarity: z.number(),
  summary: z.string(),
  assets: z.array(DejaVuAssetSchema),
  verdict: z.object({
    label: z.string(),
    emoji: z.string(),
    severity: z.string(),
  }).nullable(),
  winnerName: z.string().nullable(),
});

const AdpRowSchema = z.object({
  player_name: z.string(),
  adp_rank: z.coerce.number(),
  position: z.string(),
});

const RookieSchema = z.object({
  player_name: z.string(),
  nfl_draft_year: z.coerce.number(),
  overall_pick: z.coerce.number(),
  age_on_draft_day: z.coerce.number(),
  position: z.string(),
});

export default api({
  name: "EvaluateTrade",
  description: "Evaluates a proposed trade with ADP, dynasty modifiers, and live current-season Actuals blending.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    teamAId: z.number(),
    teamBId: z.number(),
    teamAGives: z.array(AssetInputSchema),
    teamBGives: z.array(AssetInputSchema),
    modifiers: z.object({
      qbScarcity: z.number().optional(),
      tePremium: z.number().optional(),
      rbPremium: z.number().optional(),
      wrPremium: z.number().optional(),
      rookieHype: z.number().optional(),
      ageCurve: z.number().optional(),
      futurePickDiscount: z.number().optional(),
      valueCurve: z.number().optional(),
      fairTolerance: z.number().optional(),
      verdictScale: z.number().optional(),
      dejaVuSensitivity: z.number().optional(),
    }).nullable().optional(),
  }),

  output: z.object({
    teamASide: SideResultSchema,
    teamBSide: SideResultSchema,
    pctDifference: z.number(),
    winningTeamId: z.number().nullable(),
    verdict: z.object({
      label: z.string(),
      emoji: z.string(),
      severity: z.string(),
    }),
    verdictStatus: z.enum(["definitive", "incomplete"]),
    actualsContext: ActualsContextSchema,
    dejaVu: z.array(DejaVuSchema),
  }),

  async run(ctx, { teamAId, teamBId, teamAGives, teamBGives, modifiers }) {
    // ── Step 1: Merge modifiers with defaults ──
    const mod = {
      qbScarcity: modifiers?.qbScarcity ?? 1.08,
      tePremium: modifiers?.tePremium ?? 1.00,
      rbPremium: modifiers?.rbPremium ?? 1.00,
      wrPremium: modifiers?.wrPremium ?? 1.00,
      rookieHype: modifiers?.rookieHype ?? 0.20,
      ageCurve: modifiers?.ageCurve ?? 1.0,
      futurePickDiscount: modifiers?.futurePickDiscount ?? 0.10,
      valueCurve: modifiers?.valueCurve ?? DEFAULT_POWER,
      fairTolerance: modifiers?.fairTolerance ?? 5,
      verdictScale: modifiers?.verdictScale ?? 1.0,
      dejaVuSensitivity: modifiers?.dejaVuSensitivity ?? 3,
    };

    // ── Step 2: Determine current season phase and actuals weight ──
    const valuationDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const phaseInfo = getSeasonPhaseInfo(valuationDate, CURRENT_SEASON);
    ctx.log.info(`Valuation date: ${valuationDate}, season: ${CURRENT_SEASON}, phase: ${phaseInfo.seasonPhase}, week: ${phaseInfo.lastCompletedWeek}, actualsWeight: ${phaseInfo.actualsWeight}`);

    // ── Step 3: Load current ADP ──
    const currentAdp = await ctx.integrations.apps_db.query(
      `SELECT player_name, adp_rank, position FROM ffwr_historical_adp WHERE season = '2026-27' ORDER BY adp_rank LIMIT 300`,
      AdpRowSchema,
      undefined,
      { label: "Fetch current ADP with positions" },
    );
    const adpMap = new Map(currentAdp.map((p) => [normalizeName(p.player_name), p]));
    const totalAdpPlayers = currentAdp.length;

    // Build position → sorted ADP lists for scarcity check
    const positionAdpMap = new Map<string, { name: string; adp: number }[]>();
    for (const p of currentAdp) {
      const pos = p.position.toUpperCase();
      if (!positionAdpMap.has(pos)) positionAdpMap.set(pos, []);
      positionAdpMap.get(pos)!.push({ name: normalizeName(p.player_name), adp: p.adp_rank });
    }
    for (const list of positionAdpMap.values()) {
      list.sort((a, b) => a.adp - b.adp);
    }

    // ── Step 4: Load current-season Actuals (only when in-season) ──
    let actualsPercentiles: Map<string, number> | null = null;
    let playerActualsStats: Map<string, PlayerCutoffStats> | null = null;
    let playersWithActuals = 0;

    if (phaseInfo.actualsWeight > 0 && phaseInfo.lastCompletedWeek > 0) {
      try {
        const weekCutoff = phaseInfo.seasonPhase === "postseason"
          ? phaseInfo.totalWeeks
          : phaseInfo.lastCompletedWeek;

        const seasonActuals = await ctx.integrations.apps_db.query(
          `SELECT player_name, position, season,
                  week_1, week_2, week_3, week_4, week_5, week_6,
                  week_7, week_8, week_9, week_10, week_11, week_12,
                  week_13, week_14, week_15, week_16, week_17, week_18
           FROM ffwr_season_actuals
           WHERE season = $1
           LIMIT 1000`,
          WeeklyActualsSchema,
          [CURRENT_SEASON],
          { label: `Load ${CURRENT_SEASON} actuals through week ${weekCutoff}` },
        );

        if (seasonActuals.length > 0) {
          // Compute through-cutoff stats for every player
          const allPlayerStats: PlayerCutoffStats[] = [];
          const statsMap = new Map<string, PlayerCutoffStats>();

          for (const row of seasonActuals) {
            const stats = computeThroughCutoff(row, weekCutoff);
            const nameNorm = normalizeName(row.player_name);
            const entry: PlayerCutoffStats = {
              normalizedName: nameNorm,
              position: row.position,
              totalPoints: stats.totalPoints,
              gamesPlayed: stats.gamesPlayed,
              ppg: stats.ppg,
            };
            allPlayerStats.push(entry);
            statsMap.set(nameNorm, entry);
          }

          actualsPercentiles = computePositionalPercentiles(allPlayerStats);
          playerActualsStats = statsMap;
          playersWithActuals = allPlayerStats.filter(p => p.gamesPlayed > 0).length;

          ctx.log.info(`Loaded ${seasonActuals.length} actuals rows, ${playersWithActuals} players with games through week ${weekCutoff}`);
        } else {
          ctx.log.info(`No actuals data found for ${CURRENT_SEASON} — staying ADP-only`);
        }
      } catch (err) {
        ctx.log.warn(`Failed to load actuals for ${CURRENT_SEASON}: ${err}`);
        // Graceful fallback — continue with ADP-only
      }
    }

    // ── Step 5: Load rookie classes ──
    let rookieClasses: z.infer<typeof RookieSchema>[] = [];
    try {
      rookieClasses = await ctx.integrations.apps_db.query(
        `SELECT player_name, nfl_draft_year, overall_pick, age_on_draft_day, position
         FROM ffwr_rookie_classes LIMIT 1000`,
        RookieSchema,
        undefined,
        { label: "Fetch rookie classes for dynasty factors" },
      );
    } catch {
      ctx.log.warn("ffwr_rookie_classes not found — dynasty factors skipped");
    }

    const CURRENT_DRAFT_YEAR = 2026;

    // ── Dynasty multiplier helper ──
    function applyDynasty(
      baseValue: number,
      playerName: string,
      playerPosition: string | null,
      playerAdp: number | null,
    ): { value: number; factors: string[] } {
      if (rookieClasses.length === 0) return { value: baseValue, factors: [] };

      let multiplier = 1.0;
      const factors: string[] = [];
      const nameNorm = normalizeName(playerName);
      const pos = playerPosition?.toUpperCase() ?? "";

      // 1. Graduated rookie premium
      if (mod.rookieHype > 0) {
        const rookieDraftMatch = rookieClasses.find(
          (r) => r.nfl_draft_year === CURRENT_DRAFT_YEAR && r.overall_pick <= ROOKIE_MAX_PICK && normalizeName(r.player_name) === nameNorm,
        );
        if (rookieDraftMatch) {
          const premium = getRookiePremium(rookieDraftMatch.overall_pick, mod.rookieHype);
          multiplier *= premium;
          const pct = Math.round((premium - 1) * 100);
          factors.push(`Rookie Pick #${rookieDraftMatch.overall_pick} +${pct}%`);
        }
      }

      // 2. Positional scarcity: top 5
      if (playerAdp !== null) {
        const posList = positionAdpMap.get(pos) ?? [];
        const rank = posList.findIndex((p) => p.name === nameNorm);
        const isTop5 = rank >= 0 && rank < 5;

        if (pos === "QB" && isTop5 && mod.qbScarcity > 1.0) {
          multiplier *= mod.qbScarcity;
          const pct = Math.round((mod.qbScarcity - 1) * 100);
          factors.push(`QB${rank + 1} Scarcity +${pct}%`);
        }
        if (pos === "TE" && isTop5 && mod.tePremium > 1.0) {
          multiplier *= mod.tePremium;
          const pct = Math.round((mod.tePremium - 1) * 100);
          factors.push(`TE${rank + 1} Premium +${pct}%`);
        }
      }

      // 3. Positional multipliers (RB/WR)
      if (pos === "RB" && mod.rbPremium !== 1.0) {
        multiplier *= mod.rbPremium;
        const pct = Math.round((mod.rbPremium - 1) * 100);
        factors.push(`RB Adj ${pct >= 0 ? "+" : ""}${pct}%`);
      }
      if (pos === "WR" && mod.wrPremium !== 1.0) {
        multiplier *= mod.wrPremium;
        const pct = Math.round((mod.wrPremium - 1) * 100);
        factors.push(`WR Adj ${pct >= 0 ? "+" : ""}${pct}%`);
      }

      // 4. Age curve
      const rookieEntry = rookieClasses.find((r) => normalizeName(r.player_name) === nameNorm);
      if (rookieEntry && mod.ageCurve > 0) {
        const currentAge = rookieEntry.age_on_draft_day + (CURRENT_DRAFT_YEAR - rookieEntry.nfl_draft_year);
        const ageFactor = getAgeFactor(currentAge, mod.ageCurve);
        if (ageFactor !== 1.0) {
          multiplier *= ageFactor;
          const pct = Math.round((ageFactor - 1) * 100);
          factors.push(`Age ${currentAge} ${pct >= 0 ? "+" : ""}${pct}%`);
        }
      }

      return { value: baseValue * multiplier, factors };
    }

    // ── Step 6: Evaluate one side with Actuals blending ──
    function evaluateSide(assets: z.infer<typeof AssetInputSchema>[]): z.infer<typeof SideResultSchema> {
      const valuations: z.infer<typeof ValuationSchema>[] = [];

      for (const asset of assets) {
        if (asset.type === "player") {
          const name = asset.playerName ?? "Unknown";
          const nameNorm = normalizeName(name);
          let adp = asset.playerAdp ?? null;
          const adpEntry = adpMap.get(nameNorm);
          if (!adp && adpEntry) adp = adpEntry.adp_rank;
          const position = asset.playerPosition ?? adpEntry?.position ?? null;

          const rawValue = adp ? calcValue(adp, mod.valueCurve) : 0;
          const { value: dynastyValue, factors } = applyDynasty(rawValue, name, position, adp);

          if (adp) {
            // Apply Actuals blending if available
            let finalValue = dynastyValue;
            let actualsDetail: z.infer<typeof ActualsDetailSchema> | null = null;

            if (actualsPercentiles && playerActualsStats && phaseInfo.actualsWeight > 0) {
              const percentile = actualsPercentiles.get(nameNorm);
              const stats = playerActualsStats.get(nameNorm);

              if (percentile != null && percentile > 0 && stats && stats.gamesPlayed > 0) {
                // Convert percentile to an ADP-equivalent value
                const actualsAdpEquiv = Math.max(1, Math.round(totalAdpPlayers * (1 - percentile / 100) + 1));
                const actualsBaseValue = calcValue(actualsAdpEquiv, mod.valueCurve);

                // Blend: final = ADP × (1 - weight) + Actuals × weight
                const blendedRaw = dynastyValue * (1 - phaseInfo.actualsWeight) + actualsBaseValue * phaseInfo.actualsWeight;
                finalValue = blendedRaw;

                actualsDetail = {
                  totalPoints: stats.totalPoints,
                  gamesPlayed: stats.gamesPlayed,
                  ppg: stats.ppg,
                  actualsPercentile: percentile,
                  adpOnlyValue: Math.round(dynastyValue * 100) / 100,
                  actualsOnlyValue: Math.round(actualsBaseValue * 100) / 100,
                  actualsAdjustment: Math.round((finalValue - dynastyValue) * 100) / 100,
                  finalBlendedValue: Math.round(finalValue * 100) / 100,
                };

                const adjPct = Math.round(((finalValue - dynastyValue) / dynastyValue) * 100);
                if (adjPct !== 0) {
                  factors.push(`Actuals Wk1-${phaseInfo.lastCompletedWeek} ${adjPct >= 0 ? "+" : ""}${adjPct}%`);
                }
              }
              // If player has no actuals data → keep full ADP+dynasty value (no zero assignment)
            }

            valuations.push({
              name,
              value: finalValue,
              adpUsed: adp,
              dynastyFactors: factors,
              valueStatus: "resolved",
              actualsDetail,
            });
          } else {
            valuations.push({
              name: `⚠️ ${name} (no ADP)`,
              value: 0,
              adpUsed: null,
              dynastyFactors: ["Unresolved: player not found in ADP data"],
              valueStatus: "unresolved",
              actualsDetail: null,
            });
          }
        } else {
          // Draft pick — no actuals blending for picks
          const year = asset.pickYear ?? null;
          const round = asset.pickRound ?? 6;
          const pickNum = asset.pickNumber ?? undefined;
          if (year === null) {
            const pickLabel = pickNum ? `Rd ${round} Pick ${pickNum}` : `Rd ${round}`;
            valuations.push({
              name: `⚠️ ${pickLabel} (no year)`,
              value: 0,
              adpUsed: null,
              dynastyFactors: ["Unresolved: missing pick year"],
              valueStatus: "unresolved",
              actualsDetail: null,
            });
          } else {
            const expectedAdp = pickToExpectedAdp(round, year, pickNum);
            const discount = getYearDiscount(year, mod.futurePickDiscount);
            const rawValue = calcValue(expectedAdp, mod.valueCurve);
            const value = rawValue * discount;
            const pickLabel = pickNum ? `${year} Rd ${round} Pick ${pickNum}` : `${year} Rd ${round}`;
            valuations.push({
              name: pickLabel,
              value,
              adpUsed: expectedAdp,
              dynastyFactors: [],
              valueStatus: "resolved",
              actualsDetail: null,
            });
          }
        }
      }

      const unresolvedAssets = valuations.filter((v) => v.valueStatus === "unresolved");
      return {
        assets: valuations,
        totalValue: valuations.reduce((sum, v) => sum + v.value, 0),
        hasUnresolved: unresolvedAssets.length > 0,
        unresolvedReasons: unresolvedAssets.map((v) => v.dynastyFactors[0] ?? `${v.name} has no value`),
      };
    }

    // ── Step 7: Evaluate both sides ──
    const teamASide = evaluateSide(teamAGives);
    const teamBSide = evaluateSide(teamBGives);

    const avgValue = (teamASide.totalValue + teamBSide.totalValue) / 2;
    const pctDifference = avgValue > 0
      ? ((teamBSide.totalValue - teamASide.totalValue) / avgValue) * 100
      : 0;

    const hasAnyUnresolved = teamASide.hasUnresolved || teamBSide.hasUnresolved;

    let winningTeamId: number | null = null;
    if (!hasAnyUnresolved && Math.abs(pctDifference) > mod.fairTolerance) {
      winningTeamId = pctDifference > 0 ? teamAId : teamBId;
    }

    const verdict = hasAnyUnresolved
      ? { label: "Data Incomplete", emoji: "⚠️", severity: "incomplete" }
      : getVerdict(pctDifference, mod.fairTolerance, mod.verdictScale);
    const verdictStatus = hasAnyUnresolved ? "incomplete" as const : "definitive" as const;

    // ── Step 8: Build Actuals context for audit ──
    const actualsContext: z.infer<typeof ActualsContextSchema> = {
      valuationDate,
      season: CURRENT_SEASON,
      seasonPhase: phaseInfo.seasonPhase,
      lastCompletedWeek: phaseInfo.lastCompletedWeek,
      weeksIncluded: phaseInfo.seasonPhase === "preseason" ? 0 : phaseInfo.lastCompletedWeek,
      actualsWeight: phaseInfo.actualsWeight,
      adpWeight: Math.round((1 - phaseInfo.actualsWeight) * 1000) / 1000,
      actualsAvailable: playersWithActuals > 0,
      playersWithActuals,
    };

    // ── Step 9: Deal Déjà Vu ──
    const playerNamesInTrade = [
      ...teamAGives.filter((a) => a.type === "player").map((a) => a.playerName ? normalizeName(a.playerName) : undefined),
      ...teamBGives.filter((a) => a.type === "player").map((a) => a.playerName ? normalizeName(a.playerName) : undefined),
    ].filter(Boolean) as string[];

    const dejaVu: z.infer<typeof DejaVuSchema>[] = [];

    if (playerNamesInTrade.length > 0) {
      const TradeMatchSchema = z.object({
        trade_id: z.coerce.number(),
        trade_number: z.coerce.number(),
        season: z.string(),
        trade_date: z.string().nullable(),
        team_a_name: z.string(),
        team_b_name: z.string(),
        player_name: z.string(),
      });

      const dejaVuLimit = Math.max(1, Math.min(10, Math.round(mod.dejaVuSensitivity)));

      const matches = await ctx.integrations.apps_db.query(
        `SELECT DISTINCT ON (t.id) t.id as trade_id, t.trade_number, t.season,
          t.trade_date::text as trade_date,
          ta_team.team_name as team_a_name, tb_team.team_name as team_b_name,
          assets.player_name
        FROM ffwr_trades t
        JOIN ffwr_trade_assets assets ON assets.trade_id = t.id
        JOIN ffwr_teams ta_team ON ta_team.id = t.team_a_id
        JOIN ffwr_teams tb_team ON tb_team.id = t.team_b_id
        WHERE LOWER(assets.player_name) = ANY($1::text[])
        ORDER BY t.id DESC
        LIMIT ${dejaVuLimit}`,
        TradeMatchSchema,
        [playerNamesInTrade],
        { label: "Find Deal Déjà Vu matches" },
      );

      matches.sort((a, b) => {
        if (a.trade_date && b.trade_date) return b.trade_date.localeCompare(a.trade_date);
        if (a.trade_date) return -1;
        if (b.trade_date) return 1;
        return b.trade_id - a.trade_id;
      });

      if (matches.length > 0) {
        const tradeIds = matches.map((m) => m.trade_id);

        const AssetRowSchema = z.object({
          trade_id: z.coerce.number(),
          asset_type: z.string(),
          player_name: z.string().nullable(),
          player_position: z.string().nullable(),
          player_adp_at_trade: z.coerce.number().nullable(),
          pick_year: z.coerce.number().nullable(),
          pick_round: z.coerce.number().nullable(),
          pick_number: z.coerce.number().nullable(),
          from_team_id: z.coerce.number(),
          from_team_name: z.string(),
        });

        const allAssets = await ctx.integrations.apps_db.query(
          `SELECT a.trade_id, a.asset_type, a.player_name, a.player_position,
            a.player_adp_at_trade, a.pick_year, a.pick_round, a.pick_number,
            a.from_team_id, ft.team_name as from_team_name
          FROM ffwr_trade_assets a
          JOIN ffwr_teams ft ON ft.id = a.from_team_id
          WHERE a.trade_id = ANY($1::int[])
          ORDER BY a.trade_id, a.id
          LIMIT 200`,
          AssetRowSchema,
          [tradeIds],
          { label: "Fetch Déjà Vu trade assets" },
        );

        const assetsByTradeId = new Map<number, z.infer<typeof AssetRowSchema>[]>();
        for (const asset of allAssets) {
          if (!assetsByTradeId.has(asset.trade_id)) assetsByTradeId.set(asset.trade_id, []);
          assetsByTradeId.get(asset.trade_id)!.push(asset);
        }

        for (const match of matches) {
          const tradeAssets = assetsByTradeId.get(match.trade_id) ?? [];

          let historicalVerdict: { label: string; emoji: string; severity: string } | null = null;
          let winnerName: string | null = null;

          const teamAAssetValues: number[] = [];
          const teamBAssetValues: number[] = [];
          for (const ta of tradeAssets) {
            const val = ta.player_adp_at_trade
              ? calcValue(ta.player_adp_at_trade, mod.valueCurve)
              : ta.pick_year && ta.pick_round
                ? calcValue(pickToExpectedAdp(ta.pick_round, ta.pick_year, ta.pick_number ?? undefined), mod.valueCurve)
                : 0;
            if (ta.from_team_name === match.team_a_name) {
              teamAAssetValues.push(val);
            } else {
              teamBAssetValues.push(val);
            }
          }

          const totalA = teamAAssetValues.reduce((s, v) => s + v, 0);
          const totalB = teamBAssetValues.reduce((s, v) => s + v, 0);
          const avg = (totalA + totalB) / 2;
          if (avg > 0) {
            const pct = ((totalB - totalA) / avg) * 100;
            historicalVerdict = getVerdict(pct, mod.fairTolerance, mod.verdictScale);
            if (Math.abs(pct) > mod.fairTolerance) {
              winnerName = pct > 0 ? match.team_a_name : match.team_b_name;
            }
          }

          dejaVu.push({
            tradeNumber: match.trade_number,
            season: match.season,
            tradeDate: match.trade_date,
            teamA: match.team_a_name,
            teamB: match.team_b_name,
            similarity: 0.8,
            summary: `${match.player_name} was previously traded in ${match.season} (#${match.trade_number})`,
            assets: tradeAssets.map((ta) => ({
              assetType: ta.asset_type,
              playerName: ta.player_name,
              playerPosition: ta.player_position,
              playerAdpAtTrade: ta.player_adp_at_trade,
              pickYear: ta.pick_year,
              pickRound: ta.pick_round,
              pickNumber: ta.pick_number,
              fromTeamId: ta.from_team_id,
              fromTeamName: ta.from_team_name,
            })),
            verdict: historicalVerdict,
            winnerName,
          });
        }
      }
    }

    return {
      teamASide,
      teamBSide,
      pctDifference: Math.round(pctDifference * 10) / 10,
      winningTeamId,
      verdict,
      verdictStatus,
      actualsContext,
      dejaVu,
    };
  },
});
