import { useMemo, memo } from "react";
import { cn } from "@/lib/utils";
import { getTeamEmoji, STARTING_SLOTS, type Player, type Team, type DraftPick } from "@/lib/draft-constants";
import PositionBadge from "./PositionBadge";

type RivalScoutProps = {
  players: Player[];
  teams: Team[];
  picks: DraftPick[];
  currentPickId: number | null;
};

type PositionThreat = {
  position: "RB" | "WR";
  filled: number;
  needed: number;
  /** 0 = stacked, 1 = could use, 2 = desperate */
  level: 0 | 1 | 2;
};

type RivalPick = {
  pick: DraftPick;
  team: Team;
  overallPick: number;
  threats: PositionThreat[];
  /** True if both RB and WR are needed — rival is flexible */
  flexDanger: boolean;
};

/** Count how many starters of a given position group a team still needs */
function computePositionNeed(
  position: "RB" | "WR",
  roster: Player[],
): { filled: number; needed: number } {
  const count = roster.filter((p) => p.position === position).length;

  // Count starter slots that accept this position (excludes bench/IR)
  let slots = 0;
  for (const slot of STARTING_SLOTS) {
    if ((slot.positions as readonly string[]).includes(position)) slots++;
  }

  return { filled: count, needed: Math.max(0, slots - count) };
}

function buildThreat(pos: "RB" | "WR", roster: Player[]): PositionThreat {
  const { filled, needed } = computePositionNeed(pos, roster);
  let level: 0 | 1 | 2 = 0;
  if (needed >= 2) level = 2;
  else if (needed >= 1) level = 1;
  return { position: pos, filled, needed, level };
}

const THREAT_COLORS: Record<number, string> = {
  0: "bg-green-500/15 text-green-400 border-green-500/25",
  1: "bg-amber-500/15 text-amber-400 border-amber-500/25",
  2: "bg-red-500/15 text-red-400 border-red-500/30",
};

const THREAT_LABELS: Record<number, string> = {
  0: "Stacked",
  1: "Could use",
  2: "Desperate",
};

const THREAT_ICONS: Record<number, string> = {
  0: "✅",
  1: "🟡",
  2: "🔴",
};

const RivalRow = memo(function RivalRow({
  rival,
  picksAway,
}: {
  rival: RivalPick;
  picksAway: number;
}) {
  const maxThreat = Math.max(...rival.threats.map((t) => t.level));

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:bg-accent/30 transition-colors">
      {/* Pick badge */}
      <div className="flex flex-col items-center w-10 shrink-0">
        <span className="text-[10px] font-mono text-muted-foreground">
          {rival.pick.round}.{String(rival.pick.pick_in_round).padStart(2, "0")}
        </span>
        <span className="text-[9px] text-muted-foreground/50">
          {picksAway === 1 ? "next" : `+${picksAway}`}
        </span>
      </div>

      {/* Team info */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
          style={{ backgroundColor: rival.team.color }}
        />
        <span className="text-xs font-semibold truncate">
          {getTeamEmoji(rival.team.team_name)} {rival.team.team_name}
        </span>
      </div>

      {/* Threat pills */}
      <div className="flex items-center gap-1 shrink-0">
        {rival.threats.map((threat) => (
          <span
            key={threat.position}
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold border",
              THREAT_COLORS[threat.level],
            )}
            title={`${threat.position}: ${threat.filled} rostered, needs ${threat.needed} more starter(s)`}
          >
            <span>{THREAT_ICONS[threat.level]}</span>
            <PositionBadge position={threat.position} className="text-[8px] px-1 py-0" />
          </span>
        ))}
      </div>
    </div>
  );
});

const RivalScout = memo(function RivalScout({
  players,
  teams,
  picks,
  currentPickId,
}: RivalScoutProps) {
  const rivals = useMemo(() => {
    if (!currentPickId) return [];

    // Find current pick index
    const currentIdx = picks.findIndex((p) => p.id === currentPickId);
    if (currentIdx === -1) return [];

    // Get next 3 picks that belong to OTHER teams (skip my own picks)
    const myTeam = teams.find((t) => t.is_my_team);
    const upcoming: { pick: DraftPick; picksAway: number }[] = [];
    let count = 0;

    for (let i = currentIdx + 1; i < picks.length && upcoming.length < 3; i++) {
      count++;
      const pick = picks[i];
      if (pick.is_complete) continue;
      // Include even if it's my pick — show what the team currently owning it needs
      if (pick.team_id === myTeam?.id) continue;
      upcoming.push({ pick, picksAway: count });
    }

    // Build rival analysis
    return upcoming.map(({ pick, picksAway }): RivalPick & { picksAway: number } => {
      const team = teams.find((t) => t.id === pick.team_id)!;
      const roster = players.filter(
        (p) => (p.is_drafted && p.drafted_team_id === team.id) || (p.is_keeper && p.keeper_team_id === team.id),
      );

      const rbThreat = buildThreat("RB", roster);
      const wrThreat = buildThreat("WR", roster);

      return {
        pick,
        team,
        overallPick: pick.overall_pick,
        threats: [rbThreat, wrThreat],
        flexDanger: rbThreat.level >= 1 && wrThreat.level >= 1,
        picksAway,
      };
    });
  }, [players, teams, picks, currentPickId]);

  if (rivals.length === 0) {
    return null;
  }

  const anyDesperate = rivals.some((r) => r.threats.some((t) => t.level === 2));
  const anyFlexDanger = rivals.some((r) => r.flexDanger);

  return (
    <div className="border border-border rounded-lg bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/80">
        <span className="text-sm">🎯</span>
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Rival Scout
        </span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">
          Next {rivals.length} picker{rivals.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Rival rows */}
      <div className="p-1.5 space-y-1">
        {rivals.map((rival) => (
          <RivalRow key={rival.pick.id} rival={rival} picksAway={rival.picksAway} />
        ))}
      </div>

      {/* Tactical hint */}
      {(anyDesperate || anyFlexDanger) && (
        <div className="px-3 py-1.5 border-t border-border bg-card/30">
          {anyDesperate && (
            <p className="text-[10px] text-red-400/80">
              ⚠️ Rival desperate for a position — they may reach. Consider sniping if you also need it.
            </p>
          )}
          {anyFlexDanger && !anyDesperate && (
            <p className="text-[10px] text-amber-400/80">
              🤔 Rival needs both RB + WR — flexible pick incoming. Your choice probably survives.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

export default RivalScout;
