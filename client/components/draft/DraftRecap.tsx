import { useMemo, memo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import PositionBadge from "./PositionBadge";
import { cn } from "@/lib/utils";
import { getTeamEmoji, type Player, type Team, type DraftPick } from "@/lib/draft-constants";

type DraftRecapProps = {
  players: Player[];
  teams: Team[];
  picks: DraftPick[];
};

type TeamGrade = {
  team: Team;
  picks: { player: Player; pick: DraftPick; value: number }[];
  totalValue: number;
  avgValue: number;
  bestSteal: { player: Player; value: number } | null;
  biggestReach: { player: Player; value: number } | null;
  grade: string;
};

function letterGrade(avgVal: number): string {
  if (avgVal >= 8) return "A+";
  if (avgVal >= 5) return "A";
  if (avgVal >= 2) return "B+";
  if (avgVal >= 0) return "B";
  if (avgVal >= -3) return "C+";
  if (avgVal >= -6) return "C";
  return "D";
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-green-400";
  if (grade.startsWith("B")) return "text-blue-400";
  if (grade.startsWith("C")) return "text-amber-400";
  return "text-red-400";
}

const DraftRecap = memo(function DraftRecap({ players, teams, picks }: DraftRecapProps) {
  const completedPicks = useMemo(
    () => picks.filter((p) => p.is_complete && p.player_id),
    [picks],
  );

  const isDraftComplete = completedPicks.length === picks.length && picks.length > 0;

  const teamGrades = useMemo<TeamGrade[]>(() => {
    return teams.map((team) => {
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

      const bestSteal = teamPicks.length > 0
        ? teamPicks.reduce((best, p) => (p.value > best.value ? p : best))
        : null;
      const biggestReach = teamPicks.length > 0
        ? teamPicks.reduce((worst, p) => (p.value < worst.value ? p : worst))
        : null;

      return {
        team,
        picks: teamPicks,
        totalValue,
        avgValue,
        bestSteal: bestSteal ? { player: bestSteal.player, value: bestSteal.value } : null,
        biggestReach: biggestReach && biggestReach.value < 0
          ? { player: biggestReach.player, value: biggestReach.value }
          : null,
        grade: letterGrade(avgValue),
      };
    }).sort((a, b) => b.totalValue - a.totalValue);
  }, [teams, completedPicks, players]);

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
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {isDraftComplete ? "Final Draft Recap" : "Draft Recap (In Progress)"}
          </h2>
          <span className="text-xs text-muted-foreground">
            {completedPicks.length}/{picks.length} picks made
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {teamGrades.map(({ team, picks: teamPicks, totalValue, grade, bestSteal, biggestReach }) => (
            <div key={team.id} className="rounded-lg border border-border p-3 space-y-2">
              {/* Team header */}
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full ring-1 ring-white/10 shrink-0"
                  style={{ backgroundColor: team.color }}
                />
                <span className="text-sm font-semibold flex-1 truncate">
                  {getTeamEmoji(team.team_name)} {team.team_name}
                  {team.is_my_team && <span className="text-primary ml-1 text-[10px]">(YOU)</span>}
                </span>
                <span className={cn("text-xl font-black", gradeColor(grade))}>
                  {grade}
                </span>
              </div>

              {/* Value summary */}
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>
                  Value:{" "}
                  <span className={cn("font-bold", totalValue > 0 ? "text-green-400" : totalValue < 0 ? "text-red-400" : "")}>
                    {totalValue > 0 ? "+" : ""}{totalValue}
                  </span>
                </span>
                <span>{teamPicks.length} picks</span>
              </div>

              {/* Best steal & biggest reach */}
              {bestSteal && bestSteal.value > 0 && (
                <div className="text-[10px]">
                  <span className="text-green-400 font-semibold">Best steal:</span>{" "}
                  <span className="text-foreground">{bestSteal.player.name}</span>{" "}
                  <span className="text-green-400/70">(+{bestSteal.value})</span>
                </div>
              )}
              {biggestReach && (
                <div className="text-[10px]">
                  <span className="text-red-400 font-semibold">Biggest reach:</span>{" "}
                  <span className="text-foreground">{biggestReach.player.name}</span>{" "}
                  <span className="text-red-400/70">({biggestReach.value})</span>
                </div>
              )}

              {/* Picks list */}
              <div className="space-y-0.5 pt-1 border-t border-border/50">
                {teamPicks.map(({ player, pick, value }) => (
                  <div key={pick.id} className="flex items-center gap-1.5 text-[11px]">
                    <span className="text-muted-foreground font-mono w-8 text-right shrink-0">
                      {pick.round}.{String(pick.pick_in_round).padStart(2, "0")}
                    </span>
                    <PositionBadge position={player.position} />
                    <span className="flex-1 truncate">{player.name}</span>
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
            </div>
          ))}
        </div>
      </div>
    </ScrollArea>
  );
});

export default DraftRecap;
