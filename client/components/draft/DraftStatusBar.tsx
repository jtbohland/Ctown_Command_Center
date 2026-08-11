import { useMemo } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { getTeamEmoji, type DraftPick, type Team, type Player } from "@/lib/draft-constants";
import seasonXxLogo from "@/public/logos/season-xx.png";

type DraftStatusBarProps = {
  picks: DraftPick[];
  teams: Team[];
  players: Player[];
};

export default function DraftStatusBar({ picks, teams, players }: DraftStatusBarProps) {
  const navigate = useNavigate();
  const currentPick = useMemo(() => {
    return picks.find((p) => !p.is_complete) ?? null;
  }, [picks]);

  const completedCount = useMemo(() => picks.filter((p) => p.is_complete).length, [picks]);
  const totalPicks = picks.length;

  const myTeam = useMemo(() => teams.find((t) => t.is_my_team), [teams]);

  const myUpcomingPicks = useMemo(() => {
    if (!myTeam) return [];
    return picks.filter((p) => !p.is_complete && p.team_id === myTeam.id).slice(0, 5);
  }, [picks, myTeam]);

  const currentTeam = useMemo(() => {
    if (!currentPick) return null;
    return teams.find((t) => t.id === currentPick.team_id) ?? null;
  }, [currentPick, teams]);

  const draftedPlayers = useMemo(() => players.filter((p) => p.is_drafted), [players]);
  const availableCount = players.length - draftedPlayers.length;

  // Draft Grade — total value over ADP for JT's drafted picks
  const draftGrade = useMemo(() => {
    if (!myTeam) return null;
    const myDrafted = players.filter(
      (p) => p.is_drafted && p.drafted_team_id === myTeam.id && !p.is_keeper && p.adp_rank != null && p.drafted_pick != null
    );
    if (myDrafted.length === 0) return null;
    const totalValue = myDrafted.reduce((sum, p) => sum + ((p.adp_rank ?? 0) - (p.drafted_pick ?? 0)), 0);
    return { total: totalValue, picks: myDrafted.length };
  }, [players, myTeam]);

  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-card border-b border-border">
      {/* League branding */}
      <div className="flex items-center gap-2 shrink-0">
        <img
          src={seasonXxLogo}
          alt="C-Town Redux Season XX"
          className="w-9 h-9 rounded-lg object-contain"
        />
        <div>
          <div className="text-sm font-bold leading-none">C-Town Command Center</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Season XX &middot; Est. 2006</div>
        </div>
      </div>

      <div className="w-px h-8 bg-border" />

      {/* On the clock */}
      {currentPick && currentTeam ? (
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <span
              className="w-3 h-3 rounded-full ring-1 ring-white/20 animate-pulse"
              style={{ backgroundColor: currentTeam.color }}
            />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                On The Clock
              </div>
              <div className={cn(
                "text-sm font-bold leading-none",
                currentPick.is_my_team && "text-primary",
              )}>
                {getTeamEmoji(currentTeam.team_name)} {currentTeam.team_name}
                {currentPick.is_my_team && " (YOU)"}
              </div>
            </div>
          </div>
          <span className="text-xs text-muted-foreground font-mono bg-secondary px-1.5 py-0.5 rounded">
            R{currentPick.round}.{String(currentPick.pick_in_round).padStart(2, "0")}
          </span>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">Draft complete!</div>
      )}

      <div className="w-px h-8 bg-border" />

      {/* Progress */}
      <div className="flex items-center gap-2 shrink-0">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Progress</div>
          <div className="text-sm font-semibold font-mono">
            {completedCount}/{totalPicks}
          </div>
        </div>
        <div className="w-20 h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${totalPicks > 0 ? (completedCount / totalPicks) * 100 : 0}%` }}
          />
        </div>
      </div>

      <div className="w-px h-8 bg-border" />

      {/* Available players */}
      <div className="shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Available</div>
        <div className="text-sm font-semibold">{availableCount}</div>
      </div>

      {/* Draft Grade */}
      {draftGrade && (
        <>
          <div className="w-px h-8 bg-border" />
          <div className="shrink-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Draft Grade</div>
            <div className={cn(
              "text-sm font-bold font-mono",
              draftGrade.total > 0 ? "text-green-400" : draftGrade.total < 0 ? "text-red-400" : "text-muted-foreground"
            )}>
              {draftGrade.total > 0 ? "+" : ""}{draftGrade.total}
              <span className="text-[10px] text-muted-foreground font-normal ml-1">({draftGrade.picks}pk)</span>
            </div>
          </div>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* My upcoming picks */}
      {myUpcomingPicks.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Your Next Picks
          </div>
          <div className="flex items-center gap-1">
            {myUpcomingPicks.map((p) => (
              <span
                key={p.id}
                className={cn(
                  "inline-flex items-center rounded-sm px-1.5 py-0.5 text-[10px] font-mono border",
                  p.id === currentPick?.id
                    ? "bg-primary/20 border-primary/40 text-primary font-bold"
                    : "bg-secondary border-border text-muted-foreground",
                )}
              >
                R{p.round}.{String(p.pick_in_round).padStart(2, "0")}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Settings */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => navigate("/settings")}
      >
        <Icon icon="settings" className="h-4 w-4" />
      </Button>
    </div>
  );
}
