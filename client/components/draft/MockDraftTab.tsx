import { useState, useCallback, useMemo, useRef, memo } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useApi } from "@/hooks/useApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import PositionBadge from "./PositionBadge";
import { POSITION_BG_CLASSES, getTeamEmoji, type Player, type Team, type DraftPick } from "@/lib/draft-constants";
import { computeTeamDraftStatus, getPickStatusEmoji, getPickStatusTileClass, type PickStatus } from "@/lib/roster-completion";

type MockPick = {
  overallPick: number;
  round: number;
  pickInRound: number;
  teamId: number;
  playerId: number;
  playerName: string;
  playerPosition: string;
  playerNflTeam: string;
  playerAdpRank: number | null;
  playerDynastyRank: number | null;
};

type MockDraftTabProps = {
  players: Player[];
  teams: Team[];
  picks: DraftPick[];
};

// --- Scoring utility ---
function computePlayerValue(adpRank: number | null, dynastyRank: number | null): number {
  const adpVal = adpRank != null ? Math.max(0, 100 - adpRank) : 0;
  const dynVal = dynastyRank != null ? Math.max(0, 100 - dynastyRank) : 0;
  const hasDyn = dynastyRank != null;
  return hasDyn ? 0.7 * adpVal + 0.3 * dynVal : adpVal;
}

function gradeFromScore(score: number, allScores: number[]): { letter: string; colorClass: string; bgClass: string } {
  const sorted = [...allScores].sort((a, b) => b - a);
  const rank = sorted.indexOf(score) + 1;
  const pct = (rank - 1) / sorted.length;
  let letter: string;
  if (pct < 0.1) letter = "A+";
  else if (pct < 0.27) letter = "A";
  else if (pct < 0.45) letter = "B+";
  else if (pct < 0.64) letter = "B";
  else if (pct < 0.73) letter = "C+";
  else if (pct < 0.82) letter = "C";
  else if (pct < 0.91) letter = "D";
  else letter = "F";

  const colors: Record<string, { colorClass: string; bgClass: string }> = {
    "A+": { colorClass: "text-green-400", bgClass: "bg-green-500/15 border-green-500/30" },
    "A": { colorClass: "text-green-400", bgClass: "bg-green-500/10 border-green-500/25" },
    "B+": { colorClass: "text-blue-400", bgClass: "bg-blue-500/15 border-blue-500/30" },
    "B": { colorClass: "text-blue-400", bgClass: "bg-blue-500/10 border-blue-500/25" },
    "C+": { colorClass: "text-amber-400", bgClass: "bg-amber-500/15 border-amber-500/30" },
    "C": { colorClass: "text-amber-400", bgClass: "bg-amber-500/10 border-amber-500/25" },
    "D": { colorClass: "text-red-400", bgClass: "bg-red-500/10 border-red-500/25" },
    "F": { colorClass: "text-zinc-400", bgClass: "bg-zinc-500/10 border-zinc-500/25" },
  };
  return { letter, ...(colors[letter] ?? colors["F"]) };
}

