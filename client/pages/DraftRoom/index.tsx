import { useState, useCallback, useMemo, useRef } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useApi } from "@/hooks/useApi";
import { queryClient } from "@superblocksteam/library";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import DraftStatusBar from "@/components/draft/DraftStatusBar";
import PlayerBoard from "@/components/draft/PlayerBoard";
import DraftTracker from "@/components/draft/DraftTracker";
import MyRoster from "@/components/draft/MyRoster";
import SmartSuggestions from "@/components/draft/SmartSuggestions";
import Watchlist from "@/components/draft/Watchlist";
import AllTeamRosters from "@/components/draft/AllTeamRosters";
import RivalNeedTracker from "@/components/draft/RivalNeedTracker";
import PickTimer from "@/components/draft/PickTimer";
import DraftRecap from "@/components/draft/DraftRecap";
import MockDraftTab from "@/components/draft/MockDraftTab";
import DraftPickDialog from "@/components/draft/DraftPickDialog";
import DraftDayTradeModal from "@/components/draft/DraftDayTradeModal";
import DraftCelebration from "@/components/draft/DraftCelebration";
import DraftCapitalView from "@/components/draft/DraftCapitalView";
import type { TagKey, Player } from "@/lib/draft-constants";

// ─── Constants ──────────────────────────────────────────────
const CURRENT_DRAFT_YEAR = 2026;
const FUTURE_YEAR_END = 2030;
const YEARS = Array.from(
  { length: FUTURE_YEAR_END - CURRENT_DRAFT_YEAR + 1 },
  (_, i) => CURRENT_DRAFT_YEAR + i,
);

type DraftView = "board" | "rosters" | "recap" | "mock";
type SidePanel = "tracker" | "watchlist" | "roster" | "rivals";

