import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import { DEFAULT_MODIFIERS } from "@/lib/trade-modifiers";
import {
  evaluateHistoricalTrade,
  evaluateThreeTeamTrade,
  isThreeTeamTrade,
  buildSeasonAdpMap,
  buildSeasonAdpDetailMap,
  getSeasonAdp,
  calcPlayerValue,
  calcPickValue,
  buildTradeActualsMap,
  SEVERITY_COLORS,
  type TradeRow,
  type TradeAssetRow,
  type TeamRow,
  type HistoricalAdpRow,
  type VerdictSeverity,
  type TradeValuation,
  type ThreeTeamValuation,
  type DynastyContext,
  type TradeActualsResult,
} from "@/lib/trade-utils";
import ThreeTeamTradeDetail from "./ThreeTeamTradeDetail";

interface Props {
  trades: TradeRow[];
  assets: TradeAssetRow[];
  teams: TeamRow[];
  historicalAdp: HistoricalAdpRow[];
  seasons: string[];
  dynastyCtx?: DynastyContext;
  tradeActuals: TradeActualsResult[];
}

interface EvaluatedTrade {
  trade: TradeRow;
  valuation: TradeValuation;
  threeTeamValuation?: ThreeTeamValuation;
}

type TradeTypeFilter = "all" | "two_team" | "three_team";

const VERDICT_ORDER: VerdictSeverity[] = ["robbery", "clear", "slight", "fair"];

const VERDICT_META: Record<VerdictSeverity, { title: string; emoji: string; description: string }> = {
  robbery: { title: "Flag on the Play", emoji: "🚩", description: "Someone got fleeced! 25%+ value gap" },
  clear: { title: "Pick Six", emoji: "🏆", description: "One side came out significantly ahead (15–25%)" },
  slight: { title: "Edge Rush", emoji: "📈", description: "Close, but one side got a little more (5–15%)" },
  fair: { title: "Fair Catch", emoji: "🧤", description: "Both sides walked away happy (within 5%)" },
};

// ─── Phase Display ─────────────────────────────────────────────
const PHASE_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  preseason: { label: "Pre", emoji: "📋", color: "text-slate-400" },
  early: { label: "Early", emoji: "🌱", color: "text-blue-400" },
  mid: { label: "Mid", emoji: "⚡", color: "text-amber-400" },
  late: { label: "Late", emoji: "🔥", color: "text-orange-400" },
  postseason: { label: "Post", emoji: "🏆", color: "text-emerald-400" },
};

// ─── Small sub-components ─────────────────────────────────────

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

function AssetWithValue({ a, tradeSeason, seasonAdpMap }: { a: TradeAssetRow; tradeSeason: string; seasonAdpMap: Map<string, Map<string, number>> }) {
  const val = getAssetValue(a, tradeSeason, seasonAdpMap);
  return (
    <div className="flex items-center gap-1.5 pl-1 py-0.5 text-xs">
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
          : formatPickDisplay(a)}
      </span>
      <span className="text-[10px] font-mono text-muted-foreground shrink-0">({Math.round(val).toLocaleString()})</span>
    </div>
  );
}

function formatPickDisplay(a: TradeAssetRow): string {
  const parts: string[] = [];
  if (a.pick_year) parts.push(String(a.pick_year));
  if (a.pick_round) parts.push(`Rd ${a.pick_round}`);
  if (a.pick_number) parts.push(`#${a.pick_number}`);
  return parts.length > 0 ? parts.join(" ") : "Draft Pick";
}

// ─── Trade of the Season card ─────────────────────────────────

interface FeaturedTrade {
  label: string;
  emoji: string;
  et: EvaluatedTrade;
}

