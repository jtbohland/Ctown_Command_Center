import { useMemo, useState, useCallback, memo } from "react";
import { useApi } from "@/hooks/useApi";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import PositionBadge from "./PositionBadge";
import { cn } from "@/lib/utils";
import { getTeamEmoji, type Player, type Team, type DraftPick } from "@/lib/draft-constants";

// ─── Types ──────────────────────────────────────────────────
type DraftRecapProps = {
  players: Player[];
  teams: Team[];
  picks: DraftPick[];
};

type TeamGrade = {
  team: Team;
  rank: number;
  picks: { player: Player; pick: DraftPick; value: number }[];
  totalValue: number;
  avgValue: number;
  stealCount: number;
  reachCount: number;
  bestSteal: { player: Player; value: number; pick: DraftPick } | null;
  biggestReach: { player: Player; value: number; pick: DraftPick } | null;
  posCounts: Record<string, number>;
  grade: string;
};

// ─── Relative Grading ───────────────────────────────────────
// Grades are rank-based: assigned relative to the field of 11 teams.
function gradeFromRank(rank: number, total: number): string {
  const pct = (rank - 1) / Math.max(total - 1, 1); // 0 = best, 1 = worst
  if (pct <= 0.09) return "A+";
  if (pct <= 0.18) return "A";
  if (pct <= 0.27) return "A-";
  if (pct <= 0.36) return "B+";
  if (pct <= 0.50) return "B";
  if (pct <= 0.63) return "B-";
  if (pct <= 0.72) return "C+";
  if (pct <= 0.81) return "C";
  if (pct <= 0.90) return "D";
  return "F";
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-green-400";
  if (grade.startsWith("B")) return "text-blue-400";
  if (grade.startsWith("C")) return "text-amber-400";
  if (grade === "D") return "text-orange-400";
  return "text-red-400";
}

