import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizeName, extractKeeperRightsPlayer } from "../../lib/normalize-trade-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Value Engine Constants (defaults — overridable via modifiers input) ───
const BASE_VALUE = 10000;
const DEFAULT_POWER = 0.6;
const KEEPERS_PER_TEAM = 4;

// C-Town league size by draft year: 10 teams 2019-2024, 11 teams 2025+
// Per spec §3: "C-Town had 10 teams for fantasy draft years 2019–2024 and 11 teams for 2025–2026"
const LEAGUE_SIZE_BY_YEAR: Record<number, number> = {
  2019: 10, 2020: 10, 2021: 10, 2022: 10, 2023: 10, 2024: 10,
  2025: 11, 2026: 11, 2027: 11,
};
const DEFAULT_LEAGUE_SIZE = 11; // for future years beyond the map

function getLeagueSize(year: number): number {
  return LEAGUE_SIZE_BY_YEAR[year] ?? DEFAULT_LEAGUE_SIZE;
}

function getKeeperOffset(year: number): number {
  return getLeagueSize(year) * KEEPERS_PER_TEAM;
}

// ─── Dynasty Multiplier Constants ───────────────────────────
const ROOKIE_MAX_PICK = 128;
const ROOKIE_MIN_BOOST = 0.01;    // +1% at pick 128

function getRookiePremium(overallPick: number, maxBoost: number): number {
  if (overallPick < 1 || overallPick > ROOKIE_MAX_PICK) return 1.0;
  const t = (overallPick - 1) / (ROOKIE_MAX_PICK - 1);
  const boost = ROOKIE_MIN_BOOST + (maxBoost - ROOKIE_MIN_BOOST) * Math.pow(1 - t, 2);
  return 1 + boost;
}

// Raw age factor (before ageCurve multiplier is applied)
function getRawAgeFactor(age: number): number {
  if (age <= 24) return 1.06;
  if (age <= 27) return 1.03;
  if (age <= 29) return 1.00;
  if (age <= 31) return 0.95;
  return 0.90;
}

function getAgeFactor(age: number, ageCurve: number): number {
  if (ageCurve === 0) return 1.0; // age disabled
  const raw = getRawAgeFactor(age);
  // Scale the deviation from 1.0 by ageCurve
  return 1.0 + (raw - 1.0) * ageCurve;
}

// normalizeName + extractKeeperRightsPlayer imported from shared module

// Future pick discount: computed from futurePickDiscount modifier
const CURRENT_YEAR_FOR_DISCOUNT = 2026;
function getYearDiscount(year: number, perYearDiscount: number): number {
  const yearsOut = Math.max(0, year - CURRENT_YEAR_FOR_DISCOUNT);
  if (yearsOut === 0) return 1.0;
  return Math.pow(1 - perYearDiscount, yearsOut);
}

function pickToExpectedAdp(round: number, year: number, overallPick?: number): number {
  const leagueSize = getLeagueSize(year);
  // overallPick is the overall draft position (e.g. pick 28 overall).
  // Use it directly. Only fall back to round midpoint when unknown.
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
  const t1 = fairTolerance;                    // Fair Catch ceiling
  const t2 = fairTolerance + 10 * verdictScale; // Edge Rush ceiling
  const t3 = fairTolerance + 20 * verdictScale; // Pick Six ceiling
  if (absDiff <= t1) return { label: "Fair Catch", emoji: "🧤", severity: "fair" };
  if (absDiff <= t2) return { label: "Edge Rush", emoji: "📈", severity: "slight" };
  if (absDiff <= t3) return { label: "Pick Six", emoji: "🏆", severity: "clear" };
  return { label: "Flag on the Play", emoji: "🚩", severity: "robbery" };
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
  valueStatus: z.enum(["resolved", "unresolved"]),
});

