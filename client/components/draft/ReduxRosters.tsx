import { useMemo, useState, useCallback, memo } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useApi } from "@/hooks/useApi";
import { queryClient } from "@superblocksteam/library";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";

interface Team {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
  is_my_team?: boolean;
}

interface RosterPlayer {
  id: number;
  name: string;
  position: string;
  nfl_team: string;
  adp_rank: number | null;
  roster_team_id: number | null;
  is_keeper: boolean;
  team_name: string | null;
  manager_name: string | null;
}

interface Props {
  teams: Team[];
}

const POSITION_ORDER = ["QB", "RB", "WR", "TE"] as const;

// ─── Player Row ─────────────────────────────────────────────
const PlayerRow = memo(function PlayerRow({ player }: { player: RosterPlayer }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-muted/30">
      <span className={`text-[10px] font-bold w-7 text-center rounded px-1 py-0.5 ${POSITION_BG_CLASSES[player.position] ?? "bg-muted"}`}>
        {player.position}
      </span>
      <span className="flex-1 truncate font-medium">
        {player.name}
        {player.is_keeper && <span className="text-amber-400 ml-1 text-[10px]">🔒</span>}
      </span>
      {player.nfl_team && (
        <span className="text-[10px] text-muted-foreground w-8 text-right">{player.nfl_team}</span>
      )}
      <span className="text-[10px] text-muted-foreground w-10 text-right font-mono">
        {player.adp_rank ? `#${player.adp_rank}` : "—"}
      </span>
    </div>
  );
});