function gradeBg(grade: string): string {
  if (grade.startsWith("A")) return "bg-green-500/10 border-green-500/20";
  if (grade.startsWith("B")) return "bg-blue-500/10 border-blue-500/20";
  if (grade.startsWith("C")) return "bg-amber-500/10 border-amber-500/20";
  if (grade === "D") return "bg-orange-500/10 border-orange-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function rankMedal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

// ─── Team Card ──────────────────────────────────────────────
const TeamRecapCard = memo(function TeamRecapCard({
  tg,
  aiSummary,
  leagueAvg,
}: {
  tg: TeamGrade;
  aiSummary: string | null;
  leagueAvg: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", gradeBg(tg.grade))}>
      {/* Header: rank + name + grade */}
      <div className="flex items-center gap-2">
        <span className="text-lg font-black min-w-[36px] text-center">
          {rankMedal(tg.rank)}
        </span>
        <span
          className="w-3 h-3 rounded-full ring-1 ring-white/10 shrink-0"
          style={{ backgroundColor: tg.team.color }}
        />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold truncate block">
            {getTeamEmoji(tg.team.team_name)} {tg.team.team_name}
            {tg.team.is_my_team && <span className="text-primary ml-1 text-[10px]">(YOU)</span>}
          </span>
          <span className="text-[10px] text-muted-foreground">{tg.team.manager_name}</span>
        </div>
        <span className={cn("text-2xl font-black", gradeColor(tg.grade))}>
          {tg.grade}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
        <span>
          Total Value:{" "}
          <span className={cn("font-bold", tg.totalValue > 0 ? "text-green-400" : tg.totalValue < 0 ? "text-red-400" : "")}>
            {tg.totalValue > 0 ? "+" : ""}{tg.totalValue}
          </span>
        </span>
        <span>
          Avg/pick:{" "}
          <span className={cn("font-bold", tg.avgValue > leagueAvg ? "text-green-400" : tg.avgValue < leagueAvg ? "text-red-400" : "")}>
            {tg.avgValue > 0 ? "+" : ""}{tg.avgValue.toFixed(1)}
          </span>
        </span>
        <span className="text-green-400 font-semibold">
          {tg.stealCount} steal{tg.stealCount !== 1 ? "s" : ""}
        </span>
        <span className="text-red-400 font-semibold">
          {tg.reachCount} reach{tg.reachCount !== 1 ? "es" : ""}
        </span>
        <span>{tg.picks.length} picks</span>
      </div>

      {/* Position breakdown */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {Object.entries(tg.posCounts)
          .sort(([a], [b]) => {
            const order = ["QB", "RB", "WR", "TE", "K", "DST"];
            return order.indexOf(a) - order.indexOf(b);
          })
          .map(([pos, count]) => (
            <span key={pos} className="flex items-center gap-0.5">
              <PositionBadge position={pos} />
              <span className="text-[10px] text-muted-foreground font-mono">×{count}</span>
            </span>
          ))}
      </div>

      {/* Best Steal & Biggest Reach */}
      <div className="space-y-0.5">
        {tg.bestSteal && tg.bestSteal.value > 0 && (
          <div className="text-[10px]">
            <span className="text-green-400 font-semibold">🎯 Best steal:</span>{" "}
            <span className="text-foreground">{tg.bestSteal.player.name}</span>{" "}
            <span className="text-muted-foreground">
              (Rd {tg.bestSteal.pick.round}.{String(tg.bestSteal.pick.pick_in_round).padStart(2, "0")}, ADP {tg.bestSteal.player.adp_rank ?? "N/A"})
            </span>{" "}
            <span className="text-green-400 font-bold">+{tg.bestSteal.value}</span>
          </div>
        )}
        {tg.biggestReach && (
          <div className="text-[10px]">
            <span className="text-red-400 font-semibold">📉 Biggest reach:</span>{" "}
            <span className="text-foreground">{tg.biggestReach.player.name}</span>{" "}
            <span className="text-muted-foreground">
              (Rd {tg.biggestReach.pick.round}.{String(tg.biggestReach.pick.pick_in_round).padStart(2, "0")}, ADP {tg.biggestReach.player.adp_rank ?? "N/A"})
            </span>{" "}
            <span className="text-red-400 font-bold">{tg.biggestReach.value}</span>
          </div>
        )}
      </div>

      {/* AI Summary */}
      {aiSummary && (
        <div className="text-[11px] text-muted-foreground/90 leading-relaxed italic border-l-2 border-primary/30 pl-2 mt-1">
          {aiSummary}
        </div>
      )}

      {/* Expand/collapse picks list */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary transition-colors cursor-pointer"
      >
        <Icon icon={expanded ? "chevron-up" : "chevron-down"} className="h-3 w-3" />
        {expanded ? "Hide" : "Show"} all picks
      </button>

      {expanded && (
        <div className="space-y-0.5 pt-1 border-t border-border/50">
          {tg.picks.map(({ player, pick, value }) => (
            <div key={pick.id} className="flex items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground font-mono w-8 text-right shrink-0">
                {pick.round}.{String(pick.pick_in_round).padStart(2, "0")}
              </span>
              <PositionBadge position={player.position} />
              <span className="flex-1 truncate">{player.name}</span>
              <span className="text-[10px] text-muted-foreground">ADP {player.adp_rank ?? "—"}</span>
              <span
                className={cn(
                  "text-[10px] font-mono font-bold shrink-0",
                  value > 0 ? "text-green-400" : value < 0 ? "text-red-400" : "text-muted-foreground",
                )}
              >
                {value > 0 ? "+" : ""}{value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────
const DraftRecap = memo(function DraftRecap({ players, teams, picks }: DraftRecapProps) {
  const { run: generateRecap, loading: aiLoading, data: aiData } = useApi("GenerateDraftRecap");
  const [aiRequested, setAiRequested] = useState(false);

  const completedPicks = useMemo(
    () => picks.filter((p) => p.is_complete && p.player_id),
    [picks],
  );

  const isDraftComplete = completedPicks.length === picks.length && picks.length > 0;

  const { teamGrades, leagueAvg } = useMemo(() => {
    const raw = teams.map((team) => {
      const teamPicks = completedPicks
        .filter((p) => p.team_id === team.id)
        .map((pick) => {
          const player = players.find((pl) => pl.id === pick.player_id);
          if (!player) return null;
          const value = (player.adp_rank ?? pick.overall_pick) - pick.overall_pick;
          return { player, pick, value };
        })
        .filter(Boolean) as TeamGrade["picks"];

      const totalValue = teamPicks.reduce((sum, p) => sum + p.value, 0);
      const avgValue = teamPicks.length > 0 ? totalValue / teamPicks.length : 0;
      const stealCount = teamPicks.filter((p) => p.value >= 10).length;
      const reachCount = teamPicks.filter((p) => p.value <= -10).length;

      const bestSteal = teamPicks.length > 0
        ? teamPicks.reduce((best, p) => (p.value > best.value ? p : best))
        : null;
      const biggestReach = teamPicks.length > 0
        ? teamPicks.reduce((worst, p) => (p.value < worst.value ? p : worst))
        : null;

      const posCounts: Record<string, number> = {};
      for (const tp of teamPicks) {
        posCounts[tp.player.position] = (posCounts[tp.player.position] ?? 0) + 1;
      }

      return {
        team,
        picks: teamPicks,
        totalValue,
        avgValue,
        stealCount,
        reachCount,
        bestSteal: bestSteal ? { player: bestSteal.player, value: bestSteal.value, pick: bestSteal.pick } : null,
        biggestReach: biggestReach && biggestReach.value < 0
          ? { player: biggestReach.player, value: biggestReach.value, pick: biggestReach.pick }
          : null,
        posCounts,
        grade: "", // filled after ranking
        rank: 0,
      };
    }).sort((a, b) => b.totalValue - a.totalValue);

    // Assign ranks and grades
    const total = raw.length;
    const leagueTotal = raw.reduce((s, t) => s + t.avgValue, 0);
    const avg = total > 0 ? leagueTotal / total : 0;

    const grades: TeamGrade[] = raw.map((t, i) => ({
      ...t,
      rank: i + 1,
      grade: gradeFromRank(i + 1, total),
    }));

    return { teamGrades: grades, leagueAvg: avg };
  }, [teams, completedPicks, players]);

  // Build AI summary map
  const aiSummaryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (aiData?.summaries) {
      for (const s of aiData.summaries) {
        map.set(s.teamName, s.summary);
      }
    }
    return map;
  }, [aiData]);

  const handleGenerateAI = useCallback(async () => {
    setAiRequested(true);
    try {
      await generateRecap({
        leagueAvgValue: leagueAvg,
        teams: teamGrades.map((tg) => ({
          teamName: tg.team.team_name,
          managerName: tg.team.manager_name ?? "",
          rank: tg.rank,
          grade: tg.grade,
          totalValue: tg.totalValue,
          avgValue: tg.avgValue,
          stealCount: tg.stealCount,
          reachCount: tg.reachCount,
          picks: tg.picks.map((p) => ({
            playerName: p.player.name,
            position: p.player.position,
            round: p.pick.round,
            pickInRound: p.pick.pick_in_round,
            overallPick: p.pick.overall_pick,
            adpRank: p.player.adp_rank,
            value: p.value,
          })),
        })),
      });
    } catch {
      // error is available via the hook
    }
  }, [generateRecap, teamGrades, leagueAvg]);

  if (completedPicks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <span className="text-4xl">📋</span>
        <p className="text-sm">Draft recap will appear here once picks are made</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold">
              {isDraftComplete ? "🏆 Final Draft Recap" : "📊 Draft Recap (In Progress)"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {completedPicks.length}/{picks.length} picks • Ranked best to worst • League avg value/pick:{" "}
              <span className={cn("font-bold", leagueAvg > 0 ? "text-green-400" : leagueAvg < 0 ? "text-red-400" : "")}>
                {leagueAvg > 0 ? "+" : ""}{leagueAvg.toFixed(1)}
              </span>
            </span>
          </div>
          {isDraftComplete && !aiRequested && (
            <Button size="sm" variant="outline" onClick={handleGenerateAI} disabled={aiLoading} className="gap-1.5">
              <Icon icon="sparkles" className="h-3.5 w-3.5" />
              Generate AI Summaries
            </Button>
          )}
          {aiLoading && (
            <span className="text-xs text-muted-foreground animate-pulse">
              ✨ Gemini is analyzing the draft...
            </span>
          )}
        </div>

        {/* Legend */}
        <div className="rounded-lg border border-border/50 bg-card/50 p-3 text-[11px] text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground text-xs">How to read this</p>
          <p>
            <strong>Value</strong> = Player's ADP rank − the overall pick# they were drafted at.
            <span className="text-green-400"> Positive = steal</span> (picked later than ADP says).
            <span className="text-red-400"> Negative = reach</span> (picked earlier than ADP).
          </p>
          <p>
            <strong>Total Value</strong> = sum of all pick values for a team.
            <strong> Grades</strong> are curved — the team with the most total value gets the top grade, ranked against all {teams.length} teams.
          </p>
          <p>
            <strong>Steal</strong> = value ≥ +10 | <strong>Reach</strong> = value ≤ −10. Players without ADP data are treated as neutral (value = 0).
          </p>
        </div>

        {/* Team Cards */}
        <div className="space-y-3">
          {teamGrades.map((tg) => (
            <TeamRecapCard
              key={tg.team.id}
              tg={tg}
              aiSummary={aiSummaryMap.get(tg.team.team_name) ?? null}
              leagueAvg={leagueAvg}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
});

export default DraftRecap;