export default function DraftRoom() {
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_DRAFT_YEAR);

  // ── Data loading (same queries the old WarRoom used) ──────
  const { data: playersData, loading: playersLoading, fetching: playersFetching } = useApiData("GetPlayers", {});
  const { data: teamsData, loading: teamsLoading } = useApiData("GetTeams", {});
  const { data: picksData, loading: picksLoading, fetching: picksFetching } = useApiData("GetDraftPicks", {});
  const { data: tradeData } = useApiData("GetTradeData", {});

  const { run: draftPlayer, loading: draftingPlayer } = useApi("DraftPlayer");
  const { run: undoDraftPick } = useApi("UndoDraftPick");
  const { run: toggleTag } = useApi("TogglePlayerTag");
  const { run: manageKeeper } = useApi("ManageKeepers");
  const { run: uploadPlayers, loading: uploading } = useApi("UploadPlayers");
  const { run: redraft } = useApi("Redraft");
  const hasAutoRedraftedRef = useRef(false);

  const handleFirstPickStart = useCallback(() => {
    if (hasAutoRedraftedRef.current) return;
    hasAutoRedraftedRef.current = true;
    redraft({}).catch(() => {});
  }, [redraft]);

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftView, setDraftView] = useState<DraftView>("board");
  const [sidePanel, setSidePanel] = useState<SidePanel>("tracker");
  const [tradeModalOpen, setTradeModalOpen] = useState(false);

  const players = playersData?.players ?? [];
  const teams = teamsData?.teams ?? [];
  const picks = picksData?.picks ?? [];
  const draftCapital = tradeData?.draftCapital ?? [];

  const myTeam = useMemo(() => teams.find((t) => t.is_my_team), [teams]);

  const teamKeepers = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const p of players) {
      if (p.is_keeper && p.keeper_team_id != null) {
        const arr = map.get(p.keeper_team_id) ?? [];
        arr.push(p.position);
        map.set(p.keeper_team_id, arr);
      }
    }
    return map;
  }, [players]);

  const currentPick = useMemo(() => picks.find((p) => !p.is_complete) ?? null, [picks]);
  const isMyPick = currentPick?.is_my_team ?? false;
  const isDraftComplete = useMemo(() => picks.length > 0 && picks.every((p) => p.is_complete), [picks]);

  // ── Is this year's draft completed? ───────────────────────
  const isCompletedYear = selectedYear === CURRENT_DRAFT_YEAR && isDraftComplete;
  const isFutureYear = selectedYear > CURRENT_DRAFT_YEAR;
  const isLiveYear = selectedYear === CURRENT_DRAFT_YEAR && !isDraftComplete;

  // ── Handlers (identical to old WarRoom) ───────────────────
  const handleDraft = useCallback((playerId: number) => {
    const player = players.find((p) => p.id === playerId);
    if (player) { setSelectedPlayer(player); setDialogOpen(true); }
  }, [players]);

  const handleConfirmDraft = useCallback(async (playerId: number, pickId: number) => {
    try {
      await draftPlayer({ playerId, pickId });
      setDialogOpen(false); setSelectedPlayer(null);
      await queryClient.invalidateQueries("GetPlayers");
      await queryClient.invalidateQueries("GetDraftPicks");
      const player = players.find((p) => p.id === playerId);
      toast.success(`${player?.name ?? "Player"} drafted!`);
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
      toast.error("Draft failed: " + message);
    }
  }, [draftPlayer, players]);

  const handleUndoPick = useCallback(async (pickId: number) => {
    try {
      await undoDraftPick({ pickId });
      await queryClient.invalidateQueries("GetPlayers");
      await queryClient.invalidateQueries("GetDraftPicks");
      toast.success("Pick undone");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
      toast.error("Undo failed: " + message);
    }
  }, [undoDraftPick]);

  const handleToggleTag = useCallback(async (playerId: number, tag: TagKey) => {
    try {
      await toggleTag({ playerId, tag });
      await queryClient.invalidateQueries("GetPlayers");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
      toast.error("Tag update failed: " + message);
    }
  }, [toggleTag]);

  const handleRemovePlayer = useCallback(async (playerId: number) => {
    try {
      await toggleTag({ playerId, tag: "removed" });
      await queryClient.invalidateQueries("GetPlayers");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
      toast.error("Remove failed: " + message);
    }
  }, [toggleTag]);

  const handleSwapKeeper = useCallback(async (oldPlayerId: number, newPlayerId: number, teamId: number) => {
    try {
      const result = await manageKeeper({ action: "swap" as const, playerId: oldPlayerId, teamId, newPlayerId });
      toast.success(result?.message ?? "Keeper swapped!");
      await queryClient.invalidateQueries("GetPlayers");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
      toast.error("Swap failed: " + message);
    }
  }, [manageKeeper]);

  const handleWriteInCreated = useCallback(
    async (player: { id: number; name: string; position: string; nfl_team: string; bye_week: number | null }) => {
      await queryClient.invalidateQueries("GetPlayers");
      const asPlayer: Player = {
        id: player.id, name: player.name, position: player.position, nfl_team: player.nfl_team,
        bye_week: player.bye_week, adp_rank: null, dynasty_rank: null, positional_rank: null,
        implied_team_points: null, draft_rank: null, draft_tier: null, upside: null, bust: null,
        sos: null, age: null, dynasty_tier: null, is_keeper: false, keeper_team_id: null,
        is_drafted: false, drafted_team_id: null, drafted_round: null, drafted_pick: null,
        tags: null, is_write_in: true,
      };
      setSelectedPlayer(asPlayer); setDialogOpen(true);
    }, [],
  );

  // ── CSV upload handler (for Draft Room year-scoped uploads) ─
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<"players" | "dynasty" | "rookie">("players");

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const result = await uploadPlayers({ csvFile: { files: [selectedFile] }, mode: uploadMode } as any);
      const msg = result?.message ?? "Players imported!";
      const warns = (result as any)?.warnings as string[] | undefined;
      if (warns && warns.length > 0) {
        toast.warning(msg + "\n⚠️ " + warns.join("\n⚠️ "), { duration: 8000 });
      } else {
        toast.success(msg);
      }
      setSelectedFile(null);
      await queryClient.invalidateQueries("GetPlayers");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
      toast.error("Upload failed: " + message);
    }
  }, [selectedFile, uploadPlayers, uploadMode]);

  const keeperCount = useMemo(() => players.filter((p) => p.is_keeper).length, [players]);

  // ── Loading ──────────────────────────────────────────────
  if (playersLoading || teamsLoading || picksLoading) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="h-14 border-b border-border bg-card" />
        <div className="flex-1 flex gap-0">
          <div className="flex-1 p-4 space-y-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────
  // FUTURE YEAR — Draft Banks + Order only, locked features
  // ─────────────────────────────────────────────────────────
  if (isFutureYear) {
    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        <DraftRoomHeader
          selectedYear={selectedYear}
          onYearChange={setSelectedYear}
        />
        <div className="flex-1 overflow-auto px-5 py-4">
          {/* Draft Banks + Order for the future year */}
          <DraftCapitalView
            draftCapital={draftCapital}
            teams={teams}
            draftPicks2026={selectedYear === CURRENT_DRAFT_YEAR ? (picksData?.picks ?? []).map((p: any) => ({
              round: p.round, pick_in_round: p.pick_in_round, overall_pick: p.overall_pick,
              team_id: p.team_id, team_name: p.team_name, manager_name: p.manager_name ?? "",
              player_id: p.player_id, is_complete: p.is_complete,
            })) : undefined}
          />

          {/* Locked features */}
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Draft Board", icon: "layout-grid" as const, emoji: "🏈" },
              { label: "Recap", icon: "chart-column-big" as const, emoji: "📊" },
              { label: "Post-Draft Grades", icon: "award" as const, emoji: "🎓" },
              { label: "Mock Draft", icon: "shuffle" as const, emoji: "🔮" },
            ].map((item) => (
              <div
                key={item.label}
                className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border/50 bg-muted/20 px-4 py-6 opacity-50"
              >
                <span className="text-2xl">🔒</span>
                <span className="text-xs font-medium text-muted-foreground">{item.emoji} {item.label}</span>
                <span className="text-[10px] text-muted-foreground/60">Unlocks pre-season {selectedYear}</span>
              </div>
            ))}
          </div>

          {/* CSV uploads locked for future years */}
          <div className="mt-4 rounded-lg border border-border/50 bg-muted/10 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>🔒</span>
              <span>ADP, Dynasty, and Rookie CSV uploads will be available when Draft Room {selectedYear} is unlocked</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────
  // CURRENT YEAR (completed or live draft)
  // ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Draft Room Header with year selector */}
      <DraftRoomHeader
        selectedYear={selectedYear}
        onYearChange={setSelectedYear}
      />

      {/* Status Bar (only for current draft year) */}
      {selectedYear === CURRENT_DRAFT_YEAR && (
        <DraftStatusBar picks={picks} teams={teams} players={players} />
      )}

      {/* View Toggle Strip */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-card/50">
        <Button variant={draftView === "board" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-3" onClick={() => setDraftView("board")}>
          <Icon icon="layout-grid" className="h-3 w-3 mr-1.5" />
          Draft Board
        </Button>
        <Button variant={draftView === "rosters" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-3" onClick={() => setDraftView("rosters")}>
          <Icon icon="users" className="h-3 w-3 mr-1.5" />
          All Rosters
        </Button>
        <Button variant={draftView === "recap" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-3" onClick={() => setDraftView("recap")}>
          <Icon icon="chart-column-big" className="h-3 w-3 mr-1.5" />
          Recap
        </Button>
        <Button variant={draftView === "mock" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-3" onClick={() => setDraftView("mock")}>
          <Icon icon="shuffle" className="h-3 w-3 mr-1.5" />
          Mock Draft
        </Button>

        <div className="flex-1" />

        {/* CSV upload buttons — current draft year */}
        {draftView === "board" && (
          <div className="flex items-center gap-1 mr-3">
            {(["players", "dynasty", "rookie"] as const).map((mode) => (
              <Button
                key={mode}
                variant={uploadMode === mode ? "secondary" : "ghost"}
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setUploadMode(mode)}
              >
                {mode === "players" ? "📋 ADP" : mode === "dynasty" ? "👑 Dynasty" : "🍼 Rookie"}
              </Button>
            ))}
            <label className="cursor-pointer">
              <input type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
              <span className="inline-flex items-center h-6 px-2 text-[10px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer">
                <Icon icon="upload" className="h-3 w-3 mr-1" />
                {selectedFile ? selectedFile.name.slice(0, 20) : "Choose CSV"}
              </span>
            </label>
            {selectedFile && (
              <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleUpload} disabled={uploading}>
                {uploading ? "..." : "Upload"}
              </Button>
            )}
          </div>
        )}

        {/* Pick Timer */}
        {draftView === "board" && isLiveYear && (
          <PickTimer
            isMyPick={isMyPick}
            currentPickId={currentPick?.id ?? null}
            currentOverallPick={currentPick?.overall_pick ?? 0}
            onFirstPickStart={handleFirstPickStart}
          />
        )}

        {/* Side panel toggles */}
        {draftView === "board" && (
          <div className="flex items-center gap-1">
            <Button variant={sidePanel === "tracker" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setSidePanel("tracker")}>
              <Icon icon="list-ordered" className="h-3 w-3 mr-1" /> Tracker
            </Button>
            <Button variant={sidePanel === "watchlist" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setSidePanel("watchlist")}>
              <Icon icon="eye" className="h-3 w-3 mr-1" /> Watchlist
            </Button>
            <Button variant={sidePanel === "rivals" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setSidePanel("rivals")}>
              <Icon icon="swords" className="h-3 w-3 mr-1" /> Rivals
            </Button>
            <Button variant={sidePanel === "roster" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setSidePanel("roster")}>
              <Icon icon="user" className="h-3 w-3 mr-1" /> My Roster
            </Button>
          </div>
        )}
      </div>

      {/* Main Content */}
      {draftView === "mock" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <MockDraftTab players={players} teams={teams} picks={picks} />
        </div>
      ) : draftView === "recap" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <DraftRecap players={players} teams={teams} picks={picks} />
        </div>
      ) : draftView === "rosters" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <AllTeamRosters players={players} teams={teams} onSwapKeeper={handleSwapKeeper} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Smart Suggestions */}
          {isLiveYear && (
            <SmartSuggestions
              players={players} myTeam={myTeam} isMyPick={isMyPick}
              currentOverallPick={currentPick?.overall_pick ?? 1}
              onDraft={handleDraft} teams={teams} picks={picks}
            />
          )}

          {/* Board + Side Panel */}
          <div className="flex-1 flex overflow-hidden">
            <div className={`flex-1 border-r border-border overflow-hidden ${playersFetching ? "opacity-70" : ""}`}>
              <PlayerBoard
                players={players} onDraft={handleDraft} onToggleTag={handleToggleTag}
                onRemove={handleRemovePlayer} onWriteInCreated={handleWriteInCreated}
                onTradeAlert={() => setTradeModalOpen(true)}
                currentOverallPick={currentPick?.overall_pick ?? 1}
                keeperCount={keeperCount}
              />
            </div>
            <div className={`w-[320px] overflow-hidden shrink-0 ${picksFetching && sidePanel === "tracker" ? "opacity-70" : ""}`}>
              {sidePanel === "tracker" && <DraftTracker picks={picks} onUndoPick={handleUndoPick} currentPickId={currentPick?.id ?? null} teamKeepers={teamKeepers} />}
              {sidePanel === "watchlist" && <Watchlist players={players} onDraft={handleDraft} onToggleTag={handleToggleTag} />}
              {sidePanel === "rivals" && <RivalNeedTracker players={players} teams={teams} />}
              {sidePanel === "roster" && <MyRoster players={players} myTeam={myTeam} picks={picks} />}
            </div>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <DraftPickDialog player={selectedPlayer} picks={picks} teams={teams} open={dialogOpen} onOpenChange={setDialogOpen} onConfirm={handleConfirmDraft} loading={draftingPlayer} />
      <DraftDayTradeModal open={tradeModalOpen} onOpenChange={setTradeModalOpen} />
      <DraftCelebration isDraftComplete={isDraftComplete} onGoToRecap={() => setDraftView("recap")} />
    </div>
  );
}

// ─── Draft Room Header ──────────────────────────────────────
function DraftRoomHeader({ selectedYear, onYearChange }: { selectedYear: number; onYearChange: (y: number) => void }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-border bg-gradient-to-r from-emerald-950/30 via-card/60 to-amber-950/30">
      <span className="text-2xl">🏈</span>
      <div className="flex-1">
        <h2 className="text-lg font-extrabold tracking-tight">Draft Room</h2>
        <span className="text-[10px] text-muted-foreground">
          Year-by-year draft boards, recaps, grades & mock drafts
        </span>
      </div>
      <Select value={String(selectedYear)} onValueChange={(v) => onYearChange(Number(v))}>
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {YEARS.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y} {y === CURRENT_DRAFT_YEAR ? "✓" : y > CURRENT_DRAFT_YEAR ? "🔒" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