// --- Main Component ---
export default function MockDraftTab({ players, teams, picks }: MockDraftTabProps) {
  const { run: runMock, loading: mocking } = useApi("RunMockDraft");
  const [mockPicks, setMockPicks] = useState<MockPick[]>([]);
  const [mockCount, setMockCount] = useState(0);
  const [search, setSearch] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [highlightedPick, setHighlightedPick] = useState<number | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const myTeamId = useMemo(() => teams.find((t) => t.is_my_team)?.id ?? 1, [teams]);

  // Get rounds available
  const rounds = useMemo(() => {
    const r = new Set(picks.map((p) => p.round));
    return Array.from(r).sort((a, b) => a - b);
  }, [picks]);

  // Run mock draft (rounds 1-8)
  const handleMockDraft = useCallback(async () => {
    try {
      const result = await runMock({ startRound: 1, existingPicks: [] });
      if (result?.picks) {
        const round8Picks = result.picks.filter((p: MockPick) => p.round <= 8);
        setMockPicks(round8Picks);
        setMockCount((c) => c + 1);
        toast.success("Mock draft complete!");
      }
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message) : String(error);
      toast.error("Mock draft failed: " + message);
    }
  }, [runMock]);

  // Finish mock (rounds 9-11) respecting current state
  const handleFinishMock = useCallback(async () => {
    try {
      const existing = mockPicks.map((p) => ({
        overallPick: p.overallPick,
        playerId: p.playerId,
      }));
      const result = await runMock({ startRound: 9, existingPicks: existing });
      if (result?.picks) {
        setMockPicks(result.picks);
        toast.success("Mock draft completed through round 11!");
      }
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message) : String(error);
      toast.error("Finish mock failed: " + message);
    }
  }, [runMock, mockPicks]);

  // Reset
  const handleReset = useCallback(() => {
    setMockPicks([]);
    setSearch("");
    setHighlightedPick(null);
  }, []);

  // Remove a player from a pick
  const handleRemovePlayer = useCallback((overallPick: number) => {
    setMockPicks((prev) => prev.filter((p) => p.overallPick !== overallPick));
  }, []);

  // Swap two picks
  const handleSwap = useCallback((fromPick: number, toPick: number) => {
    setMockPicks((prev) => {
      const newPicks = [...prev];
      const fromIdx = newPicks.findIndex((p) => p.overallPick === fromPick);
      const toIdx = newPicks.findIndex((p) => p.overallPick === toPick);
      if (fromIdx === -1) return prev;

      if (toIdx === -1) {
        const pick = picks.find((p) => p.overall_pick === toPick);
        if (!pick) return prev;
        newPicks[fromIdx] = {
          ...newPicks[fromIdx],
          overallPick: toPick,
          round: pick.round,
          pickInRound: pick.pick_in_round,
          teamId: pick.team_id,
        };
      } else {
        const fromData = newPicks[fromIdx];
        const toData = newPicks[toIdx];
        newPicks[fromIdx] = { ...fromData, overallPick: toData.overallPick, round: toData.round, pickInRound: toData.pickInRound, teamId: toData.teamId };
        newPicks[toIdx] = { ...toData, overallPick: fromData.overallPick, round: fromData.round, pickInRound: fromData.pickInRound, teamId: fromData.teamId };
      }
      return newPicks;
    });
  }, [picks]);

  // Add player to a specific pick
  const handleAddPlayer = useCallback((playerId: number, overallPick: number) => {
    const player = players.find((p) => p.id === playerId);
    const pick = picks.find((p) => p.overall_pick === overallPick);
    if (!player || !pick) return;

    setMockPicks((prev) => {
      const filtered = prev.filter((p) => p.playerId !== playerId && p.overallPick !== overallPick);
      return [...filtered, {
        overallPick,
        round: pick.round,
        pickInRound: pick.pick_in_round,
        teamId: pick.team_id,
        playerId: player.id,
        playerName: player.name,
        playerPosition: player.position,
        playerNflTeam: player.nfl_team,
        playerAdpRank: player.adp_rank,
        playerDynastyRank: player.dynasty_rank,
      }];
    });
    setShowAddPanel(false);
    setSelectedCell(null);
    setAddSearch("");
  }, [players, picks]);

  // Build pick map for quick lookup
  const mockPickMap = useMemo(() => {
    const map = new Map<number, MockPick>();
    for (const p of mockPicks) map.set(p.overallPick, p);
    return map;
  }, [mockPicks]);

  // Drafted player IDs (for add-player filter)
  const draftedIds = useMemo(() => new Set(mockPicks.map((p) => p.playerId)), [mockPicks]);

  // Team name + manager lookup
  const teamNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of teams) map.set(t.id, t.team_name);
    return map;
  }, [teams]);

  const teamManagerMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of teams) map.set(t.id, t.manager_name);
    return map;
  }, [teams]);

  // Team scores
  const teamScores = useMemo(() => {
    const scores = new Map<number, number>();
    for (const t of teams) {
      const keeperScore = players
        .filter((p) => p.is_keeper && p.keeper_team_id === t.id)
        .reduce((sum, p) => sum + computePlayerValue(p.adp_rank, p.dynasty_rank), 0);
      const mockScore = mockPicks
        .filter((mp) => mp.teamId === t.id)
        .reduce((sum, mp) => sum + computePlayerValue(mp.playerAdpRank, mp.playerDynastyRank), 0);
      scores.set(t.id, keeperScore + mockScore);
    }
    return scores;
  }, [teams, players, mockPicks]);

  const allScoreValues = useMemo(() => Array.from(teamScores.values()), [teamScores]);

  // Roster completion tracking per team
  const teamDraftStatuses = useMemo(() => {
    const statuses = new Map<number, ReturnType<typeof computeTeamDraftStatus>>();
    for (const t of teams) {
      const keeperPositions = players
        .filter((p) => p.is_keeper && p.keeper_team_id === t.id)
        .map((p) => p.position);
      const teamMockPicks = mockPicks
        .filter((mp) => mp.teamId === t.id)
        .sort((a, b) => a.overallPick - b.overallPick)
        .map((mp) => ({ overallPick: mp.overallPick, position: mp.playerPosition }));
      const totalPicks = picks.filter((p) => p.team_id === t.id).length;
      const picksUsed = teamMockPicks.length;
      statuses.set(t.id, computeTeamDraftStatus(keeperPositions, teamMockPicks, totalPicks, totalPicks - picksUsed));
    }
    return statuses;
  }, [teams, players, mockPicks, picks]);

  // Position run detection
  const positionRuns = useMemo(() => {
    const runs = new Set<number>();
    const sortedPicks = [...mockPicks].sort((a, b) => a.overallPick - b.overallPick);
    for (let i = 2; i < sortedPicks.length; i++) {
      if (
        sortedPicks[i].playerPosition === sortedPicks[i - 1].playerPosition &&
        sortedPicks[i].playerPosition === sortedPicks[i - 2].playerPosition &&
        sortedPicks[i].overallPick - sortedPicks[i - 2].overallPick <= 4
      ) {
        runs.add(sortedPicks[i].overallPick);
        runs.add(sortedPicks[i - 1].overallPick);
        runs.add(sortedPicks[i - 2].overallPick);
      }
    }
    return runs;
  }, [mockPicks]);

  // Comparison bar
  const comparisonData = useMemo(() => {
    if (mockPicks.length === 0) return [];
    const myPicks = picks.filter((p) => p.team_id === myTeamId);
    const sorted = [...mockPicks].sort((a, b) => a.overallPick - b.overallPick);

    return myPicks.map((mp) => {
      const myMock = mockPickMap.get(mp.overall_pick);
      if (!myMock) return null;
      const nextPicks = sorted
        .filter((p) => p.overallPick > mp.overall_pick && p.overallPick <= mp.overall_pick + 5)
        .slice(0, 3);
      return { myPick: myMock, missedPlayers: nextPicks };
    }).filter(Boolean) as Array<{ myPick: MockPick; missedPlayers: MockPick[] }>;
  }, [mockPicks, picks, myTeamId, mockPickMap]);

  // Search filter for board
  const searchMatchPicks = useMemo(() => {
    if (!search) return new Set<number>();
    const q = search.toLowerCase();
    return new Set(
      mockPicks
        .filter((p) => p.playerName.toLowerCase().includes(q) || p.playerPosition.toLowerCase().includes(q))
        .map((p) => p.overallPick)
    );
  }, [search, mockPicks]);

  // Drag state
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Controls Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-card/50 shrink-0">
        <Button size="sm" onClick={handleMockDraft} disabled={mocking} className="h-7 text-xs px-3">
          <Icon icon="shuffle" className="h-3 w-3 mr-1.5" />
          {mocking ? "Simulating..." : "Mock Draft"}
        </Button>
        {mockPicks.length > 0 && mockPicks.every((p) => p.round <= 8) && (
          <Button size="sm" variant="outline" onClick={handleFinishMock} disabled={mocking} className="h-7 text-xs px-3">
            <Icon icon="fast-forward" className="h-3 w-3 mr-1.5" />
            Finish (Rds 9-11)
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={handleReset} disabled={mockPicks.length === 0} className="h-7 text-xs px-3">
          <Icon icon="rotate-ccw" className="h-3 w-3 mr-1.5" />
          Reset
        </Button>

        {mockCount > 0 && (
          <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
            Mock #{mockCount}
          </span>
        )}

        <div className="flex-1" />

        {/* Legend */}
        <div className="hidden md:flex items-center gap-2 text-[9px] text-muted-foreground mr-2">
          <span className="flex items-center gap-0.5"><span className="w-2.5 h-2.5 rounded bg-yellow-500/30 border border-yellow-500/40" /> 📋 Starter</span>
          <span className="flex items-center gap-0.5"><span className="w-2.5 h-2.5 rounded bg-zinc-500/30 border border-zinc-500/40" /> 🪑 Bench</span>
          <span className="flex items-center gap-0.5"><span className="w-2.5 h-2.5 rounded bg-orange-500/30 border border-orange-500/40" /> 🏈 Lineup Done</span>
          <span className="flex items-center gap-0.5"><span className="w-2.5 h-2.5 rounded bg-green-500/30 border border-green-500/40" /> ✅ Done</span>
        </div>

        {/* Board search */}
        <div className="relative w-48">
          <Icon icon="search" className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find player on board..."
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Comparison Bar */}
      {comparisonData.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-primary/5 text-xs overflow-x-auto shrink-0">
          <Icon icon="eye" className="h-3.5 w-3.5 text-primary shrink-0" />
          {comparisonData.slice(0, 3).map(({ myPick, missedPlayers }) => (
            <span key={myPick.overallPick} className="flex items-center gap-1 shrink-0">
              <span className="font-semibold text-primary">#{myPick.overallPick}</span>
              <span className="text-muted-foreground">you took</span>
              <span className="font-medium">{myPick.playerName}</span>
              {missedPlayers.length > 0 && (
                <>
                  <span className="text-muted-foreground mx-0.5">—</span>
                  <span className="text-muted-foreground">missed:</span>
                  {missedPlayers.map((mp) => (
                    <span key={mp.overallPick} className="text-amber-400">{mp.playerName}</span>
                  ))}
                </>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Draft Board Grid — no column headers, team info on each tile */}
      <div className="flex-1 min-h-0 overflow-auto" ref={boardRef}>
        <div className="p-3">
          {rounds.map((round) => {
            const roundPicks = picks.filter((p) => p.round === round);
            return (
              <div
                key={round}
                className="grid gap-1 mb-1"
                style={{ gridTemplateColumns: `32px repeat(${roundPicks.length}, 1fr)` }}
              >
                {/* Round label */}
                <div className="flex items-center justify-center text-[10px] font-mono text-muted-foreground font-bold">
                  R{round}
                </div>

                {/* Pick cells */}
                {roundPicks.map((pick) => {
                  const mock = mockPickMap.get(pick.overall_pick);
                  const isMyPick = pick.team_id === myTeamId;
                  const isHighlighted = highlightedPick === pick.overall_pick;
                  const isSearchMatch = searchMatchPicks.has(pick.overall_pick);
                  const isPositionRun = positionRuns.has(pick.overall_pick);
                  const teamStatus = teamDraftStatuses.get(pick.team_id);
                  const pickStatus = teamStatus?.pickStatuses.get(pick.overall_pick);
                  const teamName = teamNameMap.get(pick.team_id) ?? "Team";
                  const managerName = teamManagerMap.get(pick.team_id) ?? "";
                  const emoji = getTeamEmoji(teamName);

                  return (
                    <div
                      key={pick.id}
                      className={cn(
                        "relative rounded border text-[9px] min-h-[52px] p-1 transition-all cursor-pointer select-none",
                        "hover:ring-1 hover:ring-primary/50",
                        mock ? "border-border/60" : "border-dashed border-border/30",
                        // Color-coded tile based on pick status
                        mock && getPickStatusTileClass(pickStatus),
                        isMyPick && "ring-1 ring-primary/40 shadow-[0_0_6px_-2px] shadow-primary/30",
                        isHighlighted && "ring-2 ring-amber-400",
                        isSearchMatch && "ring-2 ring-amber-400 bg-amber-500/10",
                        isPositionRun && "border-l-2 border-l-orange-400",
                        dragFrom === pick.overall_pick && "opacity-50 scale-95",
                      )}
                      draggable={!!mock}
                      onDragStart={() => setDragFrom(pick.overall_pick)}
                      onDragEnd={() => setDragFrom(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragFrom != null && dragFrom !== pick.overall_pick) {
                          handleSwap(dragFrom, pick.overall_pick);
                        }
                        setDragFrom(null);
                      }}
                      onClick={() => {
                        if (!mock && mockPicks.length > 0) {
                          setSelectedCell(pick.overall_pick);
                          setShowAddPanel(true);
                        }
                      }}
                    >
                      {mock ? (
                        <div className="flex flex-col gap-0.5">
                          {/* Team: emoji + full name + manager */}
                          <div className="text-[8px] text-muted-foreground leading-tight truncate">
                            <span>{emoji} {teamName}</span>
                          </div>
                          {managerName && (
                            <div className="text-[7px] text-muted-foreground/60 leading-none truncate -mt-0.5">
                              {managerName}
                            </div>
                          )}
                          {/* Player: position badge + full name */}
                          <div className="flex items-center gap-0.5">
                            <span className={cn(
                              "text-[7px] font-bold px-0.5 rounded shrink-0",
                              POSITION_BG_CLASSES[mock.playerPosition] ?? ""
                            )}>
                              {mock.playerPosition}
                            </span>
                            <span className="font-medium truncate leading-tight text-[9px]">
                              {mock.playerName}
                            </span>
                          </div>
                          {/* Status emoji */}
                          {pickStatus && (
                            <div className="text-[8px] leading-none">
                              {getPickStatusEmoji(pickStatus)}
                            </div>
                          )}
                          {/* Remove button */}
                          <button
                            className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-destructive/80 text-destructive-foreground flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity text-[8px]"
                            onClick={(e) => { e.stopPropagation(); handleRemovePlayer(pick.overall_pick); }}
                          >
                            x
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-0.5">
                          <span className="text-[8px] text-muted-foreground/50">{emoji}</span>
                          <span className="text-muted-foreground/30 text-[8px]">{pick.overall_pick}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Team Tiles + Add Player Panel */}
      <div className="shrink-0 border-t border-border bg-card/30">
        {showAddPanel && selectedCell != null ? (
          <AddPlayerPanel
            players={players}
            draftedIds={draftedIds}
            search={addSearch}
            onSearchChange={setAddSearch}
            onAdd={(playerId) => handleAddPlayer(playerId, selectedCell)}
            onClose={() => { setShowAddPanel(false); setSelectedCell(null); }}
            targetPick={selectedCell}
          />
        ) : mockPicks.length > 0 ? (
          <MockTeamTiles
            teams={teams}
            teamScores={teamScores}
            allScoreValues={allScoreValues}
            teamDraftStatuses={teamDraftStatuses}
            players={players}
            mockPicks={mockPicks}
            myTeamId={myTeamId}
          />
        ) : (
          <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
            <Icon icon="shuffle" className="h-4 w-4 mr-2 opacity-50" />
            Hit "Mock Draft" to simulate your league's draft
          </div>
        )}
      </div>
    </div>
  );
}

// --- Add Player Panel ---
function AddPlayerPanel({
  players,
  draftedIds,
  search,
  onSearchChange,
  onAdd,
  onClose,
  targetPick,
}: {
  players: Player[];
  draftedIds: Set<number>;
  search: string;
  onSearchChange: (s: string) => void;
  onAdd: (playerId: number) => void;
  onClose: () => void;
  targetPick: number;
}) {
  const available = useMemo(() => {
    const q = search.toLowerCase();
    return players
      .filter((p) => !p.is_keeper && !draftedIds.has(p.id) && !p.is_drafted)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.position.toLowerCase().includes(q) || p.nfl_team.toLowerCase().includes(q))
      .sort((a, b) => (a.adp_rank ?? 999) - (b.adp_rank ?? 999))
      .slice(0, 20);
  }, [players, draftedIds, search]);

  return (
    <div className="p-3 max-h-[200px] overflow-auto">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium">Add player to pick #{targetPick}</span>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <Input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search available players..."
        className="h-7 text-xs mb-2"
        autoFocus
      />
      <div className="space-y-0.5">
        {available.map((p) => (
          <button
            key={p.id}
            onClick={() => onAdd(p.id)}
            className="flex items-center gap-2 w-full px-2 py-1 rounded hover:bg-muted/50 text-xs text-left"
          >
            <PositionBadge position={p.position} className="text-[8px] px-1 py-0" />
            <span className="font-medium">{p.name}</span>
            <span className="text-muted-foreground">{p.nfl_team}</span>
            <span className="ml-auto text-muted-foreground">ADP {p.adp_rank ?? "—"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Team Tiles ---
const MockTeamTiles = memo(function MockTeamTiles({
  teams,
  teamScores,
  allScoreValues,
  teamDraftStatuses,
  players,
  mockPicks,
  myTeamId,
}: {
  teams: Team[];
  teamScores: Map<number, number>;
  allScoreValues: number[];
  teamDraftStatuses: Map<number, ReturnType<typeof computeTeamDraftStatus>>;
  players: Player[];
  mockPicks: MockPick[];
  myTeamId: number;
}) {
  return (
    <div className="flex gap-1.5 p-2 overflow-x-auto">
      {teams.map((team) => {
        const score = teamScores.get(team.id) ?? 0;
        const grade = gradeFromScore(score, allScoreValues);
        const status = teamDraftStatuses.get(team.id);
        const teamMockPlayers = mockPicks
          .filter((p) => p.teamId === team.id)
          .sort((a, b) => a.overallPick - b.overallPick);
        const isMe = team.id === myTeamId;
        const emoji = getTeamEmoji(team.team_name);

        return (
          <div
            key={team.id}
            className={cn(
              "shrink-0 w-[130px] rounded-md border p-1.5 text-[10px]",
              isMe ? "border-primary/40 bg-primary/5" : "border-border/50 bg-card/50",
              status?.desperationAlert && "ring-1 ring-red-500/40"
            )}
          >
            <div className="flex items-center gap-1 mb-1">
              <span className="shrink-0">{emoji}</span>
              <span className={cn("font-medium truncate", isMe && "text-primary")}>
                {team.team_name.split(" ")[0]}
              </span>
              <span className={cn("ml-auto font-bold text-[11px] px-1 rounded border", grade.bgClass, grade.colorClass)}>
                {grade.letter}
              </span>
            </div>
            {/* Starter progress */}
            <div className="flex items-center gap-0.5 mb-1">
              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary/60 transition-all"
                  style={{ width: `${((status?.starterCount ?? 0) / 8) * 100}%` }}
                />
              </div>
              <span className="text-[8px] text-muted-foreground">{status?.starterCount ?? 0}/8</span>
            </div>
            {/* Players */}
            <div className="space-y-0 max-h-[80px] overflow-y-auto">
              {teamMockPlayers.slice(0, 8).map((mp) => (
                <div key={mp.overallPick} className="flex items-center gap-0.5 truncate">
                  <span className={cn(
                    "text-[7px] font-bold w-[14px] text-center rounded",
                    POSITION_BG_CLASSES[mp.playerPosition] ?? ""
                  )}>
                    {mp.playerPosition[0]}
                  </span>
                  <span className="truncate">{mp.playerName}</span>
                </div>
              ))}
              {teamMockPlayers.length > 8 && (
                <span className="text-muted-foreground">+{teamMockPlayers.length - 8} more</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
