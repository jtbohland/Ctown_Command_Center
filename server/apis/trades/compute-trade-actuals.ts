import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizeName } from "../../lib/normalize-trade-name.js";
import {
  computeActualsValue,
  getSeasonPhaseInfo as getCanonicalSeasonPhaseInfo,
  NFL_WEEK1_TUESDAY,
  REGULAR_SEASON_WEEKS,
  VALUATION_SPEC_FINGERPRINT,
  VALUATION_SPEC_VERSION,
} from "../../lib/valuation/valuation-spec.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── NFL Season Calendar ─────────────────────────────────
// The calendar and the phase/weight curve now come from the canonical spec.
//
// This file previously kept its own copy of REGULAR_SEASON_WEEKS that recorded
// the 2020-21 season as 18 weeks. Every other engine — the backfill, the
// provenance report and the verdict audit — recorded it as 17, which is what
// the 2020 NFL season actually was (16 games / 17 weeks; the 17-game, 18-week
// era began in 2021). That single-key disagreement moved the late-season
// ramp and the postseason cutoff for 2020-21 trades, so the same trade could
// be blended at a different weight here than in the ledger. Importing the
// spec removes the divergence.

/**
 * Given a trade date and season, determine:
 * - lastCompletedWeek: 0 = preseason, 1-18 = in-season
 * - seasonPhase: preseason | early | mid | late | postseason
 * - actualsWeight: automatic phase-based weight (0.0 - 0.85)
 * - cutoffDate: the last date whose weekly data is included
 *
 * Thin wrapper over the canonical getSeasonPhaseInfo. The only thing added
 * here is `cutoffDate`, which is specific to how this API slices weekly rows
 * and is derived from the canonical `lastCompletedWeek` — never recomputed.
 */
function getSeasonPhaseInfo(tradeDate: string, season: string) {
  const phase = getCanonicalSeasonPhaseInfo(tradeDate, season);
  const week1Tuesday = NFL_WEEK1_TUESDAY[season];

  if (!week1Tuesday) {
    // Unknown season — canonical spec reports preseason; keep the trade date
    // as the cutoff so downstream week filtering selects nothing.
    return { ...phase, cutoffDate: tradeDate };
  }

  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const week1Ms = new Date(week1Tuesday).getTime();

  if (phase.lastCompletedWeek === 0) {
    return { ...phase, cutoffDate: tradeDate };
  }

  // Cutoff date = Tuesday after last completed week
  const cutoffMs = week1Ms + phase.lastCompletedWeek * msPerWeek;
  const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

  return { ...phase, cutoffDate };
}

// ─── Schemas ─────────────────────────────────────────────────

// Each row from ffwr_season_actuals with weekly data
const WeeklyActualsSchema = z.object({
  player_name: z.string(),
  position: z.string(),
  season: z.string(),
  overall_rank: z.coerce.number(),
  positional_rank: z.coerce.number(),
  games_played: z.coerce.number(),
  avg_points: z.coerce.number(),
  total_points: z.coerce.number(),
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

type WeeklyActualsRow = z.infer<typeof WeeklyActualsSchema>;

// normalizeName imported from shared module

/**
 * Extract weekly scores from a row up to a given week.
 * Returns { totalPoints, gamesPlayed, ppg } through the cutoff.
 */
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
      // A non-null week means the player had a score (even 0 counts as playing)
      // But some sources put 0 for bye weeks — we count games where pts > 0
      // Actually: FantasyPros puts null for bye/DNP, so non-null = played
      games++;
    }
  }

  const ppg = games > 0 ? Math.round((total / games) * 100) / 100 : 0;
  total = Math.round(total * 100) / 100;

  return { totalPoints: total, gamesPlayed: games, ppg };
}

/**
 * Compute position-normalized percentiles for a set of players through cutoff.
 * Groups by position, then ranks within position by total points and PPG.
 *
 * Returns: normalized_name → { totalPtsPercentile, ppgPercentile, actualsValue }
 *
 * actualsValue = 60% totalPtsPercentile + 40% ppgPercentile (spec formula)
 */
