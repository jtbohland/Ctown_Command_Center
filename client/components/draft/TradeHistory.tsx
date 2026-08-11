import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import {
  evaluateHistoricalTrade,
  SEVERITY_COLORS,
  type TradeRow,
  type TradeAssetRow,
  type TeamRow,
  type HistoricalAdpRow,
  type VerdictSeverity,
} from "@/lib/trade-utils";

interface Props {
  trades: TradeRow[];
  assets: TradeAssetRow[];
  teams: TeamRow[];
  historicalAdp: HistoricalAdpRow[];
}

const ITEMS_PER_PAGE = 15;

export default function TradeHistory({ trades, assets, teams, historicalAdp }: Props) {
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);

  // Build ADP lookup map
  const adpMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of historicalAdp) {
      m.set(row.player_name.toLowerCase(), row.adp_rank);
    }
    return m;
  }, [historicalAdp]);

  // Compute valuations for all trades
  const tradesWithVerdicts = useMemo(() => {
    return trades.map((trade) => ({
      trade,
      valuation: evaluateHistoricalTrade(trade, assets, adpMap),
    }));
  }, [trades, assets, adpMap]);

  const filteredTrades = useMemo(() => {
    if (seasonFilter === "all") return tradesWithVerdicts;
    return tradesWithVerdicts.filter((t) => t.trade.season === seasonFilter);
  }, [tradesWithVerdicts, seasonFilter]);

  const pagedTrades = useMemo(
    () => filteredTrades.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE),
    [filteredTrades, page]
  );

  const totalPages = Math.ceil(filteredTrades.length / ITEMS_PER_PAGE);

  const getAssetsForTrade = (tradeId: number, fromTeamId: number) =>
    assets.filter((a) => a.trade_id === tradeId && a.from_team_id === fromTeamId);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-bold flex items-center gap-1.5">
          📜 Trade History
        </h3>
        <Select value={seasonFilter} onValueChange={(v) => { setSeasonFilter(v); setPage(0); }}>
          <SelectTrigger className="h-7 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Seasons</SelectItem>
            <SelectItem value="2025-26">2025-26</SelectItem>
            <SelectItem value="2024-25">2024-25</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredTrades.length} trades
        </span>
      </div>

      {/* Trade Cards */}
      <div className="space-y-2">
        {pagedTrades.map(({ trade, valuation }) => {
          const teamAAssets = getAssetsForTrade(trade.id, trade.team_a_id);
          const teamBAssets = getAssetsForTrade(trade.id, trade.team_b_id);
          const severity = valuation.verdict.severity as VerdictSeverity;
          const colors = SEVERITY_COLORS[severity];
          const isExpanded = expandedTrade === trade.id;

          return (
            <div
              key={trade.id}
              className={`rounded-xl border-2 overflow-hidden transition-all cursor-pointer hover:shadow-md ${colors.border} ${isExpanded ? colors.bg : "hover:bg-muted/20"}`}
              onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
            >
              {/* Compact Header */}
              <div className="flex items-center gap-2 px-3 py-2.5">
                {/* Verdict badge */}
                <Badge className={`text-[10px] px-1.5 py-0 font-bold border ${colors.badge}`}>
                  {valuation.verdict.emoji} {valuation.verdict.label}
                </Badge>

                {/* Trade number */}
                <span className="text-[10px] font-mono text-muted-foreground">#{trade.trade_number}</span>

                {/* Teams */}
                <span className="text-xs font-medium flex items-center gap-1">
                  {getTeamEmoji(trade.team_a_name)}
                  <span className="max-w-[90px] truncate">{trade.team_a_name.split(" ")[0]}</span>
                </span>
                <span className="text-xs text-muted-foreground">↔</span>
                <span className="text-xs font-medium flex items-center gap-1">
                  {getTeamEmoji(trade.team_b_name)}
                  <span className="max-w-[90px] truncate">{trade.team_b_name.split(" ")[0]}</span>
                </span>

                {/* Winner indicator */}
                {valuation.winningTeamName && (
                  <span className={`text-[10px] ml-auto ${colors.text} font-semibold flex items-center gap-0.5`}>
                    {getTeamEmoji(valuation.winningTeamName)} +{Math.abs(valuation.pctDifference)}%
                  </span>
                )}

                {/* Season / Period */}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {trade.season} • {trade.period}
                </span>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                <div className={`border-t ${colors.border} px-3 py-3 ${colors.bg}`}>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Team A sends */}
                    <TradeAssetList
                      teamName={trade.team_a_name}
                      teamColor={teams.find((t) => t.id === trade.team_a_id)?.color}
                      assets={teamAAssets}
                      totalValue={valuation.teamAValue}
                      adpMap={adpMap}
                    />
                    {/* Team B sends */}
                    <TradeAssetList
                      teamName={trade.team_b_name}
                      teamColor={teams.find((t) => t.id === trade.team_b_id)?.color}
                      assets={teamBAssets}
                      totalValue={valuation.teamBValue}
                      adpMap={adpMap}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted font-medium"
          >
            ← Prev
          </button>
          <span className="text-xs text-muted-foreground font-mono">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="text-xs px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted font-medium"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Trade Asset List (Expanded Detail) ────────────────────
function TradeAssetList({
  teamName,
  teamColor,
  assets,
  totalValue,
  adpMap,
}: {
  teamName: string;
  teamColor?: string;
  assets: TradeAssetRow[];
  totalValue: number;
  adpMap: Map<string, number>;
}) {
  return (
    <div>
      <div className="text-[10px] font-bold text-muted-foreground mb-1.5 flex items-center gap-1">
        {getTeamEmoji(teamName)} {teamName} sends →
        <span className="font-mono ml-auto">{Math.round(totalValue).toLocaleString()} pts</span>
      </div>
      <div className="space-y-1">
        {assets.map((a) => {
          const pos = a.player_position ?? "";
          return (
            <div key={a.id} className="flex items-center gap-1.5 text-xs">
              {a.asset_type === "player" ? (
                <Badge className={`text-[9px] px-1 py-0 ${POSITION_BG_CLASSES[pos] ?? "bg-muted"}`}>
                  {pos}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">📋</Badge>
              )}
              <span className="truncate flex-1">
                {a.asset_type === "player"
                  ? a.player_name
                  : `${a.pick_year} Rd ${a.pick_round}${a.pick_number ? ` #${a.pick_number}` : ""}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