const SideResultSchema = z.object({
  assets: z.array(ValuationSchema),
  totalValue: z.number(),
  hasUnresolved: z.boolean(),
  unresolvedReasons: z.array(z.string()),
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
  description: "Evaluates a proposed trade using power-law valuation with dynasty multipliers.",

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
    dejaVu: z.array(DejaVuSchema),
  }),

  async run(ctx, { teamAId, teamBId, teamAGives, teamBGives, modifiers }) {
    // Merge modifiers with defaults
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
    // Get current season ADP with positions
    const currentAdp = await ctx.integrations.apps_db.query(
      `SELECT player_name, adp_rank, position FROM ffwr_historical_adp WHERE season = '2026-27' ORDER BY adp_rank LIMIT 300`,
      AdpRowSchema,
      undefined,
      { label: "Fetch current ADP with positions" }
    );
    const adpMap = new Map(currentAdp.map((p) => [normalizeName(p.player_name), p.adp_rank]));

    // Build position → sorted ADP lists for scarcity check
    const positionAdpMap = new Map<string, { name: string; adp: number }[]>();
    for (const p of currentAdp) {
      const pos = p.position.toUpperCase();
      if (!positionAdpMap.has(pos)) positionAdpMap.set(pos, []);
      positionAdpMap.get(pos)!.push({ name: normalizeName(p.player_name), adp: p.adp_rank });
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

    const CURRENT_DRAFT_YEAR = 2026;

    // Dynasty multiplier helper — uses mod.* for all tunables
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

      // 1. Graduated rookie premium (picks 1-128, NFL rounds 1-4)
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

      // 2. Positional scarcity: top 5 at position
      if (playerAdp !== null) {
        const posList = positionAdpMap.get(pos) ?? [];
        const rank = posList.findIndex((p) => p.name === nameNorm);
        const isTop5 = rank >= 0 && rank < 5;

        // QB scarcity
        if (pos === "QB" && isTop5 && mod.qbScarcity > 1.0) {
          multiplier *= mod.qbScarcity;
          const pct = Math.round((mod.qbScarcity - 1) * 100);
          factors.push(`QB${rank + 1} Scarcity +${pct}%`);
        }
        // TE premium
        if (pos === "TE" && isTop5 && mod.tePremium > 1.0) {
          multiplier *= mod.tePremium;
          const pct = Math.round((mod.tePremium - 1) * 100);
          factors.push(`TE${rank + 1} Premium +${pct}%`);
        }
      }

      // 3. Positional multipliers (RB/WR — applies to ALL, not just top 5)
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

      // 4. Age curve (uses mod.ageCurve to scale deviation)
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

    // Evaluate one side
    function evaluateSide(assets: z.infer<typeof AssetInputSchema>[]): z.infer<typeof SideResultSchema> {
      const valuations: z.infer<typeof ValuationSchema>[] = [];

      for (const asset of assets) {
        if (asset.type === "player") {
          const name = asset.playerName ?? "Unknown";
          let adp = asset.playerAdp ?? null;
          if (!adp) adp = adpMap.get(normalizeName(name)) ?? null;
          const rawValue = adp ? calcValue(adp, mod.valueCurve) : 0;
          const { value, factors } = applyDynasty(rawValue, name, asset.playerPosition ?? null, adp);
          if (adp) {
            valuations.push({ name, value, adpUsed: adp, dynastyFactors: factors, valueStatus: "resolved" });
          } else {
            // Spec §6: failed ADP lookup → unresolved, not zero
            valuations.push({ name: `⚠️ ${name} (no ADP)`, value: 0, adpUsed: null, dynastyFactors: ["Unresolved: player not found in ADP data"], valueStatus: "unresolved" });
          }
        } else {
          const year = asset.pickYear ?? null;
          const round = asset.pickRound ?? 6;
          const pickNum = asset.pickNumber ?? undefined;
          if (year === null) {
            // Spec §6: missing pick year → mark unresolved, do NOT default to current year
            const pickLabel = pickNum ? `Rd ${round} Pick ${pickNum}` : `Rd ${round}`;
            valuations.push({ name: `⚠️ ${pickLabel} (no year)`, value: 0, adpUsed: null, dynastyFactors: ["Unresolved: missing pick year"], valueStatus: "unresolved" });
          } else {
            const expectedAdp = pickToExpectedAdp(round, year, pickNum);
            const discount = getYearDiscount(year, mod.futurePickDiscount);
            const rawValue = calcValue(expectedAdp, mod.valueCurve);
            const value = rawValue * discount;
            const pickLabel = pickNum ? `${year} Rd ${round} Pick ${pickNum}` : `${year} Rd ${round}`;
            valuations.push({ name: pickLabel, value, adpUsed: expectedAdp, dynastyFactors: [], valueStatus: "resolved" });
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

    const teamASide = evaluateSide(teamAGives);
    const teamBSide = evaluateSide(teamBGives);

    const avgValue = (teamASide.totalValue + teamBSide.totalValue) / 2;
    const pctDifference = avgValue > 0
      ? ((teamBSide.totalValue - teamASide.totalValue) / avgValue) * 100
      : 0;

    // Spec §5: pctDifference = (teamBSentValue - teamASentValue) / avg
    // Positive pctDiff means Team B sent more → Team A received more → Team A wins
    const hasAnyUnresolved = teamASide.hasUnresolved || teamBSide.hasUnresolved;

    let winningTeamId: number | null = null;
    // Spec §7: do not present a definitive verdict when material assets are unresolved
    if (!hasAnyUnresolved && Math.abs(pctDifference) > mod.fairTolerance) {
      winningTeamId = pctDifference > 0 ? teamAId : teamBId;
    }

    const verdict = hasAnyUnresolved
      ? { label: "Data Incomplete", emoji: "⚠️", severity: "incomplete" }
      : getVerdict(pctDifference, mod.fairTolerance, mod.verdictScale);
    const verdictStatus = hasAnyUnresolved ? "incomplete" as const : "definitive" as const;

    // ── Deal Déjà Vu ──
    const playerNamesInTrade = [
      ...teamAGives.filter((a) => a.type === "player").map((a) => a.playerName ? normalizeName(a.playerName) : undefined),
      ...teamBGives.filter((a) => a.type === "player").map((a) => a.playerName ? normalizeName(a.playerName) : undefined),
    ].filter(Boolean) as string[];

    const dejaVu: z.infer<typeof DejaVuSchema>[] = [];

    if (playerNamesInTrade.length > 0) {
      // Step 1: Find matching trade IDs, ordered by most recent first
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
        { label: "Find Deal Déjà Vu matches" }
      );

      // Sort by trade_date DESC after DISTINCT ON
      matches.sort((a, b) => {
        if (a.trade_date && b.trade_date) return b.trade_date.localeCompare(a.trade_date);
        if (a.trade_date) return -1;
        if (b.trade_date) return 1;
        return b.trade_id - a.trade_id;
      });

      if (matches.length > 0) {
        // Step 2: Fetch all assets for matched trades
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
          { label: "Fetch Déjà Vu trade assets" }
        );

        // Group assets by trade_id
        const assetsByTradeId = new Map<number, z.infer<typeof AssetRowSchema>[]>();
        for (const asset of allAssets) {
          if (!assetsByTradeId.has(asset.trade_id)) assetsByTradeId.set(asset.trade_id, []);
          assetsByTradeId.get(asset.trade_id)!.push(asset);
        }

        for (const match of matches) {
          const tradeAssets = assetsByTradeId.get(match.trade_id) ?? [];

          // Compute a rough historical verdict from the trade's asset values
          let historicalVerdict: { label: string; emoji: string; severity: string } | null = null;
          let winnerName: string | null = null;

          // Use the ADP values recorded at trade time to evaluate
          const teamAAssetValues: number[] = [];
          const teamBAssetValues: number[] = [];
          for (const ta of tradeAssets) {
            const val = ta.player_adp_at_trade
              ? calcValue(ta.player_adp_at_trade, mod.valueCurve)
              : ta.pick_year && ta.pick_round
                ? calcValue(pickToExpectedAdp(ta.pick_round, ta.pick_year, ta.pick_number ?? undefined), mod.valueCurve)
                : 0;
            // Determine which side this asset came from
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
      dejaVu,
    };
  },
});
