import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Value Engine Constants ─────────────────────────────────
const BASE_VALUE = 10000;
const POWER = 0.6;
const TOTAL_TEAMS = 11;
const ROUNDS_PER_DRAFT = 11;
const KEEPERS_PER_TEAM = 4;
const KEEPER_OFFSET = TOTAL_TEAMS * KEEPERS_PER_TEAM; // 44 players locked on rosters before draft

// Future pick discount factors
const YEAR_DISCOUNT: Record<number, number> = {
  2026: 1.0,
  2027: 0.8,
  2028: 0.65,
};

// Expected ADP range by round (11 teams per round)
// In a 4-keeper league, 44 players are already rostered.
// Round 1 picks target players 45-55, Round 2 targets 56-66, etc.
function pickToExpectedAdp(round: number, pickInRound?: number): number {
  const startOfRound = (round - 1) * TOTAL_TEAMS + 1;
  const endOfRound = round * TOTAL_TEAMS;
  const draftPosition = pickInRound
    ? startOfRound + pickInRound - 1
    : (startOfRound + endOfRound) / 2;
  // Shift by keeper offset: 1.01 = 45th best player, not 1st
  return draftPosition + KEEPER_OFFSET;
}

// Core value formula: 10000 × (1/rank)^0.6
function calcValue(adpRank: number): number {
  if (adpRank <= 0) return 0;
  return BASE_VALUE * Math.pow(1 / adpRank, POWER);
}

// Verdict thresholds
function getVerdict(pctDiff: number): { label: string; emoji: string; severity: string } {
  const absDiff = Math.abs(pctDiff);
  if (absDiff <= 5) return { label: "Fair Trade", emoji: "⚖️", severity: "fair" };
  if (absDiff <= 15) return { label: "Slight Edge", emoji: "📈", severity: "slight" };
  if (absDiff <= 25) return { label: "Clear Winner", emoji: "🏆", severity: "clear" };
  return { label: "Highway Robbery", emoji: "🚨", severity: "robbery" };
}

const AssetInputSchema = z.object({
  type: z.enum(["player", "pick"]),
  playerName: z.string().nullable().optional(),
  playerPosition: z.string().nullable().optional(),
  playerAdp: z.number().nullable().optional(),
  pickYear: z.number().nullable().optional(),
  pickRound: z.number().nullable().optional(),
  pickNumber: z.number().nullable().optional(),
});

const ValuationSchema = z.object({
  name: z.string(),
  value: z.number(),
  adpUsed: z.number().nullable(),
});

const SideResultSchema = z.object({
  assets: z.array(ValuationSchema),
  totalValue: z.number(),
});

const DejaVuSchema = z.object({
  tradeNumber: z.number(),
  season: z.string(),
  teamA: z.string(),
  teamB: z.string(),
  similarity: z.number(),
  summary: z.string(),
});

const AdpRowSchema = z.object({
  player_name: z.string(),
  adp_rank: z.coerce.number(),
});

