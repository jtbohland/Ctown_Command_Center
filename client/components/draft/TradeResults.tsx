import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import { SEVERITY_COLORS, type VerdictSeverity } from "@/lib/trade-utils";

interface ValuationItem {
  name: string;
  value: number;
  adpUsed: number | null;
  valueStatus?: "resolved" | "unresolved";
  dynastyFactors?: string[];
}

interface SideResult {
  assets: ValuationItem[];
  totalValue: number;
  hasUnresolved?: boolean;
  unresolvedReasons?: string[];
}

interface DejaVuAsset {
  assetType: string;
  playerName: string | null;
  playerPosition: string | null;
  playerAdpAtTrade: number | null;
  pickYear: number | null;
  pickRound: number | null;
  pickNumber: number | null;
  fromTeamId: number;
  fromTeamName: string;
}

interface DejaVuMatch {
  tradeNumber: number;
  season: string;
  tradeDate: string | null;
  teamA: string;
  teamB: string;
  similarity: number;
  summary: string;
  assets: DejaVuAsset[];
  verdict: { label: string; emoji: string; severity: string } | null;
  winnerName: string | null;
}

interface EvalResult {
  teamASide: SideResult;
  teamBSide: SideResult;
  pctDifference: number;
  winningTeamId: number | null;
  verdict: { label: string; emoji: string; severity: string };
  verdictStatus?: "definitive" | "incomplete";
  dejaVu: DejaVuMatch[];
}

interface Props {
  result: EvalResult;
  teamAName: string;
  teamBName: string;
  teamAColor?: string;
  teamBColor?: string;
}

