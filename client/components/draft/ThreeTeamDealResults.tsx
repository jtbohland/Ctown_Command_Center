import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getTeamEmoji } from "@/lib/draft-constants";
import { SEVERITY_COLORS, type VerdictSeverity, type TeamValuationResult } from "@/lib/trade-utils";
import type { ThreeTeamDealResult } from "./TradeBuilder";

interface Props {
  result: ThreeTeamDealResult;
}

const RANK_LABELS = ["🥇", "🥈", "🥉"];
const RANK_COLORS = [
  "border-emerald-500/50 ring-1 ring-emerald-500/20",
  "border-amber-500/30",
  "border-red-500/30",
];

export default function ThreeTeamDealResults({ result }: Props) {
  const { teams, winner, verdict, winnerMarginOverSecond } = result;
  const severity = (verdict.severity ?? "fair") as VerdictSeverity;
  const colors = SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.fair;
  const maxReceived = Math.max(...teams.map((t) => t.receivedValue), 1);

  return (
    <div className="space-y-4 mt-4">
      {/* Verdict Banner */}
      <div className={`rounded-xl border-2 ${colors.border} ${colors.bg} p-5 text-center relative overflow-hidden`}>
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
        <div className="relative">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Badge className="text-[10px] px-2 py-0.5 bg-purple-500/20 text-purple-400 border-purple-500/30 border">
              🎰 3-WAY TRADE
            </Badge>
          </div>
          <div className="text-4xl mb-2">{verdict.emoji}</div>
          <div className={`font-extrabold text-2xl ${colors.text}`}>{verdict.label}</div>
          <div className="text-sm mt-2 opacity-90">
            {getTeamEmoji(winner.teamName)}{" "}
            <span className="font-semibold">{winner.teamName}</span>{" "}
            <span className="text-muted-foreground">gets the best deal</span>{" "}
            <span className="font-mono font-bold text-lg text-emerald-400">
              +{Math.round(winner.netValue).toLocaleString()}
            </span>{" "}
            <span className="text-muted-foreground">net value</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Margin over 2nd: +{Math.round(winnerMarginOverSecond).toLocaleString()} pts
          </div>
        </div>
      </div>

      {/* Three Team Value Cards */}
      <div className="grid grid-cols-3 gap-3">
        {teams.map((team) => {
          const teamColor = result.teamColors[team.teamId] ?? "#6b7280";
          const progress = (team.receivedValue / maxReceived) * 100;
          return (
            <TeamValueCard
              key={team.teamId}
              team={team}
              progress={progress}
              teamColor={teamColor}
              isWinner={team.rank === 1}
            />
          );
        })}
      </div>

      {/* Asset Flow Summary */}
      <div className="rounded-xl border border-border/50 bg-muted/10 p-4">
        <h4 className="text-xs font-bold text-muted-foreground mb-3 flex items-center gap-1.5">
          <span>📦</span> Asset Flow
        </h4>
        <div className="space-y-1">
          {result.assetDetails.map((ad, i) => {
            const fromName = result.sideNames[ad.fromSide] ?? ad.fromSide;
            const toName = result.sideNames[ad.toSide] ?? ad.toSide;
            return (
              <div key={i} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-background/40">
                <span className="font-medium truncate flex-1">{ad.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  ({Math.round(ad.value).toLocaleString()})
                </span>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {getTeamEmoji(fromName)} → {getTeamEmoji(toName)} {toName}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TeamValueCard({
  team,
  progress,
  teamColor,
  isWinner,
}: {
  team: TeamValuationResult;
  progress: number;
  teamColor: string;
  isWinner: boolean;
}) {
  const rankIdx = team.rank - 1;
  return (
    <div
      className={`rounded-xl border p-4 space-y-2 ${RANK_COLORS[rankIdx] ?? "border-border"} ${
        isWinner ? "bg-emerald-500/5" : "bg-card/30"
      }`}
      style={{ borderTopColor: teamColor, borderTopWidth: 3 }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <span className="text-base">{RANK_LABELS[rankIdx]}</span>
        <span className="text-sm">{getTeamEmoji(team.teamName)}</span>
        <span className="text-xs font-bold truncate">{team.teamName}</span>
        {isWinner && (
          <Badge className="text-[8px] px-1 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30 border ml-auto shrink-0">
            👑 WINNER
          </Badge>
        )}
      </div>

      {/* Value bars */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-muted-foreground">Sent</span>
          <span className="text-xs font-mono font-bold text-red-400">
            −{Math.round(team.sentValue).toLocaleString()}
          </span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-muted-foreground">Received</span>
          <span className="text-xs font-mono font-bold text-emerald-400">
            +{Math.round(team.receivedValue).toLocaleString()}
          </span>
        </div>
        <Progress value={progress} className="h-2 rounded-full" />
      </div>

      {/* Net value — big number */}
      <div className="pt-1.5 border-t border-border/30 text-center">
        <div className="text-[10px] text-muted-foreground mb-0.5">Net Value</div>
        <div
          className={`text-xl font-extrabold font-mono ${
            team.netValue > 0
              ? "text-emerald-400"
              : team.netValue < 0
                ? "text-red-400"
                : "text-muted-foreground"
          }`}
        >
          {team.netValue >= 0 ? "+" : ""}
          {Math.round(team.netValue).toLocaleString()}
        </div>
      </div>
    </div>
  );
}
