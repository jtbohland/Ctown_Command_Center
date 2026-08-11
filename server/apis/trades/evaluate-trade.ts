import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Value Engine Constants ─────────────────────────────────
const BASE_VALUE = 10000;
const POWER = 0.6;
const TOTAL_TEAMS = 11;
const KEEPERS_PER_TEAM = 4;
const KEEPER_OFFSET = TOTAL_TEAMS * KEEPERS_PER_TEAM; // 44

// ─── Dynasty Multiplier Constants ───────────────────────────
const ROOKIE_PREMIUM = 1.10;
const POSITIONAL_SCARCITY = 1.08;
function getAgeFactor(age: number): number {
  if (age <= 24) return 1.06;
  if (age <= 27) return 1.03;
  if (age <= 29) return 1.00;
  if (age <= 31) return 0.95;
  return 0.90;
}

// Future pick discount factors
const YEAR_DISCOUNT: Record<number, number> = {
  2026: 1.0,
  2027: 0.8,
  2028: 0.65,
};

function pickToExpectedAdp(round: number, pickInRound?: number): number {
  const startOfRound = (round - 1) * TOTAL_TEAMS + 1;
  const endOfRound = round * TOTAL_TEAMS;
  const draftPosition = pickInRound
    ? startOfRound + pickInRound - 1
    : (startOfRound + endOfRound) / 2;
  return draftPosition + KEEPER_OFFSET;
}

