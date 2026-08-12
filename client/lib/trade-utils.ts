// ─── Trade Valuation Engine (Client-Side Mirror) ─────────────
// Mirrors server-side formula so we can compute verdicts for historical trades
// without making N API calls.

const BASE_VALUE = 10000;
const POWER = 0.6;
const TOTAL_TEAMS = 11;
const KEEPERS_PER_TEAM = 4;
const KEEPER_OFFSET = TOTAL_TEAMS * KEEPERS_PER_TEAM; // 44 players locked on rosters before draft

const YEAR_DISCOUNT: Record<number, number> = {
  2026: 1.0,
  2027: 0.8,
  2028: 0.65,
};

// ─── Dynasty Multiplier Constants ────────────────────────────
const ROOKIE_PREMIUM = 1.10;      // Top-50 NFL draft picks in their rookie season
const POSITIONAL_SCARCITY = 1.08; // Top-5 QB or TE by ADP
// Age curve factors
function getAgeFactor(age: number): number {
  if (age <= 24) return 1.06;
  if (age <= 27) return 1.03;
  if (age <= 29) return 1.00;
  if (age <= 31) return 0.95;
  return 0.90;
}

export function calcPlayerValue(adpRank: number): number {
  if (adpRank <= 0) return 0;
  return BASE_VALUE * Math.pow(1 / adpRank, POWER);
}

export function calcPickValue(round: number, year: number, pickInRound?: number): number {
  const startOfRound = (round - 1) * TOTAL_TEAMS + 1;
  const endOfRound = round * TOTAL_TEAMS;
  const draftPosition = pickInRound
    ? startOfRound + pickInRound - 1
    : (startOfRound + endOfRound) / 2;
  const effectiveAdp = draftPosition + KEEPER_OFFSET;
  const discount = YEAR_DISCOUNT[year] ?? 0.5;
  return calcPlayerValue(effectiveAdp) * discount;
}

export type VerdictSeverity = "fair" | "slight" | "clear" | "robbery";

export interface Verdict {
  label: string;
  emoji: string;
  severity: VerdictSeverity;
}

export function getVerdict(pctDiff: number): Verdict {
  const absDiff = Math.abs(pctDiff);
  if (absDiff <= 5) return { label: "Fair Catch", emoji: "🧤", severity: "fair" };
  if (absDiff <= 15) return { label: "Edge Rush", emoji: "📈", severity: "slight" };
  if (absDiff <= 25) return { label: "Pick Six", emoji: "🏆", severity: "clear" };
  return { label: "Flag on the Play", emoji: "🚩", severity: "robbery" };
}

export const SEVERITY_COLORS: Record<VerdictSeverity, { bg: string; border: string; text: string; badge: string }> = {
  fair: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  slight: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", badge: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  clear: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400", badge: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  robbery: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", badge: "bg-red-500/20 text-red-400 border-red-500/30" },
};

// ─── Shared Types ────────────────────────────────────────────
export interface TradeRow {
  id: number;
  trade_number: number;
  season: string;
  trade_date: string | null;
  team_a_id: number;
  team_b_id: number;
  team_a_name: string;
  team_b_name: string;
  status: string;
  period: string;
  notes: string | null;
}

export interface TradeAssetRow {
  id: number;
  trade_id: number;
  from_team_id: number;
  asset_type: string;
  player_name: string | null;
  player_position: string | null;
  player_adp_at_trade: string | null;
  pick_year: number | null;
  pick_round: number | null;
  pick_number: number | null;
}

export interface TeamRow {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
}

export interface PlayerRow {
  id: number;
  name: string;
  position: string;
  nfl_team: string;
  adp_rank: number | null;
}

export interface DraftCapitalRow {
  id: number;
  year: number;
  round: number;
  original_team_id: number;
  current_team_id: number;
  original_team_name: string;
  current_team_name: string;
}

export interface HistoricalAdpRow {
  player_name: string;
  adp_rank: number;
  season: string;
  position: string;
}

export interface RookieClassEntry {
  nfl_draft_year: number;
  overall_pick: number;
  player_name: string;
  position: string;
  age_on_draft_day: number;
}

export interface DynastyContext {
  rookieClasses: RookieClassEntry[];
  allAdp: HistoricalAdpRow[];
}

export interface TradeValuation {
  teamAValue: number;
  teamBValue: number;
  pctDifference: number;
  verdict: Verdict;
  winningTeamId: number | null;
  winningTeamName: string | null;
}

