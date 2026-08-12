import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import {
  evaluateHistoricalTrade,
  evaluateThreeTeamTrade,
  isThreeTeamTrade,
  buildSeasonAdpMap,
  getSeasonAdp,
  calcPlayerValue,
  calcPickValue,
  SEVERITY_COLORS,
  type TradeRow,
  type TradeAssetRow,
  type TeamRow,
  type HistoricalAdpRow,
  type VerdictSeverity,
  type DynastyContext,
} from "@/lib/trade-utils";
import ThreeTeamTradeDetail from "./ThreeTeamTradeDetail";

interface Props {
  trades: TradeRow[];
  assets: TradeAssetRow[];
  teams: TeamRow[];
  historicalAdp: HistoricalAdpRow[];
  seasons: string[];
  dynastyCtx?: DynastyContext;
}

const ITEMS_PER_PAGE = 20;

export default function TradeHistory({ trades, assets, teams, historicalAdp, seasons, dynastyCtx }: Props) {
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);

  // Season-aware ADP: season → (player_name → adp_rank)
  const seasonAdpMap = useMemo(() => buildSeasonAdpMap(historicalAdp), [historicalAdp]);

  const tradesWithVerdicts = useMemo(() => {
    return trades.map((trade) => ({
      trade,
      valuation: evaluateHistoricalTrade(trade, assets, seasonAdpMap, dynastyCtx),
    }));
  }, [trades, assets, seasonAdpMap, dynastyCtx]);

  const filteredTrades = useMemo(() => {
    if (seasonFilter === "all") return tradesWithVerdicts;
    return tradesWithVerdicts.filter((t) => t.trade.season === seasonFilter);
  }, [tradesWithVerdicts, seasonFilter]);

  const pagedTrades = useMemo(
    () => filteredTrades.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE),
    [filteredTrades, page]
  );

  const totalPages = Math.ceil(filteredTrades.length / ITEMS_PER_PAGE);

  return (
    <div className="space-y-4">
      {/* Header Row */}
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-bold flex items-center gap-1.5">📜 The Ledger</h3>
        <Select value={seasonFilter} onValueChange={(v) => { setSeasonFilter(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Seasons</SelectItem>
            {seasons.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto font-mono">
          {filteredTrades.length} trades
        </span>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[40px_130px_1fr_1fr_80px_100px_80px] gap-3 px-3 py-2 bg-muted/30 rounded-lg border border-border/50 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        <span>#</span>
        <span>Verdict</span>
        <span>Team A</span>
        <span>Team B</span>
        <span className="text-center">Diff</span>
        <span>Season</span>
        <span>Period</span>
      </div>

      {/* Trade Rows */}
      <div className="space-y-1.5">
        {pagedTrades.map(({ trade, valuation }) => {
          const severity = valuation.verdict.severity as VerdictSeverity;
          const colors = SEVERITY_COLORS[severity];
          const isExpanded = expandedTrade === trade.id;
          const absDiff = Math.abs(valuation.pctDifference);

          return (
            <div key={trade.id}>
              <div
                className={`grid grid-cols-[40px_130px_1fr_1fr_80px_100px_80px] gap-3 items-center px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                  isExpanded
                    ? `${colors.border} ${colors.bg}`
                    : "border-border/40 hover:border-border hover:bg-muted/20"
                }`}
                onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
              >
                {/* Trade # */}
                <span className="text-[11px] font-mono text-muted-foreground">#{trade.trade_number}</span>

                {/* Verdict Badge + 3-WAY tag */}
                <div className="flex items-center gap-1">
                  <Badge className={`text-[10px] px-1.5 py-0 font-semibold border ${colors.badge} whitespace-nowrap`}>
                    {valuation.verdict.emoji} {valuation.verdict.label}
                  </Badge>
                  {isThreeTeamTrade(trade) && (
                    <Badge className="text-[8px] px-1 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30 border shrink-0">3-WAY</Badge>
                  )}
                </div>

                {/* Team A */}
                <span className="text-xs font-medium flex items-center gap-1.5 min-w-0">
                  {getTeamEmoji(trade.team_a_name)}
                  <span className="truncate">{trade.team_a_name}</span>
                  {valuation.winningTeamId === trade.team_a_id && (
                    <Badge className="text-[8px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border ml-0.5 shrink-0">WIN</Badge>
                  )}
                </span>

                {/* Team B (+ Team C for 3-way) */}
                <span className="text-xs font-medium flex items-center gap-1.5 min-w-0">
                  {getTeamEmoji(trade.team_b_name)}
                  <span className="truncate">{trade.team_b_name}</span>
                  {valuation.winningTeamId === trade.team_b_id && (
                    <Badge className="text-[8px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border ml-0.5 shrink-0">WIN</Badge>
                  )}
                  {!isThreeTeamTrade(trade) && absDiff <= 5 && (
                    <Badge className="text-[8px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border ml-0.5 shrink-0">EVEN</Badge>
                  )}
                  {isThreeTeamTrade(trade) && trade.team_c_name && (
                    <>
                      <span className="text-muted-foreground text-[10px]">+</span>
                      <span>{getTeamEmoji(trade.team_c_name)}</span>
                      <span className="truncate">{trade.team_c_name}</span>
                    </>
                  )}
                </span>

                {/* Diff % */}
                <span className={`text-xs font-bold font-mono text-center ${absDiff > 5 ? colors.text : "text-emerald-400"}`}>
                  {absDiff > 0 ? `${absDiff > 5 ? "+" : ""}${absDiff}%` : "0%"}
                </span>

                {/* Season */}
                <span className="text-[11px] text-muted-foreground">{trade.season}</span>

                {/* Period */}
                <span className="text-[10px] text-muted-foreground capitalize">{trade.period}</span>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                isThreeTeamTrade(trade) ? (
                  <div className={`ml-4 mr-4 mb-2 mt-1 border-t ${colors.border} ${colors.bg} rounded-b-lg px-4 py-3`}>
                    <ThreeTeamTradeDetail
                      trade={trade}
                      assets={assets}
                      seasonAdpMap={seasonAdpMap}
                      dynastyCtx={dynastyCtx}
                    />
                  </div>
                ) : (
                  <ExpandedTradeDetail
                    trade={trade}
                    assets={assets}
                    valuation={valuation}
                    teams={teams}
                    colors={colors}
                    seasonAdpMap={seasonAdpMap}
                  />
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-3">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-xs px-4 py-2 rounded-lg border border-border disabled:opacity-40 hover:bg-muted font-medium transition-colors"
          >
            ← Previous
          </button>
          <span className="text-xs text-muted-foreground font-mono">
            Page {page + 1} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="text-xs px-4 py-2 rounded-lg border border-border disabled:opacity-40 hover:bg-muted font-medium transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Expanded Trade Detail ──────────────────────────────────
function ExpandedTradeDetail({
  trade,
  assets,
  valuation,
  teams,
  colors,
  seasonAdpMap,
}: {
  trade: TradeRow;
  assets: TradeAssetRow[];
  valuation: any;
  teams: TeamRow[];
  colors: any;
  seasonAdpMap: Map<string, Map<string, number>>;
}) {
  const teamAAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_a_id);
  const teamBAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_b_id);

  return (
    <div className={`ml-4 mr-4 mb-2 mt-1 border-t ${colors.border} ${colors.bg} rounded-b-lg px-4 py-3`}>
      <div className="grid grid-cols-2 gap-6">
        <AssetColumn
          teamName={trade.team_a_name}
          assets={teamAAssets}
          totalValue={valuation.teamAValue}
          isWinner={valuation.winningTeamId === trade.team_a_id}
          tradeSeason={trade.season}
          seasonAdpMap={seasonAdpMap}
        />
        <AssetColumn
          teamName={trade.team_b_name}
          assets={teamBAssets}
          totalValue={valuation.teamBValue}
          isWinner={valuation.winningTeamId === trade.team_b_id}
          tradeSeason={trade.season}
          seasonAdpMap={seasonAdpMap}
        />
      </div>
      {/* Gap + Winner summary */}
      <div className="mt-3 pt-2 border-t border-border/30 text-center">
        {valuation.winningTeamName ? (
          <span className="text-[11px] font-bold">
            {getTeamEmoji(valuation.winningTeamName)} <span className="text-emerald-400">{valuation.winningTeamName}</span>
            <span className="text-muted-foreground"> receives </span>
            <span className="font-mono text-emerald-400">+{Math.abs(Math.round(valuation.teamAValue - valuation.teamBValue)).toLocaleString()}</span>
            <span className="text-muted-foreground"> more value ({Math.abs(valuation.pctDifference)}% gap)</span>
          </span>
        ) : (
          <span className="text-[11px] font-bold text-emerald-400">⚖️ Even trade — within 5% value gap</span>
        )}
      </div>
    </div>
  );
}

function formatPickLabel(a: TradeAssetRow): string {
  const parts: string[] = [];
  if (a.pick_year) parts.push(String(a.pick_year));
  if (a.pick_round) parts.push(`Rd ${a.pick_round}`);
  if (a.pick_number) parts.push(`#${a.pick_number}`);
  if (parts.length === 0) return "Draft Pick";
  return parts.join(" ");
}

function getAssetValue(a: TradeAssetRow, tradeSeason: string, seasonAdpMap: Map<string, Map<string, number>>): number {
  if (a.asset_type === "player") {
    const adp = a.player_adp_at_trade
      ? Number(a.player_adp_at_trade)
      : getSeasonAdp(seasonAdpMap, tradeSeason, a.player_name ?? "");
    return adp ? calcPlayerValue(adp) : 0;
  }
  const year = a.pick_year ?? 2026;
  const round = a.pick_round ?? 6;
  return calcPickValue(round, year, a.pick_number ?? undefined);
}

function AssetColumn({
  teamName,
  assets,
  totalValue,
  isWinner,
  tradeSeason,
  seasonAdpMap,
}: {
  teamName: string;
  assets: TradeAssetRow[];
  totalValue: number;
  isWinner: boolean;
  tradeSeason: string;
  seasonAdpMap: Map<string, Map<string, number>>;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
        {getTeamEmoji(teamName)} {teamName} sends →
      </div>
      <div className="space-y-1">
        {assets.map((a) => {
          const val = getAssetValue(a, tradeSeason, seasonAdpMap);
          return (
            <div key={a.id} className="flex items-center gap-1.5 text-xs">
              {a.asset_type === "player" ? (
                <Badge className={`text-[9px] px-1 py-0 ${POSITION_BG_CLASSES[a.player_position ?? ""] ?? "bg-muted"}`}>
                  {a.player_position}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">📋</Badge>
              )}
              <span className="truncate flex-1">
                {a.asset_type === "player" ? a.player_name : formatPickLabel(a)}
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">({Math.round(val).toLocaleString()})</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 pt-1.5 border-t border-border/30 flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground">Package Total</span>
        <span className="text-xs font-bold font-mono">{Math.round(totalValue).toLocaleString()} pts</span>
      </div>
      {isWinner && (
        <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border mt-1.5 w-fit">WINNER</Badge>
      )}
    </div>
  );
}
