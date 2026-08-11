import { useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import PositionBadge from "./PositionBadge";
import type { Player, Team, DraftPick } from "@/lib/draft-constants";
import { POSITION_BG_CLASSES } from "@/lib/draft-constants";
import crabcakesLogo from "@/public/logos/crabcakes-football.png";

type MyRosterProps = {
  players: Player[];
  myTeam: Team | undefined;
  picks: DraftPick[];
};

export default function MyRoster({ players, myTeam, picks }: MyRosterProps) {
  const myPlayers = useMemo(() => {
    if (!myTeam) return [];
    return players.filter((p) => p.is_drafted && p.drafted_team_id === myTeam.id);
  }, [players, myTeam]);

  const myPicks = useMemo(() => {
    if (!myTeam) return [];
    return picks.filter((p) => p.team_id === myTeam.id);
  }, [picks, myTeam]);

  const remainingPicks = useMemo(() => {
    return myPicks.filter((p) => !p.is_complete);
  }, [myPicks]);

  const grouped = useMemo(() => {
    const groups: Record<string, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
    for (const p of myPlayers) {
      if (groups[p.position]) {
        groups[p.position].push(p);
      }
    }
    return groups;
  }, [myPlayers]);

  if (!myTeam) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <img src={crabcakesLogo} alt="Crabcakes & Football" className="w-7 h-7 object-contain" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            My Roster
          </h2>
        </div>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          <span>{myPlayers.length} drafted</span>
          <span className="opacity-40">•</span>
          <span>{remainingPicks.length} picks left</span>
        </div>
        {remainingPicks.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {remainingPicks.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center rounded-sm bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] text-primary font-mono"
              >
                R{p.round}.{String(p.pick_in_round).padStart(2, "0")}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Roster by position */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-3 space-y-3">
          {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
            <div key={pos}>
              <div className="flex items-center gap-2 mb-1">
                <PositionBadge position={pos} />
                <span className="text-[10px] text-muted-foreground">
                  {grouped[pos]?.length ?? 0} rostered
                </span>
              </div>
              <div className="space-y-0.5">
                {(grouped[pos] ?? []).length === 0 ? (
                  <div className="text-[11px] text-muted-foreground/40 pl-2 py-1">
                    No {pos}s drafted yet
                  </div>
                ) : (
                  (grouped[pos] ?? []).map((p) => (
                    <div
                      key={p.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1 rounded-sm text-xs",
                        p.is_keeper && "bg-primary/10 border border-primary/20",
                      )}
                    >
                      <span className="font-medium flex-1 truncate">{p.name}</span>
                      <span className="text-muted-foreground text-[10px]">{p.nfl_team}</span>
                      {p.is_keeper && (
                        <span className="text-[9px] font-bold text-primary uppercase tracking-wider">K</span>
                      )}
                      {p.drafted_round && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          R{p.drafted_round}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