// ─── Dynasty Multiplier Helper ───────────────────────────────
function applyDynastyMultiplier(
  baseValue: number,
  playerName: string,
  playerPosition: string | null,
  playerAdp: number | null,
  tradeSeason: string,
  ctx: DynastyContext,
): number {
  let multiplier = 1.0;
  const nameLower = playerName.toLowerCase();
  // Season "2024-25" → draft year 2024
  const draftYear = parseInt(tradeSeason.split("-")[0]);

  // 1. Rookie premium: player in this year's NFL draft class, pick ≤ 50
  const isRookie = ctx.rookieClasses.some(
    (r) =>
      r.nfl_draft_year === draftYear &&
      r.overall_pick <= 50 &&
      r.player_name.toLowerCase() === nameLower,
  );
  if (isRookie) multiplier *= ROOKIE_PREMIUM;

  // 2. Positional scarcity: top-5 QB or TE by ADP in that season
  const pos = playerPosition?.toUpperCase() ?? "";
  if ((pos === "QB" || pos === "TE") && playerAdp !== null) {
    const seasonAdp = ctx.allAdp
      .filter((a) => a.season === tradeSeason && a.position.toUpperCase() === pos)
      .sort((a, b) => a.adp_rank - b.adp_rank);
    const posRank = seasonAdp.findIndex((a) => a.player_name.toLowerCase() === nameLower);
    if (posRank >= 0 && posRank < 5) multiplier *= POSITIONAL_SCARCITY;
  }

  // 3. Age curve: compute current age from rookie class data
  const rookieEntry = ctx.rookieClasses.find(
    (r) => r.player_name.toLowerCase() === nameLower,
  );
  if (rookieEntry) {
    const currentAge = rookieEntry.age_on_draft_day + (draftYear - rookieEntry.nfl_draft_year);
    const ageFactor = getAgeFactor(currentAge);
    multiplier *= ageFactor;
  }

  return baseValue * multiplier;
}

/** Build a season-keyed ADP map: season → (lowercased player name → adp_rank) */
export function buildSeasonAdpMap(
  historicalAdp: HistoricalAdpRow[],
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const row of historicalAdp) {
    if (!map.has(row.season)) map.set(row.season, new Map());
    map.get(row.season)!.set(row.player_name.toLowerCase(), row.adp_rank);
  }
  return map;
}

/** Look up a player's ADP for a specific season, returns null if not found */
export function getSeasonAdp(
  seasonAdpMap: Map<string, Map<string, number>>,
  season: string,
  playerName: string,
): number | null {
  return seasonAdpMap.get(season)?.get(playerName.toLowerCase()) ?? null;
}

/**
 * Compute valuation for a historical trade using season-aware ADP data + optional dynasty factors.
 * Each trade is evaluated using the ADP from the season it occurred in.
 */
export function evaluateHistoricalTrade(
  trade: TradeRow,
  assets: TradeAssetRow[],
  seasonAdpMap: Map<string, Map<string, number>>,
  dynastyCtx?: DynastyContext,
): TradeValuation {
  const tradeAssets = assets.filter((a) => a.trade_id === trade.id);
  const teamAAssets = tradeAssets.filter((a) => a.from_team_id === trade.team_a_id);
  const teamBAssets = tradeAssets.filter((a) => a.from_team_id === trade.team_b_id);

  // Get the ADP map for THIS trade's season
  const seasonMap = seasonAdpMap.get(trade.season);

  function sumValue(items: TradeAssetRow[]): number {
    return items.reduce((sum, a) => {
      if (a.asset_type === "player") {
        const adp = a.player_adp_at_trade
          ? Number(a.player_adp_at_trade)
          : seasonMap?.get((a.player_name ?? "").toLowerCase()) ?? null;
        let value = adp ? calcPlayerValue(adp) : 0;
        // Apply dynasty multipliers if context provided
        if (dynastyCtx && a.player_name && value > 0) {
          value = applyDynastyMultiplier(
            value,
            a.player_name,
            a.player_position,
            adp,
            trade.season,
            dynastyCtx,
          );
        }
        return sum + value;
      } else {
        const year = a.pick_year ?? 2026;
        const round = a.pick_round ?? 6;
        return sum + calcPickValue(round, year, a.pick_number ?? undefined);
      }
    }, 0);
  }

  const teamAValue = sumValue(teamAAssets);
  const teamBValue = sumValue(teamBAssets);
  const avgValue = (teamAValue + teamBValue) / 2;
  const pctDifference = avgValue > 0
    ? Math.round(((teamBValue - teamAValue) / avgValue) * 100 * 10) / 10
    : 0;

  const verdict = getVerdict(pctDifference);
  let winningTeamId: number | null = null;
  let winningTeamName: string | null = null;
  if (Math.abs(pctDifference) > 5) {
    if (pctDifference > 0) {
      winningTeamId = trade.team_b_id;
      winningTeamName = trade.team_b_name;
    } else {
      winningTeamId = trade.team_a_id;
      winningTeamName = trade.team_a_name;
    }
  }

  return { teamAValue, teamBValue, pctDifference, verdict, winningTeamId, winningTeamName };
}
