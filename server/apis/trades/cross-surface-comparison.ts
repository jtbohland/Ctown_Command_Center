import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizeName, extractKeeperRightsPlayer } from "../../lib/normalize-trade-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Constants (matching backfill engine exactly) ────────────
const BASE_VALUE = 10000;
const POWER = 0.6;
const KEEPERS_PER_TEAM = 4;
const FAIR_TOLERANCE = 5;

const LEAGUE_SIZE_BY_YEAR: Record<number, number> = {
  2019: 10, 2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 10,
  2025: 11, 2026: 11, 2027: 11, 2028: 11,
};
const DEFAULT_LEAGUE_SIZE = 11;

function getLeagueSize(year: number): number {
  return LEAGUE_SIZE_BY_YEAR[year] ?? DEFAULT_LEAGUE_SIZE;
}
function getKeeperOffset(year: number): number {
  return getLeagueSize(year) * KEEPERS_PER_TEAM;
}
function calcPlayerValue(adpRank: number): number {
  if (adpRank <= 0) return 0;
  return BASE_VALUE * Math.pow(1 / adpRank, POWER);
}
function calcPickValue(round: number, year: number, pickInRound?: number): number {
  const leagueSize = getLeagueSize(year);
  const startOfRound = (round - 1) * leagueSize + 1;
  const endOfRound = round * leagueSize;
  const draftPosition = pickInRound
    ? startOfRound + pickInRound - 1
    : (startOfRound + endOfRound) / 2;
  const effectiveAdp = draftPosition + getKeeperOffset(year);
  return calcPlayerValue(effectiveAdp);
}

// Client-side YEAR_DISCOUNT (from trade-utils.ts) — no future-pick discounting
const CLIENT_YEAR_DISCOUNT: Record<number, number> = {
  2026: 1.0, 2027: 0.8, 2028: 0.65,
};
function calcPickValueClientStyle(round: number, year: number, pickInRound?: number): number {
  const leagueSize = getLeagueSize(year);
  const startOfRound = (round - 1) * leagueSize + 1;
  const endOfRound = round * leagueSize;
  const draftPosition = pickInRound
    ? startOfRound + pickInRound - 1
    : (startOfRound + endOfRound) / 2;
  const effectiveAdp = draftPosition + getKeeperOffset(year);
  const discount = CLIENT_YEAR_DISCOUNT[year] ?? 0.5;
  return calcPlayerValue(effectiveAdp) * discount;
}

function getVerdict(pctDiff: number): { label: string; severity: string } {
  const absDiff = Math.abs(pctDiff);
  if (absDiff <= 5) return { label: "Fair Catch", severity: "fair" };
  if (absDiff <= 15) return { label: "Edge Rush", severity: "slight" };
  if (absDiff <= 25) return { label: "Pick Six", severity: "clear" };
  return { label: "Flag on the Play", severity: "robbery" };
}

function seasonToDraftYear(season: string): number {
  return parseInt(season.split("-")[0]);
}

