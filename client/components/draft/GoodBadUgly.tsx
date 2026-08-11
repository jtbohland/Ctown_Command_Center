import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
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
}

interface GroupedTrade {
  trade: TradeRow;
  valuation: TradeValuation;
}

const VERDICT_ORDER: VerdictSeverity[] = ["robbery", "clear", "slight", "fair"];

const VERDICT_HEADERS: Record<VerdictSeverity, { title: string; emoji: string; description: string }> = {
  robbery: {
    title: "Highway Robbery",
    emoji: "🚨",
    description: "Someone got fleeced! 25%+ value difference",
  },
  clear: {
    title: "Clear Winners",
    emoji: "🏆",
    description: "One side came out significantly ahead (15-25%)",
  },
  slight: {
    title: "Slight Edge",
    emoji: "📈",
    description: "Close, but one side got a little more (5-15%)",
  },
  fair: {
    title: "Fair Trades",
    emoji: "⚖️",
    description: "Both sides walked away happy (within 5%)",
  },
};

export default function GoodBadUgly({ trades, assets, teams, historicalAdp }: Props) {
  const [expandedTrade, setExpandedTrade] = useState<number | null>(null);

  const adpMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of historicalAdp) {
      m.set(row.player_name.toLowerCase(), row.adp_rank);
    }
    return m;
  }, [historicalAdp]);

  // Group trades by verdict severity
  const grouped = useMemo(() => {
    const groups: Record<VerdictSeverity, GroupedTrade[]> = {
      robbery: [],
      clear: [],
      slight: [],
      fair: [],
    };

    for (const trade of trades) {
      const valuation = evaluateHistoricalTrade(trade, assets, adpMap);
      const severity = valuation.verdict.severity as VerdictSeverity;
      groups[severity].push({ trade, valuation });
    }

    // Sort each group by most lopsided first
    for (const key of Object.keys(groups) as VerdictSeverity[]) {
      groups[key].sort((a, b) => Math.abs(b.valuation.pctDifference) - Math.abs(a.valuation.pctDifference));
    }

    return groups;
  }, [trades, assets, adpMap]);

  // Stats
  const totalTrades = trades.length;
  const stats = VERDICT_ORDER.map((s) => ({
    severity: s,
    count: grouped[s].length,
    pct: totalTrades > 0 ? Math.round((grouped[s].length / totalTrades) * 100) : 0,
  }));

  return (
    <div className="space-y-4">
      {/* Stats Banner */}
      <div className="grid grid-cols-4 gap-2">
        {stats.map(({ severity, count, pct }) => {
          const header = VERDICT_HEADERS[severity];
          const colors = SEVERITY_COLORS[severity];
          return (
            <div
              key={severity}
              className={`rounded-xl border ${colors.border} ${colors.bg} p-3 text-center`}
            >
              <div className="text-2xl mb-0.5">{header.emoji}</div>
              <div className={`text-2xl font-extrabold font-mono ${colors.text}`}>{count}</div>
              <div className="text-[10px] text-muted-foreground">{header.title}</div>
              <div className="text-[10px] text-muted-foreground font-mono">{pct}%</div>
            </div>
          );
        })}
      </div>

      {/* Verdict Sections */}
      {VERDICT_ORDER.map((severity) => {
        const header = VERDICT_HEADERS[severity];
        const colors = SEVERITY_COLORS[severity];
        const items = grouped[severity];

        if (items.length === 0) return null;

        return (
          <div key={severity} className="space-y-2">
            {/* Section Header */}
            <div className={`flex items-center gap-2 py-2 px-3 rounded-lg ${colors.bg} border ${colors.border}`}>
              <span className="text-lg">{header.emoji}</span>
              <div>
                <h3 className={`text-sm font-bold ${colors.text}`}>{header.title}</h3>
                <p className="text-[10px] text-muted-foreground">{header.description}</p>
              </div>
              <Badge className={`ml-auto ${colors.badge} border`}>{items.length}</Badge>
            </div>

            {/* Trade Cards */}
            <div className="space-y-1.5 pl-2">
              {items.map(({ trade, valuation }) => {
                const isExpanded = expandedTrade === trade.id;
                const teamAAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_a_id);
                const teamBAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_b_id);

                return (
                  <div
                    key={trade.id}
                    className={`rounded-lg border transition-all cursor-pointer ${isExpanded ? `${colors.border} ${colors.bg}` : "border-border/50 hover:border-border hover:bg-muted/20"}`}
                    onClick={() => setExpandedTrade(isExpanded ? null : trade.id)}
                  >
                    {/* Compact row */}
                    <div className="flex items-center gap-2 px-3 py-2">
                      <span className="text-[10px] font-mono text-muted-foreground w-6">#{trade.trade_number}</span>

                      <span className="text-xs flex items-center gap-1 min-w-[100px]">
                        {getTeamEmoji(trade.team_a_name)}
                        <span className="truncate max-w-[80px] font-medium">{trade.team_a_name.split(" ")[0]}</span>
                      </span>

                      <span className="text-muted-foreground text-[10px]">↔</span>

                      <span className="text-xs flex items-center gap-1 min-w-[100px]">
                        {getTeamEmoji(trade.team_b_name)}
                        <span className="truncate max-w-[80px] font-medium">{trade.team_b_name.split(" ")[0]}</span>
                      </span>

                      {valuation.winningTeamName && (
                        <span className={`text-[10px] font-bold ml-auto ${colors.text}`}>
                          {getTeamEmoji(valuation.winningTeamName)} +{Math.abs(valuation.pctDifference)}%
                        </span>
                      )}

                      <span className="text-[10px] text-muted-foreground ml-2">{trade.season}</span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className={`border-t ${colors.border} px-3 py-3`}>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <div className="text-[10px] font-bold text-muted-foreground mb-1">
                              {getTeamEmoji(trade.team_a_name)} {trade.team_a_name} sends →
                              <span className="font-mono ml-1">{Math.round(valuation.teamAValue).toLocaleString()} pts</span>
                            </div>
                            {teamAAssets.map((a) => (
                              <div key={a.id} className="flex items-center gap-1 pl-1 py-0.5">
                                {a.asset_type === "player" ? (
                                  <Badge className={`text-[9px] px-1 py-0 ${POSITION_BG_CLASSES[a.player_position ?? ""] ?? "bg-muted"}`}>
                                    {a.player_position}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">📋</Badge>
                                )}
                                <span className="truncate">
                                  {a.asset_type === "player" ? a.player_name : `${a.pick_year} Rd ${a.pick_round}${a.pick_number ? ` #${a.pick_number}` : ""}`}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div>
                            <div className="text-[10px] font-bold text-muted-foreground mb-1">
                              {getTeamEmoji(trade.team_b_name)} {trade.team_b_name} sends →
                              <span className="font-mono ml-1">{Math.round(valuation.teamBValue).toLocaleString()} pts</span>
                            </div>
                            {teamBAssets.map((a) => (
                              <div key={a.id} className="flex items-center gap-1 pl-1 py-0.5">
                                {a.asset_type === "player" ? (
                                  <Badge className={`text-[9px] px-1 py-0 ${POSITION_BG_CLASSES[a.player_position ?? ""] ?? "bg-muted"}`}>
                                    {a.player_position}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">📋</Badge>
                                )}
                                <span className="truncate">
                                  {a.asset_type === "player" ? a.player_name : `${a.pick_year} Rd ${a.pick_round}${a.pick_number ? ` #${a.pick_number}` : ""}`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
