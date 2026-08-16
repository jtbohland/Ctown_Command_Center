import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTeamEmoji } from "@/lib/draft-constants";
import {
  isThreeTeamTrade,
  buildSeasonAdpMap,
  buildValuationFromDb,
  getCTownDisplaySeason,
  getAllCTownSeasons,
  SEVERITY_COLORS,
  type TradeRow,
  type TradeAssetRow,
  type TeamRow,
  type HistoricalAdpRow,
  type VerdictSeverity,
} from "@/lib/trade-utils";
import ThreeTeamTradeDetail from "./ThreeTeamTradeDetail";
import TwoWayTradeDetail from "./TwoWayTradeDetail";
import { ConfidenceTooltip } from "./ConfidenceTooltip";

interface Props {
  trades: TradeRow[];
  assets: TradeAssetRow[];
  teams: TeamRow[];
  historicalAdp: HistoricalAdpRow[];
}

const ITEMS_PER_PAGE = 20;

export default function TradeHistory({ trades, assets, teams, historicalAdp }: Props) {
  const [seasonFilter, setSeasonFilter] = useState<string>("all");
  const [playerSearch, setPlayerSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);

  // Season-aware ADP: season → (player_name → adp_rank) — still used for asset value display
  const seasonAdpMap = useMemo(() => buildSeasonAdpMap(historicalAdp), [historicalAdp]);

  // Use canonical DB verdicts + derive display season from NFL calendar
  const tradesWithVerdicts = useMemo(() => {
    return trades
      .map((trade) => {
        const valuation = buildValuationFromDb(trade, teams);
        if (!valuation) return null;
        const displaySeason = getCTownDisplaySeason(trade.trade_date, trade.season);
        return { trade, valuation, displaySeason };
      })
      .filter((t): t is { trade: TradeRow; valuation: NonNullable<ReturnType<typeof buildValuationFromDb>>; displaySeason: string } => t !== null);
  }, [trades, teams]);

  // Derive available seasons from trades (only seasons that have trades)
  const availableSeasons = useMemo(() => {
    const all = getAllCTownSeasons(); // newest first
    const present = new Set(tradesWithVerdicts.map((t) => t.displaySeason));
    return all.filter((s) => present.has(s));
  }, [tradesWithVerdicts]);

  const filteredTrades = useMemo(() => {
    let list = tradesWithVerdicts;
    if (seasonFilter !== "all") {
      list = list.filter((t) => t.displaySeason === seasonFilter);
    }
    if (playerSearch.trim()) {
      const q = playerSearch.trim().toLowerCase();
      const matchingTradeIds = new Set(
        assets
          .filter((a) => a.asset_type === "player" && a.player_name?.toLowerCase().includes(q))
          .map((a) => a.trade_id)
      );
      list = list.filter((t) => matchingTradeIds.has(t.trade.id));
    }
    return list;
  }, [tradesWithVerdicts, seasonFilter, playerSearch, assets]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPlayerSearch(e.target.value);
    setPage(0);
  }, []);

  const pagedTrades = useMemo(
    () => filteredTrades.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE),
    [filteredTrades, page]
  );

  const totalPages = Math.ceil(filteredTrades.length / ITEMS_PER_PAGE);

  // Confidence breakdown
  const confidenceCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const t of filteredTrades) {
      const c = t.trade.confidence as keyof typeof counts;
      if (c && c in counts) counts[c]++;
    }
    return counts;
  }, [filteredTrades]);

  return (
    <div className="space-y-4">
      {/* Header Row */}
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-bold flex items-center gap-1.5">📜 The Ledger</h3>
        <Input
          value={playerSearch}
          onChange={handleSearchChange}
          placeholder="🔍 Search player name…"
          className="h-8 w-44 text-xs"
        />
        <Select value={seasonFilter} onValueChange={(v) => { setSeasonFilter(v); setPage(0); }}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Seasons</SelectItem>
            {availableSeasons.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Confidence indicator */}
        {(confidenceCounts.high > 0 || confidenceCounts.medium > 0) && (
          <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1">
            <span className="text-[10px] text-emerald-400 font-semibold">📊 Confidence</span>
            <span className="text-[9px] text-emerald-400/70 font-mono">
              {confidenceCounts.high}H / {confidenceCounts.medium}M{confidenceCounts.low > 0 ? ` / ${confidenceCounts.low}L` : ""}
            </span>
          </div>
        )}

        <span className="text-xs text-muted-foreground ml-auto font-mono">
          {filteredTrades.length} trades
        </span>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[40px_130px_1fr_1fr_80px_100px_60px] gap-3 px-3 py-2 bg-muted/30 rounded-lg border border-border/50 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        <span>#</span>
        <span>Verdict</span>
        <span>Team A</span>
        <span>Team B</span>
        <span className="text-center">Diff</span>
        <span>Season</span>
        <span className="text-center">Conf</span>
      </div>

      {/* Trade Rows */}
      <div className="space-y-1.5">
        {pagedTrades.map(({ trade, valuation, displaySeason }) => {
          const severity = valuation.verdict.severity as VerdictSeverity;
          const colors = SEVERITY_COLORS[severity];
          const isExpanded = expandedTrade === trade.id;
          const absDiff = Math.abs(valuation.pctDifference);

          return (
            <div key={trade.id}>
              <div
                className={`grid grid-cols-[40px_130px_1fr_1fr_80px_100px_60px] gap-3 items-center px-3 py-2.5 rounded-lg border cursor-pointer transition-all ${
                  isExpanded
                    ? `${colors.border} ${colors.bg}`
                    : "border-border/40 hover:border-border hover:bg-muted/20"
                }`}
                onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
              >
                <span className="text-[11px] font-mono text-muted-foreground">#{trade.trade_number}</span>

                <div className="flex items-center gap-1">
                  <Badge className={`text-[10px] px-1.5 py-0 font-semibold border ${colors.badge} whitespace-nowrap`}>
                    {valuation.verdict.emoji} {valuation.verdict.label}
                  </Badge>
                  {isThreeTeamTrade(trade) && (
                    <Badge className="text-[8px] px-1 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30 border shrink-0">3-WAY</Badge>
                  )}
                </div>

                <span className="text-xs font-medium flex items-center gap-1.5 min-w-0">
                  {getTeamEmoji(trade.team_a_name)}
                  <span className="truncate">{trade.team_a_name}</span>
                  {valuation.winningTeamId === trade.team_a_id && (
                    <Badge className="text-[8px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border ml-0.5 shrink-0">WIN</Badge>
                  )}
                </span>

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

                <span className={`text-xs font-bold font-mono text-center ${absDiff > 5 ? colors.text : "text-emerald-400"}`}>
                  {absDiff > 0 ? `${absDiff > 5 ? "+" : ""}${absDiff}%` : "0%"}
                </span>

                <span className="text-[11px] text-muted-foreground">{displaySeason}</span>

                {/* Confidence column */}
                <div className="flex justify-center">
                  <ConfidenceTooltip confidence={trade.confidence} reasons={trade.confidence_reasons} />
                </div>
              </div>

              {/* Expanded Detail */}
              {isExpanded && (
                isThreeTeamTrade(trade) ? (
                  <div className={`ml-4 mr-4 mb-2 mt-1 border-t ${colors.border} ${colors.bg} rounded-b-lg px-4 py-3`}>
                    <ThreeTeamTradeDetail
                      trade={trade}
                      assets={assets}
                      seasonAdpMap={seasonAdpMap}
                      teams={teams}
                    />
                  </div>
                ) : (
                  <div className={`ml-4 mr-4 mb-2 mt-1 ${colors.bg} rounded-b-lg`}>
                    <TwoWayTradeDetail
                      trade={trade}
                      assets={assets}
                      valuation={valuation}
                      seasonAdpMap={seasonAdpMap}
                      colorClass={colors.text}
                      borderClass={colors.border}
                      bgClass=""
                      showConfidence
                    />
                  </div>
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