// ─── Schemas ─────────────────────────────────────────────────
const TradeRow = z.object({
  id: z.coerce.number(),
  trade_number: z.coerce.number(),
  season: z.string(),
  trade_date: z.string().nullable(),
  team_a_id: z.coerce.number(),
  team_b_id: z.coerce.number(),
  team_c_id: z.coerce.number().nullable(),
  trade_type: z.string().nullable(),
  verdict_label: z.string().nullable(),
  verdict_severity: z.string().nullable(),
  winner_team_id: z.coerce.number().nullable(),
  pct_difference: z.coerce.number().nullable(),
  team_a_total: z.coerce.number().nullable(),
  team_b_total: z.coerce.number().nullable(),
  valuation_complete: z.coerce.boolean().nullable(),
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

const ComparisonEntry = z.object({
  tradeId: z.number(),
  tradeNumber: z.number(),
  season: z.string(),
  tradeType: z.string(),
  // Database stored values (canonical)
  db: z.object({
    verdictLabel: z.string().nullable(),
    verdictSeverity: z.string().nullable(),
    winnerTeamId: z.number().nullable(),
    pctDifference: z.number().nullable(),
    teamATotal: z.number().nullable(),
    teamBTotal: z.number().nullable(),
  }),
  // Client-side recalculation (what Ledger/History currently show)
  clientSide: z.object({
    verdictLabel: z.string(),
    verdictSeverity: z.string(),
    winnerTeamId: z.number().nullable(),
    pctDifference: z.number(),
    teamATotal: z.number(),
    teamBTotal: z.number(),
  }),
  // Mismatch flags
  verdictMismatch: z.boolean(),
  winnerMismatch: z.boolean(),
  totalsMismatch: z.boolean(),
  pctMismatch: z.boolean(),
  anyMismatch: z.boolean(),
});

export default api({
  name: "CrossSurfaceComparison",
  description: "Read-only comparison of DB-stored vs client-side-computed verdicts for all trades.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    totalTrades: z.number(),
    mismatches: z.number(),
    verdictMismatches: z.number(),
    winnerMismatches: z.number(),
    totalsMismatches: z.number(),
    pctMismatches: z.number(),
    comparisons: z.array(ComparisonEntry),
    mismatchDetails: z.array(ComparisonEntry),
    summary: z.object({
      dbVerdictDistribution: z.record(z.string(), z.number()),
      clientVerdictDistribution: z.record(z.string(), z.number()),
      threeTeamCount: z.number(),
      fairCatchDbCount: z.number(),
      fairCatchClientCount: z.number(),
    }),
  }),

  async run(ctx) {
    // ── Load all trades with stored verdicts ──
    const trades = await ctx.integrations.apps_db.query(
      `SELECT t.id, t.trade_number, t.season, t.trade_date,
              t.team_a_id, t.team_b_id, t.team_c_id, t.trade_type,
              t.verdict_label, t.verdict_severity, t.winner_team_id,
              t.pct_difference, t.team_a_total, t.team_b_total,
              t.valuation_complete
       FROM ffwr_trades t
       ORDER BY t.season, t.trade_number
       LIMIT 500`,
      TradeRow,
      undefined,
      { label: "Load all trades with stored verdicts" }
    );

    // ── Load all trade assets ──
    const allAssets = await ctx.integrations.apps_db.query(
      `SELECT id, trade_id, from_team_id, asset_type, player_name,
              player_position, player_adp_at_trade, pick_year, pick_round, pick_number
       FROM ffwr_trade_assets
       ORDER BY trade_id, id
       LIMIT 2000`,
      AssetRow,
      undefined,
      { label: "Load all trade assets" }
    );

    // ── Load ADP data for all seasons ──
    const allAdp = await ctx.integrations.apps_db.query(
      `SELECT player_name, adp_rank, season, position
       FROM ffwr_historical_adp
       ORDER BY season, adp_rank
       LIMIT 6000`,
      AdpRow,
      undefined,
      { label: "Load all historical ADP" }
    );

    // Build season → (normalized name → adp_rank) maps
    const adpBySeason = new Map<string, Map<string, number>>();
    for (const row of allAdp) {
      if (!adpBySeason.has(row.season)) adpBySeason.set(row.season, new Map());
      adpBySeason.get(row.season)!.set(normalizeName(row.player_name), row.adp_rank);
    }

    // Group assets by trade
    const assetsByTrade = new Map<number, z.infer<typeof AssetRow>[]>();
    for (const a of allAssets) {
      if (!assetsByTrade.has(a.trade_id)) assetsByTrade.set(a.trade_id, []);
      assetsByTrade.get(a.trade_id)!.push(a);
    }

    // ── Compute client-side valuations (replicating evaluateHistoricalTrade) ──
    // This mirrors trade-utils.ts: ADP-based power-law + simple year discount
    // NO actuals blending, NO positional baselines, NO future-pick discounts from backfill
    const comparisons: z.infer<typeof ComparisonEntry>[] = [];

    for (const trade of trades) {
      const assets = assetsByTrade.get(trade.id) ?? [];
      const isThreeTeam = trade.trade_type === "three_team" && trade.team_c_id != null;
      const seasonMap = adpBySeason.get(trade.season);

      // Client-side sum: same logic as evaluateHistoricalTrade in trade-utils.ts
      function sumSide(teamId: number): number {
        const sideAssets = assets.filter(a => a.from_team_id === teamId);
        let total = 0;
        for (const a of sideAssets) {
          if (a.asset_type === "player") {
            const adp = a.player_adp_at_trade ??
              (seasonMap?.get(normalizeName(a.player_name ?? "")) ?? null);
            if (adp && adp > 0) {
              total += calcPlayerValue(adp);
            }
            // Client-side: unranked players get 0 without dynasty ctx
            // (This is the minimal path — dynasty multipliers skipped for comparison purity)
          } else {
            const year = a.pick_year;
            const round = a.pick_round ?? 6;
            if (year !== null && year !== undefined) {
              total += calcPickValueClientStyle(round, year, a.pick_number ?? undefined);
            }
          }
        }
        return Math.round(total * 100) / 100;
      }

      let clientTeamA: number;
      let clientTeamB: number;

      if (isThreeTeam) {
        // For three-team: client replicates the two-team path (team_a vs team_b only)
        clientTeamA = sumSide(trade.team_a_id);
        clientTeamB = sumSide(trade.team_b_id);
      } else {
        clientTeamA = sumSide(trade.team_a_id);
        clientTeamB = sumSide(trade.team_b_id);
      }

      const avgValue = (clientTeamA + clientTeamB) / 2;
      const clientPct = avgValue > 0
        ? Math.round(((clientTeamB - clientTeamA) / avgValue) * 100 * 10) / 10
        : 0;

      const clientVerdict = getVerdict(clientPct);
      let clientWinner: number | null = null;
      if (Math.abs(clientPct) > FAIR_TOLERANCE) {
        clientWinner = clientPct > 0 ? trade.team_a_id : trade.team_b_id;
      }

      // ── Compare ──
      const dbSeverity = trade.verdict_severity;
      const dbPct = trade.pct_difference ?? 0;
      const dbTeamA = trade.team_a_total ?? 0;
      const dbTeamB = trade.team_b_total ?? 0;

      const verdictMismatch = dbSeverity !== clientVerdict.severity;
      const winnerMismatch = trade.winner_team_id !== clientWinner;
      const totalsMismatch = Math.abs(dbTeamA - clientTeamA) > 1 || Math.abs(dbTeamB - clientTeamB) > 1;
      const pctMismatch = Math.abs(dbPct - clientPct) > 0.5;

      comparisons.push({
        tradeId: trade.id,
        tradeNumber: trade.trade_number,
        season: trade.season,
        tradeType: isThreeTeam ? "three_team" : "two_team",
        db: {
          verdictLabel: trade.verdict_label,
          verdictSeverity: dbSeverity,
          winnerTeamId: trade.winner_team_id,
          pctDifference: dbPct,
          teamATotal: dbTeamA,
          teamBTotal: dbTeamB,
        },
        clientSide: {
          verdictLabel: clientVerdict.label,
          verdictSeverity: clientVerdict.severity,
          winnerTeamId: clientWinner,
          pctDifference: clientPct,
          teamATotal: clientTeamA,
          teamBTotal: clientTeamB,
        },
        verdictMismatch,
        winnerMismatch,
        totalsMismatch,
        pctMismatch,
        anyMismatch: verdictMismatch || winnerMismatch || totalsMismatch || pctMismatch,
      });
    }

    // ── Build summary ──
    const dbVerdictDist: Record<string, number> = {};
    const clientVerdictDist: Record<string, number> = {};
    let threeTeamCount = 0;
    let fairCatchDbCount = 0;
    let fairCatchClientCount = 0;

    for (const c of comparisons) {
      const dbSev = c.db.verdictSeverity ?? "unknown";
      dbVerdictDist[dbSev] = (dbVerdictDist[dbSev] ?? 0) + 1;
      clientVerdictDist[c.clientSide.verdictSeverity] = (clientVerdictDist[c.clientSide.verdictSeverity] ?? 0) + 1;
      if (c.tradeType === "three_team") threeTeamCount++;
      if (dbSev === "fair") fairCatchDbCount++;
      if (c.clientSide.verdictSeverity === "fair") fairCatchClientCount++;
    }

    const mismatchDetails = comparisons.filter(c => c.anyMismatch);

    return {
      totalTrades: comparisons.length,
      mismatches: mismatchDetails.length,
      verdictMismatches: comparisons.filter(c => c.verdictMismatch).length,
      winnerMismatches: comparisons.filter(c => c.winnerMismatch).length,
      totalsMismatches: comparisons.filter(c => c.totalsMismatch).length,
      pctMismatches: comparisons.filter(c => c.pctMismatch).length,
      comparisons,
      mismatchDetails,
      summary: {
        dbVerdictDistribution: dbVerdictDist,
        clientVerdictDistribution: clientVerdictDist,
        threeTeamCount,
        fairCatchDbCount,
        fairCatchClientCount,
      },
    };
  },
});