function TradeOfSeasonCard({ label, emoji, et, assets, expandedId, onToggle, seasonAdpMap }: {
  label: string;
  emoji: string;
  et: EvaluatedTrade;
  assets: TradeAssetRow[];
  expandedId: number | null;
  onToggle: (id: number) => void;
  seasonAdpMap: Map<string, Map<string, number>>;
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
          {/* Phase badge */}
          {valuation.seasonPhase && valuation.actualsWeight != null && valuation.actualsWeight > 0 && (
            <span className={`text-[8px] font-mono ${PHASE_LABELS[valuation.seasonPhase]?.color ?? "text-muted-foreground"}`}>
              {PHASE_LABELS[valuation.seasonPhase]?.emoji} {Math.round(valuation.actualsWeight * 100)}%
            </span>
          )}
        </div>
        {/* Teams row */}
        <div className="flex items-center gap-1.5 text-xs">
          <span>{getTeamEmoji(trade.team_a_name)}</span>
          <span className="font-semibold truncate">{trade.team_a_name}</span>
          <span className="text-muted-foreground">↔</span>
          <span>{getTeamEmoji(trade.team_b_name)}</span>
          <span className="font-semibold truncate">{trade.team_b_name}</span>
          {valuation.winningTeamName && (
            <Badge className={`ml-auto text-[9px] px-1.5 py-0 ${colors.badge} border`}>
              {getTeamEmoji(valuation.winningTeamName)} +{Math.abs(valuation.pctDifference)}%
            </Badge>
          )}
          {!valuation.winningTeamName && (
            <Badge className="ml-auto text-[9px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">EVEN</Badge>
          )}
        </div>
        {/* Metric pills */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
            Gap: {Math.round(valuation.absoluteValueGap).toLocaleString()} pts
          </span>
          <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 rounded px-1.5 py-0.5">
            Size: {Math.round(valuation.tradeSize).toLocaleString()} pts
          </span>
          {valuation.loserLossPercentage > 0 && (
            <span className={`text-[9px] font-mono rounded px-1.5 py-0.5 ${
              valuation.loserLossPercentage >= 25 ? "bg-red-500/15 text-red-400" :
              valuation.loserLossPercentage >= 10 ? "bg-amber-500/15 text-amber-400" :
              "bg-muted/40 text-muted-foreground"
            }`}>
              Overpaid: {valuation.loserLossPercentage}%
            </span>
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
              {teamAAssets.map((a) => <AssetWithValue key={a.id} a={a} tradeSeason={trade.season} seasonAdpMap={seasonAdpMap} />)}
              <div className="mt-1.5 pt-1 border-t border-border/30 flex items-center justify-between">
                <span className="text-[10px] font-bold text-muted-foreground">Package Total</span>
                <span className="text-xs font-bold font-mono">{Math.round(valuation.teamAValue).toLocaleString()} pts</span>
              </div>
            </div>
            <div>
              <div className={`text-[10px] font-bold ${colors.text} mb-1`}>
                {getTeamEmoji(trade.team_b_name)} {trade.team_b_name} sends
              </div>
              {teamBAssets.map((a) => <AssetWithValue key={a.id} a={a} tradeSeason={trade.season} seasonAdpMap={seasonAdpMap} />)}
              <div className="mt-1.5 pt-1 border-t border-border/30 flex items-center justify-between">
                <span className="text-[10px] font-bold text-muted-foreground">Package Total</span>
                <span className="text-xs font-bold font-mono">{Math.round(valuation.teamBValue).toLocaleString()} pts</span>
              </div>
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

export default function GoodBadUgly({ trades, assets, teams, historicalAdp, seasons, dynastyCtx, tradeActuals }: Props) {
  const [expandedTrades, setExpandedTrades] = useState<Set<number>>(new Set());
  const toggleExpanded = (id: number) => {
    setExpandedTrades((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [selectedSeason, setSelectedSeason] = useState<string>("all");
  const [activeFilters, setActiveFilters] = useState<Set<VerdictSeverity>>(new Set(VERDICT_ORDER));
  const [tradeTypeFilter, setTradeTypeFilter] = useState<TradeTypeFilter>("all");

  // Season-aware ADP: season → (player_name → adp_rank)
  const seasonAdpMap = useMemo(() => buildSeasonAdpMap(historicalAdp), [historicalAdp]);
  // Season ADP detail for fallback system
  const seasonAdpDetailMap = useMemo(() => buildSeasonAdpDetailMap(historicalAdp), [historicalAdp]);
  // Trade actuals map: tradeId → { meta, players }
  const actualsMap = useMemo(() => buildTradeActualsMap(tradeActuals), [tradeActuals]);

  // Filter trades by season
  const filteredTrades = useMemo(
    () => (selectedSeason === "all" ? trades : trades.filter((t) => t.season === selectedSeason)),
    [trades, selectedSeason]
  );

  // Apply trade type filter
  const typeFilteredTrades = useMemo(() => {
    if (tradeTypeFilter === "all") return filteredTrades;
    return filteredTrades.filter((t) =>
      tradeTypeFilter === "three_team" ? isThreeTeamTrade(t) : !isThreeTeamTrade(t)
    );
  }, [filteredTrades, tradeTypeFilter]);

  const evaluated = useMemo<EvaluatedTrade[]>(() => {
    return typeFilteredTrades.map((trade) => {
      const is3 = isThreeTeamTrade(trade);
      return {
        trade,
        valuation: evaluateHistoricalTrade(trade, assets, seasonAdpMap, dynastyCtx, actualsMap, seasonAdpDetailMap, DEFAULT_MODIFIERS.unrankedFallbackFactor),
        threeTeamValuation: is3
          ? evaluateThreeTeamTrade(trade, assets, seasonAdpMap, dynastyCtx, actualsMap, seasonAdpDetailMap, DEFAULT_MODIFIERS.unrankedFallbackFactor)
          : undefined,
      };
    });
  }, [typeFilteredTrades, assets, seasonAdpMap, dynastyCtx, actualsMap, seasonAdpDetailMap]);

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

  // Count blended trades
  const blendedCount = useMemo(
    () => evaluated.filter(et => et.valuation.actualsWeight && et.valuation.actualsWeight > 0).length,
    [evaluated]
  );

  // Trade of the Season — biggest robbery (by %), worst absolute loss, most even
  const featuredTrades = useMemo<FeaturedTrade[]>(() => {
    // Exclude test/empty trades (0 value on both sides) and require at least one player
    const validCandidates = evaluated.filter((et) => {
      if (et.valuation.tradeSize === 0) return false;
      const tradeAssets = assets.filter((a) => a.trade_id === et.trade.id);
      return tradeAssets.some((a) => a.asset_type === "player");
    });
    if (validCandidates.length === 0) return [];

    // Most Lopsided by % (relative gap)
    const byPctDesc = [...validCandidates].sort(
      (a, b) => Math.abs(b.valuation.pctDifference) - Math.abs(a.valuation.pctDifference)
    );
    const mostLopsidedPct = byPctDesc[0];

    // Worst Absolute Loss (raw point gap)
    const byAbsDesc = [...validCandidates].sort(
      (a, b) => b.valuation.absoluteValueGap - a.valuation.absoluteValueGap
    );
    const worstAbsLoss = byAbsDesc[0];

    // Most Even Deal (smallest gap)
    const byPctAsc = [...validCandidates].sort(
      (a, b) => Math.abs(a.valuation.pctDifference) - Math.abs(b.valuation.pctDifference)
    );
    // Pick the most even that isn't already featured as lopsided/worst
    const usedIds = new Set([mostLopsidedPct?.trade.id, worstAbsLoss?.trade.id].filter(Boolean));
    const mostEven = byPctAsc.find((et) => !usedIds.has(et.trade.id)) ?? byPctAsc[0];

    const results: FeaturedTrade[] = [];
    if (mostLopsidedPct) {
      results.push({ label: "Most Lopsided %", emoji: "🚨", et: mostLopsidedPct });
    }
    // Only show "Worst Absolute Loss" if it's a different trade than the % leader
    if (worstAbsLoss && worstAbsLoss.trade.id !== mostLopsidedPct?.trade.id) {
      results.push({ label: "Worst Absolute Loss", emoji: "💸", et: worstAbsLoss });
    }
    if (mostEven) {
      results.push({ label: "Most Even Deal", emoji: "⚖️", et: mostEven });
    }
    return results;
  }, [evaluated, assets]);

  // Three-team count
  const threeTeamCount = useMemo(
    () => (selectedSeason === "all" ? trades : trades.filter((t) => t.season === selectedSeason)).filter(isThreeTeamTrade).length,
    [trades, selectedSeason]
  );

  // Manager leaderboard
  const leaderboard = useMemo(() => {
    const board = new Map<string, { wins: number; losses: number; even: number }>();
    for (const et of evaluated) {
      const { trade, threeTeamValuation } = et;

      if (threeTeamValuation) {
        for (const team of threeTeamValuation.teams) {
          if (!board.has(team.teamName)) board.set(team.teamName, { wins: 0, losses: 0, even: 0 });
          if (team.rank === 1) board.get(team.teamName)!.wins++;
          else if (team.rank === 2) board.get(team.teamName)!.even++;
          else board.get(team.teamName)!.losses++;
        }
      } else {
        const { valuation } = et;
        const teamNames = [trade.team_a_name, trade.team_b_name];
        for (const name of teamNames) {
          if (!board.has(name)) board.set(name, { wins: 0, losses: 0, even: 0 });
        }
        if (!valuation.winningTeamName) {
          board.get(trade.team_a_name)!.even++;
          board.get(trade.team_b_name)!.even++;
        } else {
          board.get(valuation.winningTeamName)!.wins++;
          const loser = valuation.winningTeamName === trade.team_a_name ? trade.team_b_name : trade.team_a_name;
          board.get(loser)!.losses++;
        }
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
        if (next.size === 1) return prev;
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

        {/* Trade type filter */}
        <div className="flex items-center gap-1 bg-muted/30 rounded-full px-1 py-0.5 border border-border/30">
          {(["all", "two_team", "three_team"] as TradeTypeFilter[]).map((t) => {
            const label = t === "all" ? "All" : t === "two_team" ? "2-Team" : "3-Way";
            const count = t === "three_team" ? threeTeamCount : undefined;
            return (
              <button
                key={t}
                onClick={() => setTradeTypeFilter(t)}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-all ${
                  tradeTypeFilter === t
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}{count !== undefined && count > 0 ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

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

        {/* Blended indicator (replaces ADP/Actuals toggle) */}
        {blendedCount > 0 && (
          <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1">
            <span className="text-[10px] text-emerald-400 font-semibold">⚡ Blended</span>
            <span className="text-[9px] text-emerald-400/70 font-mono">{blendedCount}/{total}</span>
          </div>
        )}

        <span className="text-[10px] text-muted-foreground ml-auto font-mono">
          {total} trades
        </span>
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
          <div className={`grid grid-cols-1 gap-2 ${featuredTrades.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
            {featuredTrades.map((ft) => (
              <TradeOfSeasonCard
                key={`${ft.label}-${ft.et.trade.id}`}
                label={ft.label}
                emoji={ft.emoji}
                et={ft.et}
                assets={assets}
                expandedId={expandedTrades.has(ft.et.trade.id) ? ft.et.trade.id : null}
                onToggle={toggleExpanded}
                seasonAdpMap={seasonAdpMap}
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
                    <span className="truncate font-medium">{row.name}</span>
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
            <div className={`flex items-center gap-2 py-2 px-3 rounded-lg ${colors.bg} border ${colors.border}`}>
              <span className="text-lg">{meta.emoji}</span>
              <div>
                <h3 className={`text-sm font-bold ${colors.text}`}>{meta.title}</h3>
                <p className="text-[10px] text-muted-foreground">{meta.description}</p>
              </div>
              <Badge className={`ml-auto ${colors.badge} border`}>{items.length}</Badge>
            </div>

            <div className="space-y-1.5 pl-2">
              {items.map(({ trade, valuation, threeTeamValuation: threeTeamVal }) => {
                const isExpanded = expandedTrades.has(trade.id);
                const teamAAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_a_id);
                const teamBAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_b_id);

                const is3Way = isThreeTeamTrade(trade);
                const displayWinner = is3Way && threeTeamVal ? threeTeamVal.winner : null;

                return (
                  <div
                    key={trade.id}
                    className={`rounded-lg border transition-all cursor-pointer ${
                      isExpanded ? `${colors.border} ${colors.bg}` : "border-border/50 hover:border-border hover:bg-muted/20"
                    }`}
                    onClick={() => toggleExpanded(trade.id)}
                  >
                    <div className="flex items-center gap-2 px-3 py-2 text-xs">
                      <span className="font-mono text-muted-foreground w-6 text-[10px]">#{trade.trade_number}</span>
                      {is3Way && (
                        <Badge className="text-[8px] px-1 py-0 bg-purple-500/20 text-purple-400 border-purple-500/30 border shrink-0">3-WAY</Badge>
                      )}
                      <span className="flex items-center gap-1 min-w-[80px]">
                        {getTeamEmoji(trade.team_a_name)}
                        <span className="truncate font-medium">{trade.team_a_name}</span>
                      </span>
                      <span className="text-muted-foreground text-[10px]">↔</span>
                      <span className="flex items-center gap-1 min-w-[80px]">
                        {getTeamEmoji(trade.team_b_name)}
                        <span className="truncate font-medium">{trade.team_b_name}</span>
                      </span>
                      {is3Way && trade.team_c_name && (
                        <>
                          <span className="text-muted-foreground text-[10px]">↔</span>
                          <span className="flex items-center gap-1 min-w-[80px]">
                            {getTeamEmoji(trade.team_c_name)}
                            <span className="truncate font-medium">{trade.team_c_name}</span>
                          </span>
                        </>
                      )}
                      {/* Phase indicator */}
                      {valuation.seasonPhase && valuation.actualsWeight != null && valuation.actualsWeight > 0 && (
                        <span className={`text-[8px] font-mono shrink-0 ${PHASE_LABELS[valuation.seasonPhase]?.color ?? "text-muted-foreground"}`}>
                          {PHASE_LABELS[valuation.seasonPhase]?.emoji} {Math.round(valuation.actualsWeight * 100)}%
                        </span>
                      )}
                      {is3Way && displayWinner ? (
                        <span className={`text-[10px] font-bold ml-auto ${colors.text}`}>
                          {getTeamEmoji(displayWinner.teamName)} 👑 +{Math.round(displayWinner.netValue).toLocaleString()}
                        </span>
                      ) : valuation.winningTeamName ? (
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
                        {is3Way ? (
                          <ThreeTeamTradeDetail
                            trade={trade}
                            assets={assets}
                            seasonAdpMap={seasonAdpMap}
                            dynastyCtx={dynastyCtx}
                          />
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-4 text-xs">
                              <div>
                                <div className={`text-[10px] font-bold ${colors.text} mb-1`}>
                                  {getTeamEmoji(trade.team_a_name)} {trade.team_a_name} sends →
                                </div>
                                {teamAAssets.map((a) => <AssetWithValue key={a.id} a={a} tradeSeason={trade.season} seasonAdpMap={seasonAdpMap} />)}
                                <div className="mt-1.5 pt-1 border-t border-border/30 flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-muted-foreground">Package Total</span>
                                  <span className="text-xs font-bold font-mono">{Math.round(valuation.teamAValue).toLocaleString()} pts</span>
                                </div>
                                {valuation.winningTeamId === trade.team_a_id && (
                                  <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border mt-1.5 w-fit">WINNER</Badge>
                                )}
                              </div>
                              <div>
                                <div className={`text-[10px] font-bold ${colors.text} mb-1`}>
                                  {getTeamEmoji(trade.team_b_name)} {trade.team_b_name} sends →
                                </div>
                                {teamBAssets.map((a) => <AssetWithValue key={a.id} a={a} tradeSeason={trade.season} seasonAdpMap={seasonAdpMap} />)}
                                <div className="mt-1.5 pt-1 border-t border-border/30 flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-muted-foreground">Package Total</span>
                                  <span className="text-xs font-bold font-mono">{Math.round(valuation.teamBValue).toLocaleString()} pts</span>
                                </div>
                                {valuation.winningTeamId === trade.team_b_id && (
                                  <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border mt-1.5 w-fit">WINNER</Badge>
                                )}
                              </div>
                            </div>
                            {valuation.winningTeamName && (
                              <div className={`mt-3 pt-2 border-t border-border/30 text-center space-y-1`}>
                                <div className="text-[11px] font-bold">
                                  {getTeamEmoji(valuation.winningTeamName)} <span className="text-emerald-400">{valuation.winningTeamName}</span>
                                  <span className="text-muted-foreground"> receives </span>
                                  <span className="font-mono text-emerald-400">+{Math.round(valuation.absoluteValueGap).toLocaleString()}</span>
                                  <span className="text-muted-foreground"> more value</span>
                                </div>
                                <div className="flex items-center justify-center gap-2">
                                  <span className="text-[9px] font-mono text-muted-foreground bg-muted/30 rounded px-1.5 py-0.5">
                                    {Math.abs(valuation.pctDifference)}% gap
                                  </span>
                                  <span className="text-[9px] font-mono text-muted-foreground bg-muted/30 rounded px-1.5 py-0.5">
                                    Trade size: {Math.round(valuation.tradeSize).toLocaleString()}
                                  </span>
                                  {valuation.loserLossPercentage > 0 && (
                                    <span className={`text-[9px] font-mono rounded px-1.5 py-0.5 ${
                                      valuation.loserLossPercentage >= 25 ? "bg-red-500/15 text-red-400" :
                                      valuation.loserLossPercentage >= 10 ? "bg-amber-500/15 text-amber-400" :
                                      "bg-muted/30 text-muted-foreground"
                                    }`}>
                                      Overpaid: {valuation.loserLossPercentage}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </>
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