export default function TradeResults({ result, teamAName, teamBName, teamAColor, teamBColor }: Props) {
  const { teamASide, teamBSide, pctDifference, verdict, dejaVu } = result;
  const maxValue = Math.max(teamASide.totalValue, teamBSide.totalValue, 1);
  const teamAProgress = (teamASide.totalValue / maxValue) * 100;
  const teamBProgress = (teamBSide.totalValue / maxValue) * 100;

  const isIncomplete = result.verdictStatus === "incomplete";
  const severity = (isIncomplete ? "fair" : verdict.severity) as VerdictSeverity;
  const colors = isIncomplete
    ? { bg: "bg-yellow-500/10", border: "border-yellow-500/30", text: "text-yellow-400", badge: "" }
    : (SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.fair);
  const absDiff = Math.abs(pctDifference);
  // Spec §5: pctDiff = (teamBSent - teamASent) / avg
  // Positive → Team B sent more → Team A received more → Team A wins
  const winnerName = !isIncomplete && pctDifference > 0 ? teamAName : !isIncomplete && pctDifference < 0 ? teamBName : null;

  // Collect all unresolved reasons from both sides
  const unresolvedReasons = [
    ...(teamASide.unresolvedReasons ?? []),
    ...(teamBSide.unresolvedReasons ?? []),
  ];

  return (
    <div className="space-y-4 mt-4">
      {/* Verdict Banner — big and bold */}
      <div className={`rounded-xl border-2 ${colors.border} ${colors.bg} p-5 text-center relative overflow-hidden`}>
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent" />
        <div className="relative">
          <div className="text-4xl mb-2">{verdict.emoji}</div>
          <div className={`font-extrabold text-2xl ${colors.text}`}>{verdict.label}</div>
          {isIncomplete && (
            <div className="text-sm mt-2 text-yellow-300/80">
              One or more assets could not be valued — verdict is not definitive.
            </div>
          )}
          {!isIncomplete && absDiff > 5 && winnerName && (
            <div className="text-sm mt-2 opacity-90">
              {getTeamEmoji(winnerName)} <span className="font-semibold">{winnerName}</span>{" "}
              <span className="text-muted-foreground">winner under this model</span> by{" "}
              <span className="font-mono font-bold text-lg">{absDiff}%</span>
            </div>
          )}
          {!isIncomplete && absDiff <= 5 && (
            <div className="text-sm mt-2 opacity-70">Fair within configured tolerance (±5%) — solid deal for everyone! 🤝</div>
          )}
        </div>
      </div>

      {/* Value Comparison — side by side with team colors */}
      <div className="grid grid-cols-2 gap-4">
        <ValueColumn
          teamName={teamAName}
          label="receives (inferred)"
          side={teamBSide}
          progress={teamBProgress}
          accentColor={teamAColor ?? "#3b82f6"}
          gradientClass="from-blue-600/10"
          isWinner={pctDifference > 5}
        />
        <ValueColumn
          teamName={teamBName}
          label="receives (inferred)"
          side={teamASide}
          progress={teamAProgress}
          accentColor={teamBColor ?? "#ef4444"}
          gradientClass="from-red-600/10"
          isWinner={pctDifference < -5}
        />
      </div>

      {/* ⚠️ Unresolved Assets Warning */}
      {unresolvedReasons.length > 0 && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <h4 className="text-sm font-bold mb-2 flex items-center gap-1.5 text-yellow-400">
            <span className="text-base">⚠️</span> Unresolved Assets
          </h4>
          <ul className="space-y-1">
            {unresolvedReasons.map((reason, i) => (
              <li key={i} className="text-xs text-yellow-300/70 flex items-start gap-1.5">
                <span className="mt-0.5">•</span>
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted-foreground mt-2">
            Resolve these to get a definitive verdict.
          </p>
        </div>
      )}

      {/* 📡 Deal Déjà Vu */}
      {dejaVu.length > 0 && (
        <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
          <h4 className="text-sm font-bold mb-3 flex items-center gap-1.5 text-purple-400">
            <span className="text-base">📡</span> Deal Déjà Vu
          </h4>
          <div className="space-y-2">
            {dejaVu.map((match, i) => (
              <DejaVuCard key={i} match={match} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Déjà Vu Expandable Card ────────────────────────────────
function DejaVuCard({ match }: { match: DejaVuMatch }) {
  const [expanded, setExpanded] = useState(false);

  // Group assets by the sending team
  const teamAAssets = match.assets.filter((a) => a.fromTeamName === match.teamA);
  const teamBAssets = match.assets.filter((a) => a.fromTeamName !== match.teamA);

  const verdictColors = match.verdict
    ? (SEVERITY_COLORS[match.verdict.severity as VerdictSeverity] ?? SEVERITY_COLORS.fair)
    : null;

  return (
    <div
      className={`text-xs rounded-lg border transition-all cursor-pointer ${
        expanded
          ? "bg-purple-500/15 border-purple-500/40"
          : "bg-purple-500/10 border-purple-500/20 hover:border-purple-500/35 hover:bg-purple-500/15"
      }`}
      onClick={() => setExpanded((prev) => !prev)}
    >
      {/* Header — always visible */}
      <div className="p-3 flex items-center gap-2">
        <span className={`text-[10px] transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-purple-300 truncate">{match.summary}</div>
          <div className="text-muted-foreground mt-0.5">
            {getTeamEmoji(match.teamA)} {match.teamA} ↔ {getTeamEmoji(match.teamB)} {match.teamB}
            {match.tradeDate && <span className="ml-1.5">• {match.tradeDate}</span>}
            {!match.tradeDate && <span className="ml-1.5">• {match.season}</span>}
          </div>
        </div>
        {match.verdict && (
          <Badge variant="outline" className={`text-[9px] shrink-0 ${verdictColors?.border ?? ""} ${verdictColors?.text ?? ""}`}>
            {match.verdict.emoji} {match.verdict.label}
          </Badge>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-purple-500/20 pt-3" onClick={(e) => e.stopPropagation()}>
          {/* Trade breakdown */}
          <div className="grid grid-cols-2 gap-3">
            <DejaVuSide teamName={match.teamA} assets={teamAAssets} />
            <DejaVuSide teamName={match.teamB} assets={teamBAssets} />
          </div>

          {/* Verdict summary */}
          {match.verdict && (
            <div className={`rounded-lg p-2.5 text-center ${verdictColors?.bg ?? "bg-muted/20"} border ${verdictColors?.border ?? "border-border/30"}`}>
              <span className="text-sm">{match.verdict.emoji}</span>{" "}
              <span className={`font-bold ${verdictColors?.text ?? ""}`}>{match.verdict.label}</span>
              {match.winnerName && (
                <span className="text-muted-foreground ml-1.5">
                  — {getTeamEmoji(match.winnerName)} {match.winnerName} won this deal
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DejaVuSide({ teamName, assets }: { teamName: string; assets: DejaVuAsset[] }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
        {getTeamEmoji(teamName)} {teamName} traded away
      </div>
      {assets.length === 0 && (
        <div className="text-[10px] text-muted-foreground italic">No assets recorded</div>
      )}
      {assets.map((a, i) => (
        <div key={i} className="flex items-center gap-1.5 bg-background/40 rounded px-2 py-1">
          {a.assetType === "player" ? (
            <Badge className={`text-[8px] px-1 py-0 shrink-0 ${POSITION_BG_CLASSES[a.playerPosition ?? ""] ?? "bg-muted"}`}>
              {a.playerPosition ?? "?"}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[8px] px-1 py-0 shrink-0 bg-amber-500/10 border-amber-500/30 text-amber-400">
              Pick
            </Badge>
          )}
          <span className="flex-1 truncate font-medium">
            {a.assetType === "player"
              ? a.playerName
              : a.pickNumber
                ? `${a.pickYear} Rd ${a.pickRound} (#${a.pickNumber})`
                : `${a.pickYear} Rd ${a.pickRound}`}
          </span>
          {a.assetType === "player" && a.playerAdpAtTrade && (
            <span className="text-[9px] text-muted-foreground shrink-0">ADP {a.playerAdpAtTrade}</span>
          )}
        </div>
      ))}
    </div>
  );
}


function ValueColumn({
  teamName,
  label,
  side,
  progress,
  accentColor,
  gradientClass,
  isWinner,
}: {
  teamName: string;
  label: string;
  side: SideResult;
  progress: number;
  accentColor: string;
  gradientClass: string;
  isWinner: boolean;
}) {
  return (
    <div
      className={`rounded-xl border bg-gradient-to-b ${gradientClass} to-transparent p-4 space-y-2 ${isWinner ? "border-emerald-500/50 ring-1 ring-emerald-500/20" : "border-border"}`}
      style={{ borderTopColor: accentColor, borderTopWidth: 3 }}
    >
      <div className="text-xs text-muted-foreground">
        {getTeamEmoji(teamName)} <span className="font-semibold text-foreground">{teamName}</span> {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-extrabold font-mono">{Math.round(side.totalValue).toLocaleString()}</span>
        <span className="text-xs text-muted-foreground">value received</span>
        {isWinner && <span className="text-emerald-400 text-sm ml-auto">✅ Winner</span>}
      </div>
      <Progress value={progress} className="h-2.5 rounded-full" />
      <div className="space-y-1 pt-1">
        {side.assets.map((asset, i) => (
          <div key={i} className="flex items-center justify-between text-xs bg-background/40 rounded px-2 py-1">
            <span className={`truncate flex-1 font-medium ${asset.valueStatus === "unresolved" ? "text-yellow-400" : ""}`}>{asset.name}</span>
            <Badge
              variant="secondary"
              className={`ml-1 text-[10px] font-mono px-1.5 font-bold ${
                asset.valueStatus === "unresolved" ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" : ""
              }`}
            >
              {asset.valueStatus === "unresolved" ? "?" : Math.round(asset.value).toLocaleString()}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
