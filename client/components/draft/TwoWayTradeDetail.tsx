import { Badge } from "@/components/ui/badge";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import {
  getSeasonAdp,
  calcPlayerValue,
  calcPickValue,
  seasonToDraftYear,
  type TradeRow,
  type TradeAssetRow,
} from "@/lib/trade-utils";
import { ConfidenceTooltip } from "./ConfidenceTooltip";

// ─── Helpers ────────────────────────────────────────────────

function formatPickLabel(a: TradeAssetRow): string {
  const parts: string[] = [];
  if (a.pick_year) parts.push(String(a.pick_year));
  if (a.pick_round) parts.push(`Rd ${a.pick_round}`);
  if (a.pick_number) parts.push(`#${a.pick_number}`);
  return parts.length > 0 ? parts.join(" ") : "Draft Pick";
}

function getAssetDisplayValue(
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

// ─── Asset Row ──────────────────────────────────────────────

function TradeAssetItem({
  a,
  tradeSeason,
  seasonAdpMap,
}: {
  a: TradeAssetRow;
  tradeSeason: string;
  seasonAdpMap: Map<string, Map<string, number>>;
}) {
  const val = getAssetDisplayValue(a, tradeSeason, seasonAdpMap);

  return (
    <div className="flex items-center gap-1.5 py-0.5 text-xs">
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
      <span className="text-[10px] font-mono text-muted-foreground shrink-0">
        ({Math.round(val).toLocaleString()})
      </span>
    </div>
  );
}

// ─── Team Column (Sends / Receives / Net) ───────────────────

function TeamColumn({
  teamName,
  sentAssets,
  receivedAssets,
  sentValue,
  receivedValue,
  netValue,
  isWinner,
  tradeSeason,
  seasonAdpMap,
  colorClass,
  side,
}: {
  teamName: string;
  sentAssets: TradeAssetRow[];
  receivedAssets: TradeAssetRow[];
  sentValue: number;
  receivedValue: number;
  netValue: number;
  isWinner: boolean;
  tradeSeason: string;
  seasonAdpMap: Map<string, Map<string, number>>;
  colorClass: string;
  side: "left" | "right";
}) {
  return (
    <div className="space-y-2">
      {/* Team header */}
      <div className="flex items-center gap-1.5">
        <span className="text-sm">{getTeamEmoji(teamName)}</span>
        <span className="text-xs font-bold truncate">{teamName}</span>
        {isWinner && (
          <Badge className="text-[8px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border ml-auto">
            👑 WINNER
          </Badge>
        )}
      </div>

      {/* Sends section */}
      {sentAssets.length > 0 && (
        <div>
          <div className={`text-[10px] font-bold ${colorClass} mb-0.5`}>
            {side === "left" ? "Sends →" : "← Sends"}
          </div>
          {sentAssets.map((a) => (
            <TradeAssetItem key={a.id} a={a} tradeSeason={tradeSeason} seasonAdpMap={seasonAdpMap} />
          ))}
          <div className="mt-1 pt-1 border-t border-border/30 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Sent</span>
            <span className="text-[10px] font-mono font-bold text-red-400">
              −{Math.round(sentValue).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Receives section */}
      {receivedAssets.length > 0 && (
        <div>
          <div className={`text-[10px] font-bold ${colorClass} mb-0.5`}>
            {side === "left" ? "Receives ←" : "→ Receives"}
          </div>
          {receivedAssets.map((a) => (
            <TradeAssetItem key={a.id} a={a} tradeSeason={tradeSeason} seasonAdpMap={seasonAdpMap} />
          ))}
          <div className="mt-1 pt-1 border-t border-border/30 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Received</span>
            <span className="text-[10px] font-mono font-bold text-emerald-400">
              +{Math.round(receivedValue).toLocaleString()}
            </span>
          </div>
        </div>
      )}

      {/* Net value */}
      <div className="pt-1 border-t border-border/50 flex items-center justify-between">
        <span className="text-[10px] font-bold text-muted-foreground">Net Value</span>
        <span
          className={`text-xs font-bold font-mono ${
            netValue > 0 ? "text-emerald-400" : netValue < 0 ? "text-red-400" : "text-muted-foreground"
          }`}
        >
          {netValue >= 0 ? "+" : ""}
          {Math.round(netValue).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

interface TwoWayTradeDetailProps {
  trade: TradeRow;
  assets: TradeAssetRow[];
  valuation: {
    teamAValue: number;
    teamBValue: number;
    winningTeamId: number | null;
    winningTeamName: string | null;
    pctDifference: number;
    absoluteValueGap: number;
    tradeSize: number;
    loserLossPercentage: number;
  };
  seasonAdpMap: Map<string, Map<string, number>>;
  colorClass: string;
  borderClass: string;
  bgClass: string;
  /** Show confidence bar inside the detail (set false if parent already shows it) */
  showConfidence?: boolean;
}

export default function TwoWayTradeDetail({
  trade,
  assets,
  valuation,
  seasonAdpMap,
  colorClass,
  borderClass,
  bgClass,
  showConfidence = true,
}: TwoWayTradeDetailProps) {
  const teamAAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_a_id);
  const teamBAssets = assets.filter((a) => a.trade_id === trade.id && a.from_team_id === trade.team_b_id);

  // Compute sent/received/net for each team
  const teamASent = valuation.teamAValue;
  const teamAReceived = valuation.teamBValue;
  const teamANet = teamAReceived - teamASent;
  const teamBSent = valuation.teamBValue;
  const teamBReceived = valuation.teamAValue;
  const teamBNet = teamBReceived - teamBSent;

  return (
    <div className={`border-t ${borderClass} ${bgClass} px-3 py-3`}>
      {/* Confidence indicator */}
      {showConfidence && trade.confidence && (
        <div className="flex items-center gap-2 mb-3 px-2 py-1.5 bg-muted/30 rounded-lg border border-border/30">
          <span className="text-[10px] font-bold text-muted-foreground">Confidence:</span>
          <ConfidenceTooltip confidence={trade.confidence} reasons={trade.confidence_reasons} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <TeamColumn
          teamName={trade.team_a_name}
          sentAssets={teamAAssets}
          receivedAssets={teamBAssets}
          sentValue={teamASent}
          receivedValue={teamAReceived}
          netValue={teamANet}
          isWinner={valuation.winningTeamId === trade.team_a_id}
          tradeSeason={trade.season}
          seasonAdpMap={seasonAdpMap}
          colorClass={colorClass}
          side="left"
        />
        <TeamColumn
          teamName={trade.team_b_name}
          sentAssets={teamBAssets}
          receivedAssets={teamAAssets}
          sentValue={teamBSent}
          receivedValue={teamBReceived}
          netValue={teamBNet}
          isWinner={valuation.winningTeamId === trade.team_b_id}
          tradeSeason={trade.season}
          seasonAdpMap={seasonAdpMap}
          colorClass={colorClass}
          side="right"
        />
      </div>

      {/* Winner banner */}
      <div className="mt-3 pt-2 border-t border-border/30 text-center space-y-1">
        {valuation.winningTeamName ? (
          <>
            <div className="text-[11px] font-bold">
              {getTeamEmoji(valuation.winningTeamName)}{" "}
              <span className="text-emerald-400">{valuation.winningTeamName}</span>
              <span className="text-muted-foreground"> gets the better deal </span>
              <span className="font-mono text-emerald-400">
                (+{Math.round(valuation.absoluteValueGap).toLocaleString()} net)
              </span>
              <span className="text-muted-foreground ml-1.5">
                · {Math.abs(valuation.pctDifference)}% gap
              </span>
            </div>
            <div className="flex items-center justify-center gap-2">
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
          </>
        ) : (
          <span className="text-[11px] font-bold text-emerald-400">⚖️ Even trade — within 5% value gap</span>
        )}
      </div>
    </div>
  );
}
