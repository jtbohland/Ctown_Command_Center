import { useState, useMemo, memo, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import PositionBadge from "./PositionBadge";
import { getTeamEmoji, type DraftPick } from "@/lib/draft-constants";
import { computeTeamDraftStatus, getPickStatusEmoji } from "@/lib/roster-completion";

type DraftTrackerProps = {
  picks: DraftPick[];
  onUndoPick: (pickId: number) => void;
  currentPickId: number | null;
  /** Keeper positions per team for roster completion tracking */
  teamKeepers?: Map<number, string[]>;
};

const PickRow = memo(function PickRow({
  pick,
  isCurrent,
  onUndo,
  statusEmoji,
}: {
  pick: DraftPick;
  isCurrent: boolean;
  onUndo: (id: number) => void;
  statusEmoji?: string;
}) {
  const handleUndo = useCallback(() => onUndo(pick.id), [pick.id, onUndo]);

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-all",
        isCurrent && !pick.is_complete && "bg-primary/15 border border-primary/40 shadow-[0_0_12px_-3px] shadow-primary/30",
        pick.is_complete && "opacity-80",
        !isCurrent && !pick.is_complete && "opacity-50",
      )}
    >
      {/* Pick number */}
      <span className="text-[10px] font-mono text-muted-foreground w-7 text-right shrink-0">
        {pick.round}.{String(pick.pick_in_round).padStart(2, "0")}
      </span>

      {/* Team color dot */}
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
        style={{ backgroundColor: pick.team_color }}
      />

      {/* Team name */}
      <span
        className={cn(
          "text-xs w-16 truncate shrink-0",
          pick.is_my_team && "font-bold text-primary",
        )}
      >
        {getTeamEmoji(pick.team_name)} {pick.team_name.split(" ")[0]}
      </span>

      {/* Player info or empty */}
      <div className="flex-1 min-w-0">
        {pick.is_complete && pick.player_name ? (
          <div className="flex items-center gap-1.5">
            <PositionBadge position={pick.player_position ?? "?"} className="text-[8px] px-1 py-0" />
            <span className="text-xs font-medium truncate">{pick.player_name}</span>
            <span className="text-[10px] text-muted-foreground shrink-0">{pick.player_nfl_team}</span>
            {pick.is_write_in && (
              <span className="text-[9px] px-1 py-0 rounded bg-amber-600/30 text-amber-400 font-medium" title="Write-in player">
                ✏️
              </span>
            )}
            {statusEmoji && <span className="text-[10px] ml-0.5">{statusEmoji}</span>}
          </div>
        ) : isCurrent ? (
          <span className="text-xs text-primary animate-pulse">On the clock...</span>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </div>

      {/* Undo button */}
      {pick.is_complete && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity"
          onClick={handleUndo}
        >
          <Icon icon="undo-2" className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
});

export default function DraftTracker({ picks, onUndoPick, currentPickId, teamKeepers }: DraftTrackerProps) {
  const [viewRound, setViewRound] = useState<number | "all">("all");

  const rounds = useMemo(() => {
    const r = new Set(picks.map((p) => p.round));
    return Array.from(r).sort((a, b) => a - b);
  }, [picks]);

  const filteredPicks = useMemo(() => {
    if (viewRound === "all") return picks;
    return picks.filter((p) => p.round === viewRound);
  }, [picks, viewRound]);

  const completedCount = useMemo(() => picks.filter((p) => p.is_complete).length, [picks]);

  // Compute roster completion statuses per team
  const pickStatusMap = useMemo(() => {
    if (!teamKeepers) return new Map<number, string>();
    const statusMap = new Map<number, string>(); // pick overall_pick -> emoji
    const teamIds = new Set(picks.map((p) => p.team_id));
    for (const teamId of teamIds) {
      const keeperPos = teamKeepers.get(teamId) ?? [];
      const teamPicks = picks.filter((p) => p.team_id === teamId);
      const draftedInOrder = teamPicks
        .filter((p) => p.is_complete && p.player_position)
        .sort((a, b) => a.overall_pick - b.overall_pick)
        .map((p) => ({ overallPick: p.overall_pick, position: p.player_position! }));
      const totalPicks = teamPicks.length;
      const remaining = teamPicks.filter((p) => !p.is_complete).length;
      const status = computeTeamDraftStatus(keeperPos, draftedInOrder, totalPicks, remaining);
      for (const [pick, ps] of status.pickStatuses) {
        const emoji = getPickStatusEmoji(ps);
        if (emoji) statusMap.set(pick, emoji);
      }
    }
    return statusMap;
  }, [picks, teamKeepers]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Draft Tracker
          </h2>
          <span className="text-xs text-muted-foreground">
            {completedCount}/{picks.length} picks
          </span>
        </div>

        {/* Round tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          <Button
            variant={viewRound === "all" ? "default" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setViewRound("all")}
          >
            All
          </Button>
          {rounds.map((r) => (
            <Button
              key={r}
              variant={viewRound === r ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setViewRound(r)}
            >
              R{r}
            </Button>
          ))}
        </div>
      </div>

      {/* Picks list */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-2 space-y-0.5 group">
          {filteredPicks.map((pick) => (
            <PickRow
              key={pick.id}
              pick={pick}
              isCurrent={pick.id === currentPickId}
              onUndo={onUndoPick}
              statusEmoji={pickStatusMap.get(pick.overall_pick)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
