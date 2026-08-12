import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import {
  evaluateThreeTeamTrade,
  buildSeasonAdpMap,
  getSeasonAdp,
  calcPlayerValue,
  calcPickValue,
  SEVERITY_COLORS,
  type TradeRow,
  type TradeAssetRow,
  type ThreeTeamValuation,
  type TeamValuationResult,
  type DynastyContext,
} from "@/lib/trade-utils";

// ─── Helpers ─────────────────────────────────────────────────

function formatPickDisplay(a: TradeAssetRow): string {
  const parts: string[] = [];
  if (a.pick_year) parts.push(String(a.pick_year));
  if (a.pick_round) parts.push(`Rd ${a.pick_round}`);
  if (a.pick_number) parts.push(`#${a.pick_number}`);
  return parts.length > 0 ? parts.join(" ") : "Draft Pick";
}

function getAssetValue(
  a: TradeAssetRow,
  tradeSeason: string,
  seasonAdpMap: Map<string, Map<string, number>>,
): number {
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

// ─── Asset Row ───────────────────────────────────────────────

function AssetRow({
  a,
  tradeSeason,
  seasonAdpMap,
}: {
  a: TradeAssetRow;
  tradeSeason: string;
  seasonAdpMap: Map<string, Map<string, number>>;
}) {
  const val = getAssetValue(a, tradeSeason, seasonAdpMap);
  return (
    <div className="flex items-center gap-1.5 py-0.5 text-xs">
      {a.asset_type === "player" ? (
        <Badge
          className={`text-[9px] px-1 py-0 ${POSITION_BG_CLASSES[a.player_position ?? ""] ?? "bg-muted"}`}
        >
          {a.player_position}
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="text-[9px] px-1 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400"
        >
          📋
        </Badge>
      )}
      <span className="truncate flex-1">
        {a.asset_type === "player" ? a.player_name : formatPickDisplay(a)}
      </span>
      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
        ({Math.round(val).toLocaleString()})
      </span>
    </div>
  );
}

// ─── Team Column ─────────────────────────────────────────────

function TeamColumn({
  team,
  sentAssets,
  receivedAssets,
  tradeSeason,
  seasonAdpMap,
  isWinner,
  colorClass,
}: {
  team: TeamValuationResult;
  sentAssets: TradeAssetRow[];
  receivedAssets: TradeAssetRow[];
  tradeSeason: string;
  seasonAdpMap: Map<string, Map<string, number>>;
  isWinner: boolean;
  colorClass: string;
}) {
  return (
    <div className="space-y-2">
      {/* Team header */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{getTeamEmoji(team.teamName)}</span>
        <span className="text-xs font-bold truncate">{team.teamName}</span>
        {isWinner && (
          <Badge className="text-[8px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border ml-auto">
            👑 WINNER
          </Badge>
        )}
        <Badge className={`text-[8px] px-1 py-0 ml-auto ${team.rank === 1 ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : team.rank === 2 ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "bg-red-500/15 text-red-400 border-red-500/30"} border`}>
          #{team.rank}
        </Badge>
      </div>

      {/* Sends section */}
      {sentAssets.length > 0 && (
        <div>
          <div className={`text-[10px] font-bold ${colorClass} mb-0.5`}>
            Sends →
          </div>
          {sentAssets.map((a) => (
            <AssetRow key={a.id} a={a} tradeSeason={tradeSeason} seasonAdpMap={seasonAdpMap} />
          ))}
          <div className="mt-1 pt-1 border-t border-border/30 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Sent</span>
            <span className="text-[10px] font-mono font-bold text-red-400">
              −{Math.round(team.sentValue).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Receives section */}
      {receivedAssets.length > 0 && (
        <div>
          <div className={`text-[10px] font-bold ${colorClass} mb-0.5`}>
            ← Receives
          </div>
          {receivedAssets.map((a) => (
            <AssetRow key={a.id} a={a} tradeSeason={tradeSeason} seasonAdpMap={seasonAdpMap} />
          ))}
          <div className="mt-1 pt-1 border-t border-border/30 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Received</span>
            <span className="text-[10px] font-mono font-bold text-emerald-400">
              +{Math.round(team.receivedValue).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Net value */}
      <div className="pt-1 border-t border-border/50 flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground">Net Value</span>
        <span
          className={`text-xs font-bold font-mono ${
            team.netValue > 0
              ? "text-emerald-400"
              : team.netValue < 0
                ? "text-red-400"
                : "text-muted-foreground"
          }`}
        >
          {team.netValue >= 0 ? "+" : ""}
          {Math.round(team.netValue).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

interface ThreeTeamTradeDetailProps {
  trade: TradeRow;
  assets: TradeAssetRow[];
  seasonAdpMap: Map<string, Map<string, number>>;
  dynastyCtx?: DynastyContext;
}

export default function ThreeTeamTradeDetail({
  trade,
  assets,
  seasonAdpMap,
  dynastyCtx,
}: ThreeTeamTradeDetailProps) {
  const valuation = useMemo(
    () => evaluateThreeTeamTrade(trade, assets, seasonAdpMap, dynastyCtx),
    [trade, assets, seasonAdpMap, dynastyCtx],
  );

  const tradeAssets = useMemo(
    () => assets.filter((a) => a.trade_id === trade.id),
    [assets, trade.id],
  );

  const severity = valuation.verdict.severity;
  const colors = SEVERITY_COLORS[severity];

  return (
    <div className="space-y-3">
      {/* Three-column layout — one per team */}
      <div className="grid grid-cols-3 gap-3">
        {valuation.teams.map((team) => {
          const sentAssets = tradeAssets.filter((a) => a.from_team_id === team.teamId);
          const receivedAssets = tradeAssets.filter((a) => a.recipient_team_id === team.teamId);
          return (
            <TeamColumn
              key={team.teamId}
              team={team}
              sentAssets={sentAssets}
              receivedAssets={receivedAssets}
              tradeSeason={trade.season}
              seasonAdpMap={seasonAdpMap}
              isWinner={team.rank === 1}
              colorClass={colors.text}
            />
          );
        })}
      </div>

      {/* Winner banner */}
      <div className={`text-center pt-2 border-t border-border/30`}>
        <span className="text-[11px] font-bold">
          {getTeamEmoji(valuation.winner.teamName)}{" "}
          <span className="text-emerald-400">{valuation.winner.teamName}</span>
          <span className="text-muted-foreground"> gets the best deal </span>
          <span className="font-mono text-emerald-400">
            (+{Math.round(valuation.winner.netValue).toLocaleString()} net)
          </span>
          <span className="text-muted-foreground ml-1.5">
            · Margin: +{Math.round(valuation.winnerMarginOverSecond).toLocaleString()} over 2nd
          </span>
        </span>
      </div>
    </div>
  );
}

/** Hook-free evaluator for three-team trades (used in list contexts) */
export function evaluateThreeTeam(
  trade: TradeRow,
  assets: TradeAssetRow[],
  seasonAdpMap: Map<string, Map<string, number>>,
  dynastyCtx?: DynastyContext,
): ThreeTeamValuation {
  return evaluateThreeTeamTrade(trade, assets, seasonAdpMap, dynastyCtx);
}
