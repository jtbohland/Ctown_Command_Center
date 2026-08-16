import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import {
  buildSeasonAdpMap,
  getSeasonAdp,
  calcPlayerValue,
  calcPickValue,
  seasonToDraftYear,
  SEVERITY_COLORS,
  type TradeRow,
  type TradeAssetRow,
  type TeamRow,
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
  const refYear = seasonToDraftYear(tradeSeason);
  return calcPickValue(round, year, a.pick_number ?? undefined, refYear);
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

interface TeamDisplayData {
  teamId: number;
  teamName: string;
  dbTotal: number;
  rank: number;
}

function TeamColumn({
  team,
  sentAssets,
  receivedAssets,
  tradeSeason,
  seasonAdpMap,
  isWinner,
  colorClass,
}: {
  team: TeamDisplayData;
  sentAssets: TradeAssetRow[];
  receivedAssets: TradeAssetRow[];
  tradeSeason: string;
  seasonAdpMap: Map<string, Map<string, number>>;
  isWinner: boolean;
  colorClass: string;
}) {
  const sentTotal = sentAssets.reduce((sum, a) => sum + getAssetValue(a, tradeSeason, seasonAdpMap), 0);
  const receivedTotal = receivedAssets.reduce((sum, a) => sum + getAssetValue(a, tradeSeason, seasonAdpMap), 0);
  const netValue = team.dbTotal; // Use DB total as canonical net value

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
              −{Math.round(sentTotal).toLocaleString()}
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
              +{Math.round(receivedTotal).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Net value from DB */}
      <div className="pt-1 border-t border-border/50 flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground">Net Value</span>
        <span
          className={`text-xs font-bold font-mono ${
            netValue > 0
              ? "text-emerald-400"
              : netValue < 0
                ? "text-red-400"
                : "text-muted-foreground"
          }`}
        >
          {netValue >= 0 ? "+" : ""}
          {Math.round(netValue).toLocaleString()}
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
  teams: TeamRow[];
}

export default function ThreeTeamTradeDetail({
  trade,
  assets,
  seasonAdpMap,
  teams,
}: ThreeTeamTradeDetailProps) {
  const tradeAssets = useMemo(
    () => assets.filter((a) => a.trade_id === trade.id),
    [assets, trade.id],
  );

  // Build team display data from DB totals
  const teamDisplayData = useMemo(() => {
    const teamA: TeamDisplayData = {
      teamId: trade.team_a_id,
      teamName: trade.team_a_name,
      dbTotal: trade.team_a_total ?? 0,
      rank: 0,
    };
    const teamB: TeamDisplayData = {
      teamId: trade.team_b_id,
      teamName: trade.team_b_name,
      dbTotal: trade.team_b_total ?? 0,
      rank: 0,
    };
    const teamC: TeamDisplayData = {
      teamId: trade.team_c_id ?? 0,
      teamName: trade.team_c_name ?? "Unknown",
      dbTotal: trade.team_c_total ?? 0,
      rank: 0,
    };

    const sorted = [teamA, teamB, teamC].sort((a, b) => b.dbTotal - a.dbTotal);
    sorted.forEach((t, i) => { t.rank = i + 1; });
    return sorted;
  }, [trade]);

  const winnerId = trade.winner_team_id;
  const winnerTeam = teamDisplayData.find(t => t.teamId === winnerId) ?? teamDisplayData[0];
  const secondTeam = teamDisplayData.find(t => t.rank === 2) ?? teamDisplayData[1];
  const winnerMargin = winnerTeam.dbTotal - secondTeam.dbTotal;

  const severity = (trade.verdict_severity ?? "fair") as keyof typeof SEVERITY_COLORS;
  const colors = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.fair;

  return (
    <div className="space-y-3">
      {/* Three-column layout — one per team */}
      <div className="grid grid-cols-3 gap-3">
        {teamDisplayData.map((team) => {
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
              isWinner={team.teamId === winnerId}
              colorClass={colors.text}
            />
          );
        })}
      </div>

      {/* Winner banner */}
      <div className="text-center pt-2 border-t border-border/30">
        <span className="text-[11px] font-bold">
          {getTeamEmoji(winnerTeam.teamName)}{" "}
          <span className="text-emerald-400">{winnerTeam.teamName}</span>
          <span className="text-muted-foreground"> gets the best deal </span>
          <span className="font-mono text-emerald-400">
            ({Math.round(winnerTeam.dbTotal).toLocaleString()} pts)
          </span>
          <span className="text-muted-foreground ml-1.5">
            · Margin: +{Math.round(winnerMargin).toLocaleString()} over 2nd
          </span>
        </span>
      </div>
    </div>
  );
}
