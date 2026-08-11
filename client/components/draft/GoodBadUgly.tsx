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
  type TradeValuation,
} from "@/lib/trade-utils";

interface Props {
  trades: TradeRow[];
  assets: TradeAssetRow[];
  teams: TeamRow[];
  historicalAdp: HistoricalAdpRow[];
  seasons: string[];
}

interface EvaluatedTrade {
  trade: TradeRow;
  valuation: TradeValuation;
}

const VERDICT_ORDER: VerdictSeverity[] = ["robbery", "clear", "slight", "fair"];

const VERDICT_META: Record<VerdictSeverity, { title: string; emoji: string; description: string }> = {
  robbery: { title: "Highway Robbery", emoji: "🚨", description: "Someone got fleeced! 25%+ value gap" },
  clear: { title: "Clear Winners", emoji: "🏆", description: "One side came out significantly ahead (15–25%)" },
  slight: { title: "Slight Edge", emoji: "📈", description: "Close, but one side got a little more (5–15%)" },
  fair: { title: "Fair Trades", emoji: "⚖️", description: "Both sides walked away happy (within 5%)" },
};

// ─── Small sub-components ─────────────────────────────────────

function AssetChip({ a }: { a: TradeAssetRow }) {
  return (
    <div className="flex items-center gap-1 pl-1 py-0.5 text-xs">
      {a.asset_type === "player" ? (
        <Badge className={`text-[9px] px-1 py-0 ${POSITION_BG_CLASSES[a.player_position ?? ""] ?? "bg-muted"}`}>
          {a.player_position}
        </Badge>
      ) : (
        <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">📋</Badge>
      )}
      <span className="truncate">
        {a.asset_type === "player"
          ? a.player_name
          : `${a.pick_year} Rd ${a.pick_round}${a.pick_number ? ` #${a.pick_number}` : ""}`}
      </span>
    </div>
  );
}

// ─── Trade of the Season card ─────────────────────────────────

interface FeaturedTrade {
  label: string;
  emoji: string;
  et: EvaluatedTrade;
}

function TradeOfSeasonCard({ label, emoji, et, assets, expandedId, onToggle }: {
  label: string;
  emoji: string;
  et: EvaluatedTrade;
  assets: TradeAssetRow[];
  expandedId: number | null;
  onToggle: (id: number) => void;
}) {
  const { trade, valuation } = et;
  const severity = valuation.verdict.severity;
  const colors = SEVERITY_COLORS[severity];
  const isExpanded = expandedId === trade.id;

  const teamAAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_a_id);
  const teamBAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_b_id);

  return (
    <div
      className={`rounded-xl border-2 cursor-pointer transition-all ${colors.border} ${colors.bg}`}
      onClick={() => onToggle(trade.id)}
    >
      <div className="px-3 py-2">
        {/* Category label */}
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-base">{emoji}</span>
          <span className={`text-[10px] font-extrabold tracking-widest uppercase ${colors.text}`}>{label}</span>
          <span className="text-[10px] text-muted-foreground ml-auto font-mono">#{trade.trade_number} · {trade.season}</span>
        </div>
        {/* Teams row */}
        <div className="flex items-center gap-1.5 text-xs">
          <span>{getTeamEmoji(trade.team_a_name)}</span>
          <span className="font-semibold truncate max-w-[70px]">{trade.team_a_name.split(" ")[0]}</span>
          <span className="text-muted-foreground">↔</span>
          <span>{getTeamEmoji(trade.team_b_name)}</span>
          <span className="font-semibold truncate max-w-[70px]">{trade.team_b_name.split(" ")[0]}</span>
          {valuation.winningTeamName && (
            <Badge className={`ml-auto text-[9px] px-1.5 py-0 ${colors.badge} border`}>
              {getTeamEmoji(valuation.winningTeamName)} +{Math.abs(valuation.pctDifference)}%
            </Badge>
          )}
          {!valuation.winningTeamName && (
            <Badge className="ml-auto text-[9px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">EVEN</Badge>
          )}
        </div>
      </div>
      {/* Expanded detail */}
      {isExpanded && (
        <div className={`border-t ${colors.border} px-3 py-3`}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={`text-[10px] font-bold ${colors.text} mb-1`}>
                {getTeamEmoji(trade.team_a_name)} {trade.team_a_name} sends
                <span className="font-mono ml-1 text-muted-foreground">{Math.round(valuation.teamAValue).toLocaleString()} pts</span>
              </div>
              {teamAAssets.map((a) => <AssetChip key={a.id} a={a} />)}
            </div>
            <div>
              <div className={`text-[10px] font-bold ${colors.text} mb-1`}>
                {getTeamEmoji(trade.team_b_name)} {trade.team_b_name} sends
                <span className="font-mono ml-1 text-muted-foreground">{Math.round(valuation.teamBValue).toLocaleString()} pts</span>
              </div>
              {teamBAssets.map((a) => <AssetChip key={a.id} a={a} />)}
            </div>
          </div>
          {valuation.winningTeamName && (
            <div className={`mt-2 text-center text-[10px] font-extrabold ${colors.text} tracking-widest uppercase`}>
              🏆 Winner: {valuation.winningTeamName}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────

export default function GoodBadUgly({ trades, assets, teams, historicalAdp, seasons }: Props) {
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string>("all");
  const [activeFilters, setActiveFilters] = useState<Set<VerdictSeverity>>(new Set(VERDICT_ORDER));

  // Build ADP lookup keyed by player name
  const adpMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of historicalAdp) {
      m.set(row.player_name.toLowerCase(), row.adp_rank);
    }
    return m;
  }, [historicalAdp]);

  // Filter trades by season, then evaluate each
  const filteredTrades = useMemo(
    () => (selectedSeason === "all" ? trades : trades.filter((t) => t.season === selectedSeason)),
    [trades, selectedSeason]
  );

  const evaluated = useMemo<EvaluatedTrade[]>(() => {
    return filteredTrades.map((trade) => ({
      trade,
      valuation: evaluateHistoricalTrade(trade, assets, adpMap),
    }));
  }, [filteredTrades, assets, adpMap]);

  // Group by severity
  const grouped = useMemo(() => {
    const groups: Record<VerdictSeverity, EvaluatedTrade[]> = {
      robbery: [], clear: [], slight: [], fair: [],
    };
    for (const et of evaluated) {
      groups[et.valuation.verdict.severity].push(et);
    }
    for (const key of Object.keys(groups) as VerdictSeverity[]) {
      groups[key].sort((a, b) => Math.abs(b.valuation.pctDifference) - Math.abs(a.valuation.pctDifference));
    }
    return groups;
  }, [evaluated]);

  // Stats banner
  const total = evaluated.length;
  const stats = VERDICT_ORDER.map((s) => ({
    severity: s,
    count: grouped[s].length,
    pct: total > 0 ? Math.round((grouped[s].length / total) * 100) : 0,
  }));

  // Trade of the Season — biggest robbery, biggest non-robbery winner, most even
  const featuredTrades = useMemo<FeaturedTrade[]>(() => {
    const allSorted = [...evaluated].sort(
      (a, b) => Math.abs(b.valuation.pctDifference) - Math.abs(a.valuation.pctDifference)
    );
    const mostLopsided = allSorted[0];
    const mostEven = [...evaluated].sort(
      (a, b) => Math.abs(a.valuation.pctDifference) - Math.abs(b.valuation.pctDifference)
    )[0];
    const results: FeaturedTrade[] = [];
    if (mostLopsided) {
      results.push({ label: "Biggest Robbery", emoji: "🚨", et: mostLopsided });
    }
    // Most even (different from mostLopsided)
    if (mostEven && mostEven.trade.id !== mostLopsided?.trade.id) {
      results.push({ label: "Most Even Deal", emoji: "⚖️", et: mostEven });
    } else if (evaluated.length > 1) {
      const nextEven = [...evaluated]
        .sort((a, b) => Math.abs(a.valuation.pctDifference) - Math.abs(b.valuation.pctDifference))
        .find((e) => e.trade.id !== mostLopsided?.trade.id);
      if (nextEven) results.push({ label: "Most Even Deal", emoji: "⚖️", et: nextEven });
    }
    return results;
  }, [evaluated]);

  // Manager leaderboard
  const leaderboard = useMemo(() => {
    const board = new Map<string, { wins: number; losses: number; even: number }>();
    for (const et of evaluated) {
      const { trade, valuation } = et;
      const teamNames = [trade.team_a_name, trade.team_b_name];
      for (const name of teamNames) {
        if (!board.has(name)) board.set(name, { wins: 0, losses: 0, even: 0 });
      }
      if (!valuation.winningTeamName) {
        // Even trade
        board.get(trade.team_a_name)!.even++;
        board.get(trade.team_b_name)!.even++;
      } else {
        board.get(valuation.winningTeamName)!.wins++;
        const loser = valuation.winningTeamName === trade.team_a_name ? trade.team_b_name : trade.team_a_name;
        board.get(loser)!.losses++;
      }
    }
    return Array.from(board.entries())
      .map(([name, stats]) => ({ name, ...stats, total: stats.wins + stats.losses + stats.even }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
  }, [evaluated]);

  const toggleFilter = (s: VerdictSeverity) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        if (next.size === 1) return prev; // keep at least one
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  };

  return (
    <div className="space-y-5">

      {/* ── Controls Row ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={selectedSeason} onValueChange={setSelectedSeason}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Seasons</SelectItem>
            {seasons.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Verdict filter toggles */}
        <div className="flex items-center gap-1.5">
          {VERDICT_ORDER.map((s) => {
            const meta = VERDICT_META[s];
            const colors = SEVERITY_COLORS[s];
            const active = activeFilters.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleFilter(s)}
                className={`text-[10px] font-bold px-2.5 py-1 rounded-full border transition-all ${
                  active
                    ? `${colors.bg} ${colors.border} ${colors.text}`
                    : "bg-muted/30 border-border/30 text-muted-foreground"
                }`}
              >
                {meta.emoji} {meta.title}
              </button>
            );
          })}
        </div>
        <span className="text-[10px] text-muted-foreground ml-auto font-mono">{total} trades</span>
      </div>

      {/* ── Stats Banner ── */}
      <div className="grid grid-cols-4 gap-2">
        {stats.map(({ severity, count, pct }) => {
          const meta = VERDICT_META[severity];
          const colors = SEVERITY_COLORS[severity];
          const active = activeFilters.has(severity);
          return (
            <button
              key={severity}
              onClick={() => toggleFilter(severity)}
              className={`rounded-xl border p-3 text-center transition-all ${
                active ? `${colors.border} ${colors.bg}` : "border-border/30 bg-muted/10 opacity-50"
              }`}
            >
              <div className="text-2xl mb-0.5">{meta.emoji}</div>
              <div className={`text-2xl font-extrabold font-mono ${active ? colors.text : "text-muted-foreground"}`}>{count}</div>
              <div className="text-[10px] text-muted-foreground">{meta.title}</div>
              <div className="text-[10px] text-muted-foreground font-mono">{pct}%</div>
            </button>
          );
        })}
      </div>

      {/* ── Trade of the Season ── */}
      {featuredTrades.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">🏅</span>
            <h3 className="text-sm font-extrabold tracking-tight">
              {selectedSeason === "all" ? "All-Time Standouts" : `${selectedSeason} Trade of the Season`}
            </h3>
            <div className="flex-1 border-t border-border/40" />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {featuredTrades.map((ft) => (
              <TradeOfSeasonCard
                key={`${ft.label}-${ft.et.trade.id}`}
                label={ft.label}
                emoji={ft.emoji}
                et={ft.et}
                assets={assets}
                expandedId={expandedTrade}
                onToggle={(id) => setExpandedTrade((prev) => (prev === id ? null : id))}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Manager Leaderboard ── */}
      {leaderboard.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm">📊</span>
            <h3 className="text-sm font-extrabold tracking-tight">Manager Leaderboard</h3>
            <div className="flex-1 border-t border-border/40" />
          </div>
          <div className="rounded-xl border border-border/50 overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[24px_1fr_48px_48px_48px_48px] gap-1 px-3 py-1.5 bg-muted/40 border-b border-border/30 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              <span>#</span>
              <span>Manager</span>
              <span className="text-center text-emerald-400">W</span>
              <span className="text-center text-red-400">L</span>
              <span className="text-center text-amber-400">~</span>
              <span className="text-center">Total</span>
            </div>
            {leaderboard.map((row, i) => {
              const winRate = row.total > 0 ? Math.round((row.wins / row.total) * 100) : 0;
              return (
                <div
                  key={row.name}
                  className={`grid grid-cols-[24px_1fr_48px_48px_48px_48px] gap-1 px-3 py-2 items-center text-xs ${
                    i % 2 === 0 ? "bg-card/30" : "bg-muted/10"
                  } border-b border-border/20 last:border-0`}
                >
                  <span className={`text-[10px] font-mono font-bold ${i === 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`}
                  </span>
                  <div className="flex items-center gap-1 min-w-0">
                    <span>{getTeamEmoji(row.name)}</span>
                    <span className="truncate font-medium">{row.name.split(" ").slice(0, 2).join(" ")}</span>
                    <span className="text-[9px] font-mono text-muted-foreground ml-1">{winRate}%</span>
                  </div>
                  <span className="text-center font-mono font-bold text-emerald-400">{row.wins}</span>
                  <span className="text-center font-mono font-bold text-red-400">{row.losses}</span>
                  <span className="text-center font-mono text-amber-400">{row.even}</span>
                  <span className="text-center font-mono text-muted-foreground">{row.total}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Verdict Sections ── */}
      {VERDICT_ORDER.filter((s) => activeFilters.has(s)).map((severity) => {
        const meta = VERDICT_META[severity];
        const colors = SEVERITY_COLORS[severity];
        const items = grouped[severity];
        if (items.length === 0) return null;

        return (
          <div key={severity} className="space-y-2">
            {/* Section header */}
            <div className={`flex items-center gap-2 py-2 px-3 rounded-lg ${colors.bg} border ${colors.border}`}>
              <span className="text-lg">{meta.emoji}</span>
              <div>
                <h3 className={`text-sm font-bold ${colors.text}`}>{meta.title}</h3>
                <p className="text-[10px] text-muted-foreground">{meta.description}</p>
              </div>
              <Badge className={`ml-auto ${colors.badge} border`}>{items.length}</Badge>
            </div>

            {/* Trade rows */}
            <div className="space-y-1.5 pl-2">
              {items.map(({ trade, valuation }) => {
                const isExpanded = expandedTrade === trade.id;
                const teamAAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_a_id);
                const teamBAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_b_id);

                return (
                  <div
                    key={trade.id}
                    className={`rounded-lg border transition-all cursor-pointer ${
                      isExpanded ? `${colors.border} ${colors.bg}` : "border-border/50 hover:border-border hover:bg-muted/20"
                    }`}
                    onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
                  >
                    {/* Compact row */}
                    <div className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className="font-mono text-muted-foreground w-6 text-[10px]">#{trade.trade_number}</span>
                      <span className="flex items-center gap-1 min-w-[90px]">
                        {getTeamEmoji(trade.team_a_name)}
                        <span className="truncate max-w-[70px] font-medium">{trade.team_a_name.split(" ")[0]}</span>
                      </span>
                      <span className="text-muted-foreground text-[10px]">↔</span>
                      <span className="flex items-center gap-1 min-w-[90px]">
                        {getTeamEmoji(trade.team_b_name)}
                        <span className="truncate max-w-[70px] font-medium">{trade.team_b_name.split(" ")[0]}</span>
                      </span>
                      {valuation.winningTeamName ? (
                        <span className={`text-[10px] font-bold ml-auto ${colors.text}`}>
                          {getTeamEmoji(valuation.winningTeamName)} +{Math.abs(valuation.pctDifference)}%
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold ml-auto text-emerald-400">EVEN</span>
                      )}
                      <span className="text-[10px] text-muted-foreground font-mono">{trade.season}</span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className={`border-t ${colors.border} px-3 py-3`}>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className={`text-[10px] font-bold ${colors.text} mb-1`}>
                              {getTeamEmoji(trade.team_a_name)} {trade.team_a_name} sends →
                              <span className="font-mono ml-1 text-muted-foreground">{Math.round(valuation.teamAValue).toLocaleString()} pts</span>
                            </div>
                            {teamAAssets.map((a) => <AssetChip key={a.id} a={a} />)}
                          </div>
                          <div>
                            <div className={`text-[10px] font-bold ${colors.text} mb-1`}>
                              {getTeamEmoji(trade.team_b_name)} {trade.team_b_name} sends →
                              <span className="font-mono ml-1 text-muted-foreground">{Math.round(valuation.teamBValue).toLocaleString()} pts</span>
                            </div>
                            {teamBAssets.map((a) => <AssetChip key={a.id} a={a} />)}
                          </div>
                        </div>
                        {valuation.winningTeamName && (
                          <div className={`mt-2 text-center text-[10px] font-extrabold ${colors.text} tracking-widest uppercase`}>
                            🏆 Winner: {valuation.winningTeamName}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {evaluated.length === 0 && (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground space-y-1">
          <span className="text-3xl">🎭</span>
          <p className="text-sm">No trades found for this season.</p>
        </div>
      )}
    </div>
  );
}