// ─── Team Roster Card ───────────────────────────────────────
const TeamRosterCard = memo(function TeamRosterCard({
  team,
  players,
  isMyTeam,
}: {
  team: Team;
  players: RosterPlayer[];
  isMyTeam: boolean;
}) {
  const byPosition = useMemo(() => {
    const map = new Map<string, RosterPlayer[]>();
    for (const pos of POSITION_ORDER) {
      map.set(pos, []);
    }
    for (const p of players) {
      const group = map.get(p.position) ?? [];
      group.push(p);
      map.set(p.position, group);
    }
    return map;
  }, [players]);

  const keeperCount = players.filter((p) => p.is_keeper).length;

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        isMyTeam ? "border-primary/50 ring-1 ring-primary/20 bg-primary/5" : "border-border"
      }`}
      style={{ borderTopColor: team.color, borderTopWidth: 3 }}
    >
      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-border/50">
        <span className="text-sm">{getTeamEmoji(team.team_name)}</span>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold truncate block">{team.team_name}</span>
          <span className="text-[10px] text-muted-foreground">{team.manager_name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {players.length} players
          </Badge>
          {keeperCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 border-amber-500/30 text-amber-400">
              🔒 {keeperCount}
            </Badge>
          )}
          {isMyTeam && (
            <Badge className="text-[9px] px-1.5 bg-primary/20 text-primary border-primary/30 border">
              🫵🏼
            </Badge>
          )}
        </div>
      </div>

      {/* Player list by position */}
      <div className="p-2 space-y-1">
        {POSITION_ORDER.map((pos) => {
          const group = byPosition.get(pos) ?? [];
          if (group.length === 0) return null;
          return (
            <div key={pos}>
              <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-0.5">
                {pos} ({group.length})
              </div>
              {group.map((p) => (
                <PlayerRow key={p.id} player={p} />
              ))}
            </div>
          );
        })}
        {players.length === 0 && (
          <p className="text-xs text-muted-foreground italic text-center py-4">No players rostered</p>
        )}
      </div>
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────
export default function ReduxRosters({ teams }: Props) {
  const { data, loading, fetching, isError, error, refetch } = useApiData("GetRosterData", {});
  const { run: redraft, loading: redraftLoading } = useApi("Redraft");
  const [showRedraftDialog, setShowRedraftDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useState<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      if (searchTimer[0]) clearTimeout(searchTimer[0]);
      const timer = setTimeout(() => setDebouncedSearch(e.target.value), 300);
      searchTimer[1](timer);
    },
    [searchTimer],
  );

  const handleRedraft = useCallback(async () => {
    try {
      const result = await redraft({});
      toast.success(result?.message ?? "Redraft complete!");
      await queryClient.invalidateQueries("GetRosterData");
      await refetch();
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      toast.error("Redraft failed: " + message);
    }
  }, [redraft, refetch]);

  const myTeamId = useMemo(() => teams.find((t) => t.is_my_team)?.id ?? null, [teams]);

  // Group players by team, apply search filter
  const teamRosters = useMemo(() => {
    if (!data?.rosterPlayers) return [];

    const q = debouncedSearch.toLowerCase();
    const filtered = q
      ? data.rosterPlayers.filter(
          (p: RosterPlayer) =>
            p.name.toLowerCase().includes(q) ||
            p.position.toLowerCase().includes(q) ||
            (p.nfl_team && p.nfl_team.toLowerCase().includes(q)) ||
            (p.manager_name && p.manager_name.toLowerCase().includes(q)) ||
            (p.team_name && p.team_name.toLowerCase().includes(q)),
        )
      : data.rosterPlayers;

    // Group by team
    const map = new Map<number, RosterPlayer[]>();
    for (const team of teams) {
      map.set(team.id, []);
    }
    for (const p of filtered) {
      if (p.roster_team_id) {
        const arr = map.get(p.roster_team_id) ?? [];
        arr.push(p);
        map.set(p.roster_team_id, arr);
      }
    }

    // Sort teams alphabetically by manager name, but put my team first
    return Array.from(map.entries())
      .map(([teamId, players]) => ({
        team: teams.find((t) => t.id === teamId)!,
        players,
      }))
      .filter((entry) => entry.team)
      .sort((a, b) => {
        if (a.team.id === myTeamId) return -1;
        if (b.team.id === myTeamId) return 1;
        return a.team.manager_name.localeCompare(b.team.manager_name);
      });
  }, [data?.rosterPlayers, debouncedSearch, teams, myTeamId]);

  const totalPlayers = data?.rosterPlayers?.length ?? 0;
  const totalKeepers = data?.rosterPlayers?.filter((p: RosterPlayer) => p.is_keeper).length ?? 0;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
        <p className="text-red-400 text-sm font-semibold">Failed to load roster data</p>
        <p className="text-xs text-muted-foreground mt-1 font-mono">{String(error)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-semibold">🏟️ Redux Rosters</h3>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{totalPlayers} rostered</span>
          <span>•</span>
          <span>🔒 {totalKeepers} keepers</span>
          <span>•</span>
          <span>{teams.length} teams</span>
        </div>
        {fetching && <span className="text-xs text-muted-foreground animate-pulse">🔄 Updating…</span>}

        <div className="ml-auto flex items-center gap-2">
          <Input
            placeholder="Search players, teams..."
            value={search}
            onChange={handleSearchChange}
            className="h-7 w-48 text-xs"
          />
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={redraftLoading || totalPlayers === 0}
            onClick={() => setShowRedraftDialog(true)}
          >
            🔄 Redraft
          </Button>
          <Dialog open={showRedraftDialog} onOpenChange={setShowRedraftDialog}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Confirm Redraft</DialogTitle>
                <DialogDescription>
                  This will clear all non-keeper roster assignments ({totalPlayers - totalKeepers} players).
                  The {totalKeepers} keepers will remain on their teams. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowRedraftDialog(false)}>Cancel</Button>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    await handleRedraft();
                    setShowRedraftDialog(false);
                  }}
                  disabled={redraftLoading}
                >
                  {redraftLoading ? "Clearing..." : "Yes, Redraft"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Team Grid */}
      <ScrollArea className="max-h-[calc(100vh-250px)]">
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 ${fetching ? "opacity-70" : ""}`}>
          {teamRosters.map(({ team, players }) => (
            <TeamRosterCard
              key={team.id}
              team={team}
              players={players}
              isMyTeam={team.id === myTeamId}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
