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
  seasons: string[];
}

const ITEMS_PER_PAGE = 20;

export default function TradeHistory({ trades, assets, teams, historicalAdp, seasons }: Props) {
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);

  const adpMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of historicalAdp) {
      m.set(row.player_name.toLowerCase(), row.adp_rank);
    }
    return m;
  }, [historicalAdp]);

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
      <div className="grid grid-cols-[40px_100px_60px_1fr_1fr_90px_100px_80px] gap-2 px-3 py-2 bg-muted/30 rounded-lg border border-border/50 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        <span>#</span>
        <span>Verdict</span>
        <span className="text-center">Result</span>
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

          // Determine winner/loser
          let resultBadge: { label: string; className: string };
          if (absDiff <= 5) {
            resultBadge = { label: "EVEN", className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
          } else if (valuation.winningTeamId === trade.team_a_id) {
            resultBadge = { label: "A WINS", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" };
          } else {
            resultBadge = { label: "B WINS", className: "bg-red-500/20 text-red-400 border-red-500/30" };
          }

          return (
            <div key={trade.id}>
              <div
                className={`grid grid-cols-[40px_100px_60px_1fr_1fr_90px_100px_80px] gap-2 items-center px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                  isExpanded
                    ? `${colors.border} ${colors.bg}`
                    : "border-border/40 hover:border-border hover:bg-muted/20"
                }`}
                onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
              >
                {/* Trade # */}
                <span className="text-[11px] font-mono text-muted-foreground">#{trade.trade_number}</span>

                {/* Verdict Badge */}
                <Badge className={`text-[10px] px-1.5 py-0 font-semibold border ${colors.badge} w-fit`}>
                  {valuation.verdict.emoji} {valuation.verdict.label}
                </Badge>

                {/* Result */}
                <div className="flex justify-center">
                  <Badge variant="outline" className={`text-[9px] px-1 py-0 font-bold border ${resultBadge.className}`}>
                    {resultBadge.label}
                  </Badge>
                </div>

                {/* Team A */}
                <span className="text-xs font-medium flex items-center gap-1.5 truncate">
                  {getTeamEmoji(trade.team_a_name)}
                  <span className="truncate">{trade.team_a_name}</span>
                </span>

                {/* Team B */}
                <span className="text-xs font-medium flex items-center gap-1.5 truncate">
                  {getTeamEmoji(trade.team_b_name)}
                  <span className="truncate">{trade.team_b_name}</span>
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
                <ExpandedTradeDetail
                  trade={trade}
                  assets={assets}
                  valuation={valuation}
                  teams={teams}
                  colors={colors}
                  adpMap={adpMap}
                />
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
  adpMap,
}: {
  trade: TradeRow;
  assets: TradeAssetRow[];
  valuation: any;
  teams: TeamRow[];
  colors: any;
  adpMap: Map<string, number>;
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
        />
        <AssetColumn
          teamName={trade.team_b_name}
          assets={teamBAssets}
          totalValue={valuation.teamBValue}
          isWinner={valuation.winningTeamId === trade.team_b_id}
        />
      </div>
    </div>
  );
}

function AssetColumn({
  teamName,
  assets,
  totalValue,
  isWinner,
}: {
  teamName: string;
  assets: TradeAssetRow[];
  totalValue: number;
  isWinner: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
        {getTeamEmoji(teamName)} {teamName} sends →
        <span className="font-mono ml-auto">{Math.round(totalValue).toLocaleString()} pts</span>
        {isWinner && <Badge className="text-[9px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border ml-1">WINNER</Badge>}
      </div>
      <div className="space-y-1">
        {assets.map((a) => (
          <div key={a.id} className="flex items-center gap-1.5 text-xs">
            {a.asset_type === "player" ? (
              <Badge className={`text-[9px] px-1 py-0 ${POSITION_BG_CLASSES[a.player_position ?? ""] ?? "bg-muted"}`}>
                {a.player_position}
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
        ))}
      </div>
    </div>
  );
}