function calcValue(adpRank: number): number {
  if (adpRank <= 0) return 0;
  return BASE_VALUE * Math.pow(1 / adpRank, POWER);
}

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
  dynastyFactors: z.array(z.string()),
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
  description: "Evaluates a proposed trade using power-law valuation with dynasty multipliers.",

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
    // Get current season ADP with positions
    const currentAdp = await ctx.integrations.apps_db.query(
      `SELECT player_name, adp_rank, position FROM ffwr_historical_adp WHERE season = '2025-26' ORDER BY adp_rank LIMIT 300`,
      AdpRowSchema,
      undefined,
      { label: "Fetch current ADP with positions" }
    );
    const adpMap = new Map(currentAdp.map((p) => [p.player_name.toLowerCase(), p.adp_rank]));

    // Build position → sorted ADP lists for scarcity check
    const positionAdpMap = new Map<string, { name: string; adp: number }[]>();
    for (const p of currentAdp) {
      const pos = p.position.toUpperCase();
      if (!positionAdpMap.has(pos)) positionAdpMap.set(pos, []);
      positionAdpMap.get(pos)!.push({ name: p.player_name.toLowerCase(), adp: p.adp_rank });
    }
    // Sort each position list by ADP
    for (const list of positionAdpMap.values()) {
      list.sort((a, b) => a.adp - b.adp);
    }

    // Get rookie classes for dynasty factors
    let rookieClasses: z.infer<typeof RookieSchema>[] = [];
    try {
      rookieClasses = await ctx.integrations.apps_db.query(
        `SELECT player_name, nfl_draft_year, overall_pick, age_on_draft_day, position
         FROM ffwr_rookie_classes LIMIT 1000`,
        RookieSchema,
        undefined,
        { label: "Fetch rookie classes for dynasty factors" }
      );
    } catch {
      // Table may not exist yet — dynasty factors just won't apply
      ctx.log.warn("ffwr_rookie_classes not found — dynasty factors skipped");
    }

    const CURRENT_DRAFT_YEAR = 2025;

    // Dynasty multiplier helper
    function applyDynasty(
      baseValue: number,
      playerName: string,
      playerPosition: string | null,
      playerAdp: number | null,
    ): { value: number; factors: string[] } {
      if (rookieClasses.length === 0) return { value: baseValue, factors: [] };

      let multiplier = 1.0;
      const factors: string[] = [];
      const nameLower = playerName.toLowerCase();
      const pos = playerPosition?.toUpperCase() ?? "";

      // 1. Rookie premium
      const isRookie = rookieClasses.some(
        (r) => r.nfl_draft_year === CURRENT_DRAFT_YEAR && r.overall_pick <= 50 && r.player_name.toLowerCase() === nameLower,
      );
      if (isRookie) {
        multiplier *= ROOKIE_PREMIUM;
        factors.push("Rookie +10%");
      }

      // 2. Positional scarcity: top 5 QB/TE
      if ((pos === "QB" || pos === "TE") && playerAdp !== null) {
        const posList = positionAdpMap.get(pos) ?? [];
        const rank = posList.findIndex((p) => p.name === nameLower);
        if (rank >= 0 && rank < 5) {
          multiplier *= POSITIONAL_SCARCITY;
          factors.push(`${pos}${rank + 1} Scarcity +8%`);
        }
      }

      // 3. Age curve
      const rookieEntry = rookieClasses.find((r) => r.player_name.toLowerCase() === nameLower);
      if (rookieEntry) {
        const currentAge = rookieEntry.age_on_draft_day + (CURRENT_DRAFT_YEAR - rookieEntry.nfl_draft_year);
        const ageFactor = getAgeFactor(currentAge);
        if (ageFactor !== 1.0) {
          multiplier *= ageFactor;
          const pct = Math.round((ageFactor - 1) * 100);
          factors.push(`Age ${currentAge} ${pct >= 0 ? "+" : ""}${pct}%`);
        }
      }

      return { value: baseValue * multiplier, factors };
    }

    // Evaluate one side
    function evaluateSide(assets: z.infer<typeof AssetInputSchema>[]): z.infer<typeof SideResultSchema> {
      const valuations: z.infer<typeof ValuationSchema>[] = [];

      for (const asset of assets) {
        if (asset.type === "player") {
          const name = asset.playerName ?? "Unknown";
          let adp = asset.playerAdp ?? null;
          if (!adp) adp = adpMap.get(name.toLowerCase()) ?? null;
          const rawValue = adp ? calcValue(adp) : 0;
          const { value, factors } = applyDynasty(rawValue, name, asset.playerPosition ?? null, adp);
          valuations.push({ name, value, adpUsed: adp, dynastyFactors: factors });
        } else {
          const year = asset.pickYear ?? 2026;
          const round = asset.pickRound ?? 6;
          const pickNum = asset.pickNumber ?? undefined;
          const expectedAdp = pickToExpectedAdp(round, pickNum);
          const discount = YEAR_DISCOUNT[year] ?? 0.5;
          const rawValue = calcValue(expectedAdp);
          const value = rawValue * discount;
          const pickLabel = pickNum ? `${year} Rd ${round} Pick ${pickNum}` : `${year} Rd ${round}`;
          valuations.push({ name: pickLabel, value, adpUsed: expectedAdp, dynastyFactors: [] });
        }
      }

      return {
        assets: valuations,
        totalValue: valuations.reduce((sum, v) => sum + v.value, 0),
      };
    }

    const teamASide = evaluateSide(teamAGives);
    const teamBSide = evaluateSide(teamBGives);

    const avgValue = (teamASide.totalValue + teamBSide.totalValue) / 2;
    const pctDifference = avgValue > 0
      ? ((teamBSide.totalValue - teamASide.totalValue) / avgValue) * 100
      : 0;

    let winningTeamId: number | null = null;
    if (Math.abs(pctDifference) > 5) {
      winningTeamId = pctDifference > 0 ? teamBId : teamAId;
    }

    const verdict = getVerdict(pctDifference);

    // ── Deal Déjà Vu ──
    const playerNamesInTrade = [
      ...teamAGives.filter((a) => a.type === "player").map((a) => a.playerName?.toLowerCase()),
      ...teamBGives.filter((a) => a.type === "player").map((a) => a.playerName?.toLowerCase()),
    ].filter(Boolean) as string[];

    const dejaVu: z.infer<typeof DejaVuSchema>[] = [];

    if (playerNamesInTrade.length > 0) {
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