function computePositionalPercentiles(
  players: Array<{
    normalizedName: string;
    position: string;
    totalPoints: number;
    ppg: number;
    gamesPlayed: number;
  }>,
): Map<string, { totalPtsPercentile: number; ppgPercentile: number; actualsValue: number; posRankByPts: number; posRankByPpg: number; positionTotal: number }> {
  // Group by position
  const byPosition = new Map<string, typeof players>();
  for (const p of players) {
    const pos = p.position.toUpperCase();
    if (!byPosition.has(pos)) byPosition.set(pos, []);
    byPosition.get(pos)!.push(p);
  }

  const result = new Map<string, { totalPtsPercentile: number; ppgPercentile: number; actualsValue: number; posRankByPts: number; posRankByPpg: number; positionTotal: number }>();

  for (const [pos, group] of byPosition.entries()) {
    const totalInPos = group.length;

    // Rank by total points (descending)
    const byPts = [...group].sort((a, b) => b.totalPoints - a.totalPoints);
    const ptsRankMap = new Map<string, number>();
    byPts.forEach((p, i) => ptsRankMap.set(p.normalizedName, i + 1));

    // Rank by PPG (descending) — only players with games played
    const byPpg = [...group]
      .filter(p => p.gamesPlayed > 0)
      .sort((a, b) => b.ppg - a.ppg);
    const ppgRankMap = new Map<string, number>();
    const ppgTotal = byPpg.length;
    byPpg.forEach((p, i) => ppgRankMap.set(p.normalizedName, i + 1));

    for (const p of group) {
      const ptsRank = ptsRankMap.get(p.normalizedName) ?? totalInPos;
      const ppgRank = ppgRankMap.get(p.normalizedName) ?? ppgTotal;

      // Percentile: (total - rank + 1) / total × 100
      const totalPtsPercentile = Math.round(
        ((totalInPos - ptsRank + 1) / totalInPos) * 100 * 10
      ) / 10;
      const ppgPercentile = ppgTotal > 0
        ? Math.round(((ppgTotal - ppgRank + 1) / ppgTotal) * 100 * 10) / 10
        : 0;

      // Spec formula: ACTUALS_PTS_WEIGHT total-pts + ACTUALS_PPG_WEIGHT PPG.
      const actualsValue = computeActualsValue(totalPtsPercentile, ppgPercentile);

      result.set(p.normalizedName, {
        totalPtsPercentile,
        ppgPercentile,
        actualsValue,
        posRankByPts: ptsRank,
        posRankByPpg: ppgRank,
        positionTotal: totalInPos,
      });
    }
  }

  return result;
}

// ─── Output Schema ───────────────────────────────────────────
const PlayerActualsResultSchema = z.object({
  playerName: z.string(),
  normalizedName: z.string(),
  position: z.string(),
  season: z.string(),
  seasonPhase: z.string(),
  lastCompletedWeek: z.number(),
  cutoffDate: z.string(),
  totalWeeks: z.number(),
  // Through-cutoff stats
  cumulativePprPoints: z.number(),
  gamesPlayed: z.number(),
  ppg: z.number(),
  // Position-normalized percentiles
  totalPtsPercentile: z.number(),
  ppgPercentile: z.number(),
  posRankByPts: z.number(),
  posRankByPpg: z.number(),
  positionTotal: z.number(),
  // Computed values
  actualsValue: z.number(),     // 0-100 normalized score
  actualsWeight: z.number(),    // 0.0-0.85 phase-based weight
  // Full-season stats (for reference / postseason)
  fullSeasonTotalPoints: z.number(),
  fullSeasonGamesPlayed: z.number(),
  fullSeasonPpg: z.number(),
  fullSeasonOverallRank: z.number(),
  fullSeasonPositionalRank: z.number(),
});

const TradeActualsResultSchema = z.object({
  tradeId: z.number(),
  tradeSeason: z.string(),
  tradeDate: z.string().nullable(),
  seasonPhase: z.string(),
  lastCompletedWeek: z.number(),
  cutoffDate: z.string(),
  actualsWeight: z.number(),
  totalWeeks: z.number(),
  playerActuals: z.array(PlayerActualsResultSchema),
});

