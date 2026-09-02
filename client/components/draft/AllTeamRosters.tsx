import { useMemo, useState, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import PositionBadge from "./PositionBadge";
import { ROSTER_SLOTS, STARTING_SLOTS, getTeamEmoji, type Player, type Team } from "@/lib/draft-constants";
import { computePlayerValue } from "@/lib/player-values";

type AllTeamRostersProps = {
  players: Player[];
  teams: Team[];
  onSwapKeeper?: (oldPlayerId: number, newPlayerId: number, teamId: number) => void;
};

type SlotAssignment = {
  slotLabel: string;
  isStarter: boolean;
  player: Player | null;
};

// ---------- Grading System (League-Curved, 60/40 ADP+Dynasty) ----------

type GradeInfo = {
  letter: string;
  emoji: string;
  colorClass: string;
  bgClass: string;
};

function gradeInfo(grade: string): GradeInfo {
  switch (grade) {
    case "A+":
      return { letter: "A+", emoji: "🔥", colorClass: "text-green-400", bgClass: "bg-green-500/15 border-green-500/30" };
    case "A":
      return { letter: "A", emoji: "🔥", colorClass: "text-green-400", bgClass: "bg-green-500/10 border-green-500/25" };
    case "A-":
      return { letter: "A-", emoji: "🔥", colorClass: "text-green-400", bgClass: "bg-green-500/10 border-green-500/20" };
    case "B+":
      return { letter: "B+", emoji: "💪", colorClass: "text-blue-400", bgClass: "bg-blue-500/15 border-blue-500/30" };
    case "B":
      return { letter: "B", emoji: "💪", colorClass: "text-blue-400", bgClass: "bg-blue-500/10 border-blue-500/25" };
    case "B-":
      return { letter: "B-", emoji: "💪", colorClass: "text-blue-400", bgClass: "bg-blue-500/10 border-blue-500/20" };
    case "C+":
      return { letter: "C+", emoji: "☔️", colorClass: "text-amber-400", bgClass: "bg-amber-500/15 border-amber-500/30" };
    case "C":
      return { letter: "C", emoji: "☔️", colorClass: "text-amber-400", bgClass: "bg-amber-500/10 border-amber-500/25" };
    case "D":
      return { letter: "D", emoji: "💩", colorClass: "text-red-400", bgClass: "bg-red-500/10 border-red-500/25" };
    case "F":
    default:
      return { letter: "F", emoji: "🪦", colorClass: "text-zinc-400", bgClass: "bg-zinc-500/10 border-zinc-500/25" };
  }
}

/**
 * Compute the total blended roster value for a team.
 * Uses shared computePlayerValue (60% ADP + 40% Dynasty, 1-500 scale).
 * Uses drafted_team_id only — this is the frozen draft-day snapshot.
 */
function computeTeamScore(players: Player[], teamId: number): number {
  const roster = players.filter(
    (p) => p.is_drafted && p.drafted_team_id === teamId,
  );
  let total = 0;
  for (const p of roster) {
    total += computePlayerValue(p.adp_rank, p.dynasty_rank);
  }
  return Math.round(total * 10) / 10;
}

type TeamGradeResult = {
  grade: GradeInfo;
  rawScore: number;
  rank: number;
  playerCount: number;
};

/** Shared 10-grade percentile ladder (matches Redux Rosters server-side). */
function gradeFromRank(rank: number, totalTeams: number): string {
  const pct = (rank - 1) / totalTeams;
  if (pct < 0.09) return "A+";
  if (pct < 0.18) return "A";
  if (pct < 0.27) return "A-";
  if (pct < 0.36) return "B+";
  if (pct < 0.50) return "B";
  if (pct < 0.63) return "B-";
  if (pct < 0.72) return "C+";
  if (pct < 0.81) return "C";
  if (pct < 0.90) return "D";
  return "F";
}

/**
 * Curve all teams against the league.
 * Returns a map of teamId -> grade info.
 */
function computeLeagueGrades(players: Player[], teams: Team[]): Map<number, TeamGradeResult> {
  const teamScores = teams.map((t) => ({
    id: t.id,
    score: computeTeamScore(players, t.id),
    count: players.filter((p) => p.is_drafted && p.drafted_team_id === t.id).length,
  }));

  const sorted = [...teamScores].sort((a, b) => b.score - a.score);
  const totalTeams = sorted.length;

  const result = new Map<number, TeamGradeResult>();
  for (let i = 0; i < sorted.length; i++) {
    const ts = sorted[i];
    const letter = gradeFromRank(i + 1, totalTeams);
    result.set(ts.id, {
      grade: gradeInfo(letter),
      rawScore: ts.score,
      rank: i + 1,
      playerCount: ts.count,
    });
  }

  return result;
}

// ---------- Roster Slot Assignment ----------

function assignRosterSlots(teamPlayers: Player[]): SlotAssignment[] {
  const assignments: SlotAssignment[] = [];
  const assigned = new Set<number>();

  for (const slot of STARTING_SLOTS) {
    const eligible = teamPlayers.filter(
      (p) => !assigned.has(p.id) && (slot.positions as readonly string[]).includes(p.position),
    );
    const pick = eligible[0] ?? null;
    if (pick) assigned.add(pick.id);
    assignments.push({ slotLabel: slot.label, isStarter: true, player: pick });
  }

  const remaining = teamPlayers.filter((p) => !assigned.has(p.id));
  const benchSlots = ROSTER_SLOTS.filter((s) => s.key.startsWith("BN") || s.key === "IR");
  for (let i = 0; i < benchSlots.length; i++) {
    assignments.push({
      slotLabel: benchSlots[i].label,
      isStarter: false,
      player: remaining[i] ?? null,
    });
  }

  return assignments;
}

// ---------- Keeper Swap Popover ----------

function KeeperSwapPanel({
  player,
  teamId,
  availablePlayers,
  onSwap,
  onClose,
}: {
  player: Player;
  teamId: number;
  availablePlayers: Player[];
  onSwap: (oldPlayerId: number, newPlayerId: number, teamId: number) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return availablePlayers
      .filter((p) => p.name.toLowerCase().includes(q) || p.nfl_team.toLowerCase().includes(q) || p.position.toLowerCase().includes(q))
      .sort((a, b) => (a.adp_rank ?? 999) - (b.adp_rank ?? 999))
      .slice(0, 20);
  }, [availablePlayers, search]);

  return (
    <div className="absolute inset-0 z-20 bg-card border border-primary/30 rounded-lg flex flex-col overflow-hidden shadow-xl">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-primary/5">
        <Icon icon="arrow-left-right" className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold flex-1">
          Swap <span className="text-primary">{player.name}</span>
        </span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <Icon icon="x" className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="px-2 py-1.5">
        <Input
          placeholder="Search players..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-7 text-xs"
          autoFocus
        />
      </div>
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="px-2 pb-2 space-y-0.5">
          {filtered.length === 0 ? (
            <div className="text-[10px] text-muted-foreground p-2 text-center">No players found</div>
          ) : (
            filtered.map((p) => (
              <button
                key={p.id}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px] hover:bg-primary/10 transition-colors text-left"
                onClick={() => onSwap(player.id, p.id, teamId)}
              >
                <PositionBadge position={p.position} />
                <span className="font-medium truncate flex-1">{p.name}</span>
                <span className="text-[9px] text-muted-foreground">{p.nfl_team}</span>
                <span className="text-[9px] text-muted-foreground font-mono">#{p.adp_rank ?? "-"}</span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ---------- Team Card ----------

function TeamCard({
  team,
  players,
  gradeResult,
  onSwapKeeper,
}: {
  team: Team;
  players: Player[];
  gradeResult: TeamGradeResult;
  onSwapKeeper?: (oldPlayerId: number, newPlayerId: number, teamId: number) => void;
}) {
  const [swapPlayerId, setSwapPlayerId] = useState<number | null>(null);

  const teamPlayers = useMemo(() => {
    return players
      .filter((p) => p.is_drafted && p.drafted_team_id === team.id)
      .sort((a, b) => {
        const posOrder = ["QB", "RB", "WR", "TE"];
        return posOrder.indexOf(a.position) - posOrder.indexOf(b.position);
      });
  }, [players, team.id]);

  const availablePlayers = useMemo(() => {
    return players.filter((p) => !p.is_drafted && !p.is_keeper);
  }, [players]);

  const slots = useMemo(() => assignRosterSlots(teamPlayers), [teamPlayers]);
  const { grade, rawScore, rank, playerCount } = gradeResult;

  const filledStarters = slots.filter((s) => s.isStarter && s.player).length;
  const totalStarters = STARTING_SLOTS.length;

  const swapPlayer = swapPlayerId ? teamPlayers.find((p) => p.id === swapPlayerId) : null;

  const handleSwap = useCallback(
    (oldId: number, newId: number, tId: number) => {
      onSwapKeeper?.(oldId, newId, tId);
      setSwapPlayerId(null);
    },
    [onSwapKeeper],
  );

  return (
    <div className="relative rounded-lg border border-border bg-card/50 overflow-hidden">
      {/* Keeper Swap Overlay */}
      {swapPlayer && (
        <KeeperSwapPanel
          player={swapPlayer}
          teamId={team.id}
          availablePlayers={availablePlayers}
          onSwap={handleSwap}
          onClose={() => setSwapPlayerId(null)}
        />
      )}

      {/* Team Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-card">
        <span
          className="w-2.5 h-2.5 rounded-full ring-1 ring-white/20 shrink-0"
          style={{ backgroundColor: team.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate">
            {getTeamEmoji(team.team_name)} {team.team_name}
            {team.is_my_team && <span className="text-primary ml-1 text-[10px]">(YOU)</span>}
          </div>
          <div className="text-[10px] text-muted-foreground">{team.manager_name}</div>
        </div>

        {/* Grade Badge + Rank */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-mono">#{rank}</span>
          <div className={cn("flex items-center gap-1 rounded-md border px-2 py-1", grade.bgClass)}>
            <span className="text-sm">{grade.emoji}</span>
            <span className={cn("text-lg font-black leading-none", grade.colorClass)}>
              {grade.letter}
            </span>
          </div>
        </div>
      </div>

      {/* Grade details */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/40 bg-card/30">
        <div className="text-[10px] text-muted-foreground">
          {filledStarters}/{totalStarters} starters
        </div>
        <div className="text-[10px] text-muted-foreground">
          <span className="font-bold">{rawScore}</span>
          <span className="ml-1 opacity-60">pts</span>
        </div>
      </div>

      {/* Roster Slots */}
      <div className="p-2 space-y-0.5">
        {slots.map((slot, idx) => (
          <div
            key={idx}
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-sm text-[11px]",
              slot.isStarter && slot.player && "bg-accent/30",
              slot.isStarter && !slot.player && "bg-destructive/5 border border-dashed border-destructive/20",
              !slot.isStarter && "opacity-70",
            )}
          >
            <span className="w-6 text-[10px] font-mono text-muted-foreground shrink-0">
              {slot.slotLabel}
            </span>
            {slot.player ? (
              <>
                <PositionBadge position={slot.player.position} />
                <span className="font-medium truncate flex-1">{slot.player.name}</span>
                <span className="text-[9px] text-muted-foreground shrink-0">
                  {slot.player.nfl_team}
                </span>
                {slot.player.is_keeper && (
                  <>
                    <span className="text-[8px] font-bold text-primary uppercase tracking-wider shrink-0">K</span>
                    {onSwapKeeper && (
                      <button
                        className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                        title="Swap keeper"
                        onClick={() => setSwapPlayerId(slot.player!.id)}
                      >
                        <Icon icon="arrow-left-right" className="h-3 w-3" />
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              <span className="text-muted-foreground/40 italic text-[10px]">
                {slot.isStarter ? "Open" : "—"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Main Component ----------

export default function AllTeamRosters({ players, teams, onSwapKeeper }: AllTeamRostersProps) {
  const leagueGrades = useMemo(() => computeLeagueGrades(players, teams), [players, teams]);

  // Sort: my team first, then alphabetically by manager first name
  const sortedTeams = useMemo(() => {
    return [...teams].sort((a, b) => {
      if (a.is_my_team) return -1;
      if (b.is_my_team) return 1;
      const nameA = (a.manager_name ?? "").split(" ")[0].toLowerCase();
      const nameB = (b.manager_name ?? "").split(" ")[0].toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [teams]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            All Team Rosters
          </h2>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {teams.length} teams · Curved against the league
          </span>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sortedTeams.map((team) => (
            <TeamCard
              key={team.id}
              team={team}
              players={players}
              gradeResult={leagueGrades.get(team.id) ?? { grade: gradeInfo("B"), rawScore: 0, rank: 99, playerCount: 0 }}
              onSwapKeeper={onSwapKeeper}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