export default api({
  name: "EvaluateTrade",
  description: "Evaluates a proposed trade using the power-law valuation engine.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    teamAId: z.number(),
    teamBId: z.number(),
    teamAGives: z.array(AssetInputSchema),
    teamBGives: z.array(AssetInputSchema),
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
    dejaVu: z.array(DejaVuSchema),
  }),

  async run(ctx, { teamAId, teamBId, teamAGives, teamBGives }) {
    // Get current season ADP for player lookups
    const currentAdp = await ctx.integrations.apps_db.query(
      `SELECT player_name, adp_rank FROM ffwr_historical_adp WHERE season = '2025-26' LIMIT 200`,
      AdpRowSchema,
      undefined,
      { label: "Fetch current ADP for valuation" }
    );
    const adpMap = new Map(currentAdp.map((p) => [p.player_name.toLowerCase(), p.adp_rank]));

    // Evaluate one side
    function evaluateSide(assets: z.infer<typeof AssetInputSchema>[]): z.infer<typeof SideResultSchema> {
      const valuations: z.infer<typeof ValuationSchema>[] = [];

      for (const asset of assets) {
        if (asset.type === "player") {
          const name = asset.playerName ?? "Unknown";
          // Use provided ADP, or look up from historical data
          let adp = asset.playerAdp ?? null;
          if (!adp) {
            adp = adpMap.get(name.toLowerCase()) ?? null;
          }
          const value = adp ? calcValue(adp) : 0;
          valuations.push({ name, value, adpUsed: adp });
        } else {
          // Pick valuation
          const year = asset.pickYear ?? 2026;
          const round = asset.pickRound ?? 6; // Default to mid-round if unknown
          const pickNum = asset.pickNumber ?? undefined;
          const expectedAdp = pickToExpectedAdp(round, pickNum);
          const discount = YEAR_DISCOUNT[year] ?? 0.5;
          const rawValue = calcValue(expectedAdp);
          const value = rawValue * discount;
          const pickLabel = pickNum
            ? `${year} Rd ${round} Pick ${pickNum}`
            : `${year} Rd ${round}`;
          valuations.push({ name: pickLabel, value, adpUsed: expectedAdp });
        }
      }

      return {
        assets: valuations,
        totalValue: valuations.reduce((sum, v) => sum + v.value, 0),
      };
    }

    const teamASide = evaluateSide(teamAGives);
    const teamBSide = evaluateSide(teamBGives);

    // Calculate percentage difference (positive means Team B wins)
    const avgValue = (teamASide.totalValue + teamBSide.totalValue) / 2;
    const pctDifference = avgValue > 0
      ? ((teamBSide.totalValue - teamASide.totalValue) / avgValue) * 100
      : 0;

    // Who wins? If Team A gives MORE value, Team B wins (they receive more)
    let winningTeamId: number | null = null;
    if (Math.abs(pctDifference) > 5) {
      winningTeamId = pctDifference > 0 ? teamBId : teamAId;
    }

    const verdict = getVerdict(pctDifference);

    // ── 📡 Deal Déjà Vu — find similar historical trades ──
    // Look for trades involving the same players or similar pick configurations
    const playerNamesInTrade = [
      ...teamAGives.filter((a) => a.type === "player").map((a) => a.playerName?.toLowerCase()),
      ...teamBGives.filter((a) => a.type === "player").map((a) => a.playerName?.toLowerCase()),
    ].filter(Boolean) as string[];

    const dejaVu: z.infer<typeof DejaVuSchema>[] = [];

    if (playerNamesInTrade.length > 0) {
      // Find trades involving any of the same players
      const TradeMatchSchema = z.object({
        trade_id: z.coerce.number(),
        trade_number: z.coerce.number(),
        season: z.string(),
        team_a_name: z.string(),
        team_b_name: z.string(),
        player_name: z.string(),
      });

      const matches = await ctx.integrations.apps_db.query(
        `SELECT DISTINCT ON (t.id) t.id as trade_id, t.trade_number, t.season,
          ta_team.team_name as team_a_name, tb_team.team_name as team_b_name,
          assets.player_name
        FROM ffwr_trades t
        JOIN ffwr_trade_assets assets ON assets.trade_id = t.id
        JOIN ffwr_teams ta_team ON ta_team.id = t.team_a_id
        JOIN ffwr_teams tb_team ON tb_team.id = t.team_b_id
        WHERE LOWER(assets.player_name) = ANY($1::text[])
        ORDER BY t.id, t.trade_number DESC
        LIMIT 5`,
        TradeMatchSchema,
        [playerNamesInTrade],
        { label: "Find Deal Déjà Vu matches" }
      );

      for (const match of matches) {
        dejaVu.push({
          tradeNumber: match.trade_number,
          season: match.season,
          teamA: match.team_a_name,
          teamB: match.team_b_name,
          similarity: 0.8,
          summary: `${match.player_name} was previously traded in ${match.season} (#${match.trade_number})`,
        });
      }
    }

    return {
      teamASide,
      teamBSide,
      pctDifference: Math.round(pctDifference * 10) / 10,
      winningTeamId,
      verdict,
      dejaVu,
    };
  },
});