export default api({
  name: "ComputeTradeActuals",
  description: "Computes trade-date-aware actuals through cutoff for each player in specified trades.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    // Trades to compute actuals for
    // Each entry: { tradeId, season, tradeDate }
    trades: z.array(z.object({
      tradeId: z.number(),
      season: z.string(),
      tradeDate: z.string().nullable(),
    })),
  }),

  output: z.object({
    results: z.array(TradeActualsResultSchema),
    seasonsLoaded: z.array(z.string()),
    totalPlayersProcessed: z.number(),
    // Which build of the canonical valuation spec produced these weights.
    valuationSpec: z.object({
      version: z.string(),
      fingerprint: z.string(),
    }),
  }),

  async run(ctx, { trades }) {
    if (trades.length === 0) {
      return {
        results: [],
        seasonsLoaded: [],
        totalPlayersProcessed: 0,
        valuationSpec: {
          version: VALUATION_SPEC_VERSION,
          fingerprint: VALUATION_SPEC_FINGERPRINT,
        },
      };
    }

    // ── Step 1: Determine which seasons we need actuals for ──
    const seasonsNeeded = new Set<string>();
    for (const t of trades) {
      seasonsNeeded.add(t.season);
      // For preseason trades, we might want prior-season actuals too
      // Parse "2024-25" → prior season "2023-24"
      const yearStart = parseInt(t.season.split("-")[0]);
      if (yearStart > 2018) {
        const priorSeason = `${yearStart - 1}-${String(yearStart).slice(2)}`;
        seasonsNeeded.add(priorSeason);
      }
    }

    ctx.log.info(`Loading actuals for seasons: ${[...seasonsNeeded].join(", ")}`);

    // ── Step 2: Load weekly actuals for all needed seasons ──
    const allActuals = new Map<string, WeeklyActualsRow[]>(); // season → rows
    for (const season of seasonsNeeded) {
      const rows = await ctx.integrations.apps_db.query(
        `SELECT player_name, position, season, overall_rank, positional_rank,
                games_played, avg_points, total_points,
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
      allActuals.set(season, rows);
      ctx.log.info(`Loaded ${rows.length} player-season rows for ${season}`);
    }

    // ── Step 3: Get player names involved in these trades ──
    const tradeIds = trades.map(t => t.tradeId);
    const PlayerAssetSchema = z.object({
      trade_id: z.coerce.number(),
      player_name: z.string(),
      player_position: z.string().nullable(),
    });

    const playerAssets = await ctx.integrations.apps_db.query(
      `SELECT trade_id, player_name, player_position
       FROM ffwr_trade_assets
       WHERE trade_id = ANY($1::int[]) AND asset_type = 'player' AND player_name IS NOT NULL
       ORDER BY trade_id`,
      PlayerAssetSchema,
      [tradeIds],
      { label: "Fetch player assets for trades" }
    );

    // Build lookup: tradeId → player names
    const tradePlayerMap = new Map<number, Array<{ name: string; position: string | null }>>();
    for (const pa of playerAssets) {
      if (!tradePlayerMap.has(pa.trade_id)) tradePlayerMap.set(pa.trade_id, []);
      tradePlayerMap.get(pa.trade_id)!.push({ name: pa.player_name, position: pa.player_position });
    }

    // ── Step 4: Process each trade ──
    const results: z.infer<typeof TradeActualsResultSchema>[] = [];
    let totalPlayersProcessed = 0;

    for (const trade of trades) {
      const { tradeId, season, tradeDate } = trade;

      // Determine season phase from trade date
      const phaseInfo = tradeDate
        ? getSeasonPhaseInfo(tradeDate, season)
        : { lastCompletedWeek: 0, seasonPhase: "preseason" as const, actualsWeight: 0, cutoffDate: "", totalWeeks: REGULAR_SEASON_WEEKS[season] ?? 18 };

      const tradePlayers = tradePlayerMap.get(tradeId) ?? [];
      const seasonActuals = allActuals.get(season) ?? [];

      // Build name lookup for this season's actuals
      const actualsLookup = new Map<string, WeeklyActualsRow>();
      for (const row of seasonActuals) {
        actualsLookup.set(normalizeName(row.player_name), row);
      }

      // If postseason and we want full-season data, lastCompletedWeek = totalWeeks
      const weekCutoff = phaseInfo.seasonPhase === "postseason"
        ? phaseInfo.totalWeeks
        : phaseInfo.lastCompletedWeek;

      // Compute through-cutoff stats for ALL players in this season (for percentiles)
      const allPlayerCutoffStats: Array<{
        normalizedName: string;
        position: string;
        totalPoints: number;
        ppg: number;
        gamesPlayed: number;
        row: WeeklyActualsRow;
      }> = [];

      if (weekCutoff > 0) {
        for (const row of seasonActuals) {
          const cutoffStats = computeThroughCutoff(row, weekCutoff);
          allPlayerCutoffStats.push({
            normalizedName: normalizeName(row.player_name),
            position: row.position.toUpperCase(),
            ...cutoffStats,
            row,
          });
        }
      }

      // Compute positional percentiles for all players through cutoff
      const percentiles = weekCutoff > 0
        ? computePositionalPercentiles(allPlayerCutoffStats)
        : new Map();

      // Build results for each player in this trade
      const playerActuals: z.infer<typeof PlayerActualsResultSchema>[] = [];

      for (const player of tradePlayers) {
        const nameNorm = normalizeName(player.name);
        const actualsRow = actualsLookup.get(nameNorm);

        if (!actualsRow) {
          // No actuals — fallback entry with zeros (client will use baseline only)
          playerActuals.push({
            playerName: player.name,
            normalizedName: nameNorm,
            position: player.position?.toUpperCase() ?? "UNK",
            season,
            seasonPhase: phaseInfo.seasonPhase,
            lastCompletedWeek: phaseInfo.lastCompletedWeek,
            cutoffDate: phaseInfo.cutoffDate,
            totalWeeks: phaseInfo.totalWeeks,
            cumulativePprPoints: 0,
            gamesPlayed: 0,
            ppg: 0,
            totalPtsPercentile: 0,
            ppgPercentile: 0,
            posRankByPts: 0,
            posRankByPpg: 0,
            positionTotal: 0,
            actualsValue: 0,
            actualsWeight: phaseInfo.actualsWeight,
            fullSeasonTotalPoints: 0,
            fullSeasonGamesPlayed: 0,
            fullSeasonPpg: 0,
            fullSeasonOverallRank: 0,
            fullSeasonPositionalRank: 0,
          });
          totalPlayersProcessed++;
          continue;
        }

        // Through-cutoff stats
        const cutoffStats = weekCutoff > 0
          ? computeThroughCutoff(actualsRow, weekCutoff)
          : { totalPoints: 0, gamesPlayed: 0, ppg: 0 };

        // Position percentiles
        const pctData = percentiles.get(nameNorm) ?? {
          totalPtsPercentile: 0,
          ppgPercentile: 0,
          actualsValue: 0,
          posRankByPts: 0,
          posRankByPpg: 0,
          positionTotal: 0,
        };

        playerActuals.push({
          playerName: player.name,
          normalizedName: nameNorm,
          position: actualsRow.position.toUpperCase(),
          season,
          seasonPhase: phaseInfo.seasonPhase,
          lastCompletedWeek: phaseInfo.lastCompletedWeek,
          cutoffDate: phaseInfo.cutoffDate,
          totalWeeks: phaseInfo.totalWeeks,
          cumulativePprPoints: cutoffStats.totalPoints,
          gamesPlayed: cutoffStats.gamesPlayed,
          ppg: cutoffStats.ppg,
          totalPtsPercentile: pctData.totalPtsPercentile,
          ppgPercentile: pctData.ppgPercentile,
          posRankByPts: pctData.posRankByPts,
          posRankByPpg: pctData.posRankByPpg,
          positionTotal: pctData.positionTotal,
          actualsValue: pctData.actualsValue,
          actualsWeight: phaseInfo.actualsWeight,
          fullSeasonTotalPoints: Number(actualsRow.total_points),
          fullSeasonGamesPlayed: actualsRow.games_played,
          fullSeasonPpg: Number(actualsRow.avg_points),
          fullSeasonOverallRank: actualsRow.overall_rank,
          fullSeasonPositionalRank: actualsRow.positional_rank,
        });
        totalPlayersProcessed++;
      }

      results.push({
        tradeId,
        tradeSeason: season,
        tradeDate,
        seasonPhase: phaseInfo.seasonPhase,
        lastCompletedWeek: phaseInfo.lastCompletedWeek,
        cutoffDate: phaseInfo.cutoffDate,
        actualsWeight: phaseInfo.actualsWeight,
        totalWeeks: phaseInfo.totalWeeks,
        playerActuals,
      });
    }

    return {
      results,
      seasonsLoaded: [...seasonsNeeded],
      totalPlayersProcessed,
      valuationSpec: {
        version: VALUATION_SPEC_VERSION,
        fingerprint: VALUATION_SPEC_FINGERPRINT,
      },
    };
  },
});
