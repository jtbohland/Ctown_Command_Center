import { useMemo, memo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import PositionBadge from "./PositionBadge";
import { getTeamEmoji, type Player, type Team } from "@/lib/draft-constants";
import { STARTING_SLOTS } from "@/lib/draft-constants";
import { cn } from "@/lib/utils";

type RivalNeedTrackerProps = {
  players: Player[];
  teams: Team[];
};

type TeamNeed = {
  team: Team;
  filledSlots: Record<string, number>;
  needs: { slot: string; positions: string[]; filled: boolean }[];
  needCount: number;
};

function computeTeamNeeds(team: Team, players: Player[]): TeamNeed {
  const roster = players.filter(
    (p) => p.is_drafted && (p.drafted_team_id === team.id || p.keeper_team_id === team.id)
  );

  // Count rostered players by position
  const posCounts: Record<string, number> = {};
  for (const p of roster) {
    posCounts[p.position] = (posCounts[p.position] ?? 0) + 1;
  }

  // Walk through starting slots and fill them greedily
  const available = { ...posCounts };
  const needs: TeamNeed["needs"] = [];

  for (const slot of STARTING_SLOTS) {
    // Try to fill this slot with an available player
    let filled = false;
    for (const pos of slot.positions) {
      if ((available[pos] ?? 0) > 0) {
        available[pos]!--;
        filled = true;
        break;
      }
    }
    needs.push({
      slot: slot.label,
      positions: [...slot.positions],
      filled,
    });
  }

  return {
    team,
    filledSlots: posCounts,
    needs,
    needCount: needs.filter((n) => !n.filled).length,
  };
}

const RivalNeedTracker = memo(function RivalNeedTracker({ players, teams }: RivalNeedTrackerProps) {
  const teamNeeds = useMemo(() => {
    return teams
      .filter((t) => !t.is_my_team)
      .map((t) => computeTeamNeeds(t, players))
      .sort((a, b) => b.needCount - a.needCount);
  }, [teams, players]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 border-b border-border">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Rival Needs
        </h2>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          Unfilled starting slots by team
        </p>
      </div>
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-2 space-y-1.5">
          {teamNeeds.map(({ team, needs, needCount }) => (
            <div
              key={team.id}
              className="rounded-lg border border-border px-3 py-2 hover:bg-accent/30 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full ring-1 ring-white/10 shrink-0"
                  style={{ backgroundColor: team.color }}
                />
                <span className="text-xs font-semibold truncate flex-1">{getTeamEmoji(team.team_name)} {team.team_name}</span>
                <span
                  className={cn(
                    "text-[10px] font-bold tabular-nums",
                    needCount === 0 ? "text-green-400" : needCount >= 4 ? "text-red-400" : "text-amber-400",
                  )}
                >
                  {needCount === 0 ? "Full" : `${needCount} need${needCount > 1 ? "s" : ""}`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {needs.map((need, i) => (
                  <span
                    key={i}
                    className={cn(
                      "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[9px] font-medium border",
                      need.filled
                        ? "bg-green-500/10 border-green-500/20 text-green-400/80"
                        : "bg-red-500/15 border-red-500/30 text-red-400 font-bold",
                    )}
                  >
                    {need.slot}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
});

export default RivalNeedTracker;
