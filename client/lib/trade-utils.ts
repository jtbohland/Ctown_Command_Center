// ─── Trade Valuation Engine (Client-Side Mirror) ─────────────
// Mirrors server-side formula so we can compute verdicts for historical trades
// without making N API calls.

const BASE_VALUE = 10000;
const POWER = 0.6;
const TOTAL_TEAMS = 11;

const YEAR_DISCOUNT: Record<number, number> = {
  2026: 1.0,
  2027: 0.8,
  2028: 0.65,
};

export function calcPlayerValue(adpRank: number): number {
  if (adpRank <= 0) return 0;
  return BASE_VALUE * Math.pow(1 / adpRank, POWER);
}

export function calcPickValue(round: number, year: number, pickInRound?: number): number {
  const startOfRound = (round - 1) * TOTAL_TEAMS + 1;
  const endOfRound = round * TOTAL_TEAMS;
  const expectedAdp = pickInRound
    ? startOfRound + pickInRound - 1
    : (startOfRound + endOfRound) / 2;
  const discount = YEAR_DISCOUNT[year] ?? 0.5;
  return calcPlayerValue(expectedAdp) * discount;
}

export type VerdictSeverity = "fair" | "slight" | "clear" | "robbery";

export interface Verdict {
  label: string;
  emoji: string;
  severity: VerdictSeverity;
}

export function getVerdict(pctDiff: number): Verdict {
  const absDiff = Math.abs(pctDiff);
  if (absDiff <= 5) return { label: "Fair Trade", emoji: "⚖️", severity: "fair" };
  if (absDiff <= 15) return { label: "Slight Edge", emoji: "📈", severity: "slight" };
  if (absDiff <= 25) return { label: "Clear Winner", emoji: "🏆", severity: "clear" };
  return { label: "Highway Robbery", emoji: "🚨", severity: "robbery" };
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
}

export interface TradeValuation {
  teamAValue: number;
  teamBValue: number;
  pctDifference: number;
  verdict: Verdict;
  winningTeamId: number | null;
  winningTeamName: string | null;
}

/**
 * Compute valuation for a historical trade using ADP data.
 */
export function evaluateHistoricalTrade(
  trade: TradeRow,
  assets: TradeAssetRow[],
  adpMap: Map<string, number>
): TradeValuation {
  const tradeAssets = assets.filter((a) => a.trade_id === trade.id);
  const teamAAssets = tradeAssets.filter((a) => a.from_team_id === trade.team_a_id);
  const teamBAssets = tradeAssets.filter((a) => a.from_team_id === trade.team_b_id);

  function sumValue(items: TradeAssetRow[]): number {
    return items.reduce((sum, a) => {
      if (a.asset_type === "player") {
        const adp = a.player_adp_at_trade
          ? Number(a.player_adp_at_trade)
          : adpMap.get((a.player_name ?? "").toLowerCase()) ?? null;
        return sum + (adp ? calcPlayerValue(adp) : 0);
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
    // Team A gives more value = Team B RECEIVES more = Team B wins
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
