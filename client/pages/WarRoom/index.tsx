import { useState, useCallback, useMemo, useRef } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useApi } from "@/hooks/useApi";
import { queryClient } from "@superblocksteam/library";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

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
import ArmChairDealer from "@/components/draft/ArmChairDealer";
import DraftPickDialog from "@/components/draft/DraftPickDialog";
import DraftDayTradeModal from "@/components/draft/DraftDayTradeModal";
import DraftCelebration from "@/components/draft/DraftCelebration";
import type { TagKey, Player } from "@/lib/draft-constants";
import ctownReduxLogo from "@/public/logos/ctown-redux.png";

type MainView = "board" | "rosters" | "recap" | "mock" | "trade";
type SidePanel = "tracker" | "watchlist" | "roster" | "rivals";

export default function WarRoom() {
  const { data: playersData, loading: playersLoading, fetching: playersFetching } = useApiData("GetPlayers", {});
  const { data: teamsData, loading: teamsLoading } = useApiData("GetTeams", {});
  const { data: picksData, loading: picksLoading, fetching: picksFetching } = useApiData("GetDraftPicks", {});

  const { run: draftPlayer, loading: draftingPlayer } = useApi("DraftPlayer");
  const { run: undoDraftPick } = useApi("UndoDraftPick");
  const { run: toggleTag } = useApi("TogglePlayerTag");
  const { run: manageKeeper } = useApi("ManageKeepers");
  const { run: initDb, loading: initLoading } = useApi("InitDatabase");
  const { run: redraft } = useApi("Redraft");
  const hasAutoRedraftedRef = useRef(false);

  const handleFirstPickStart = useCallback(() => {
    if (hasAutoRedraftedRef.current) return;
    hasAutoRedraftedRef.current = true;
    redraft({}).catch(() => {});
  }, [redraft]);

  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [mainView, setMainView] = useState<MainView>("board");
  const [sidePanel, setSidePanel] = useState<SidePanel>("tracker");
  const [tradeModalOpen, setTradeModalOpen] = useState(false);

  const players = playersData?.players ?? [];
  const teams = teamsData?.teams ?? [];
  const picks = picksData?.picks ?? [];

  const myTeam = useMemo(() => teams.find((t) => t.is_my_team), [teams]);

  // Build keeper positions map for roster completion tracking
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

  const currentPick = useMemo(() => {
    return picks.find((p) => !p.is_complete) ?? null;
  }, [picks]);

  const isMyPick = currentPick?.is_my_team ?? false;

  const isDraftComplete = useMemo(
    () => picks.length > 0 && picks.every((p) => p.is_complete),
    [picks],
  );

  const handleDraft = useCallback(
    (playerId: number) => {
      const player = players.find((p) => p.id === playerId);
      if (player) {
        setSelectedPlayer(player);
        setDialogOpen(true);
      }
    },
    [players],
  );

  const handleConfirmDraft = useCallback(
    async (playerId: number, pickId: number) => {
      try {
        await draftPlayer({ playerId, pickId });
        setDialogOpen(false);
        setSelectedPlayer(null);
        await queryClient.invalidateQueries("GetPlayers");
        await queryClient.invalidateQueries("GetDraftPicks");
        const player = players.find((p) => p.id === playerId);
        toast.success(`${player?.name ?? "Player"} drafted!`);
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Draft failed: " + message);
      }
    },
    [draftPlayer, players],
  );

  const handleUndoPick = useCallback(
    async (pickId: number) => {
      try {
        await undoDraftPick({ pickId });
        await queryClient.invalidateQueries("GetPlayers");
        await queryClient.invalidateQueries("GetDraftPicks");
        toast.success("Pick undone");
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Undo failed: " + message);
      }
    },
    [undoDraftPick],
  );

  const handleToggleTag = useCallback(
    async (playerId: number, tag: TagKey) => {
      try {
        await toggleTag({ playerId, tag });
        await queryClient.invalidateQueries("GetPlayers");
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Tag update failed: " + message);
      }
    },
    [toggleTag],
  );

  const handleRemovePlayer = useCallback(
    async (playerId: number) => {
      try {
        await toggleTag({ playerId, tag: "removed" });
        await queryClient.invalidateQueries("GetPlayers");
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Remove failed: " + message);
      }
    },
    [toggleTag],
  );

  const keeperCount = useMemo(() => players.filter((p) => p.is_keeper).length, [players]);

  const handleInitDb = useCallback(async () => {
    try {
      const result = await initDb({});
      toast.success(result?.message ?? "Database initialized!");
      await queryClient.invalidateQueries("GetPlayers");
      await queryClient.invalidateQueries("GetTeams");
      await queryClient.invalidateQueries("GetDraftPicks");
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      toast.error("Init failed: " + message);
    }
  }, [initDb]);

  const handleWriteInCreated = useCallback(
    async (player: { id: number; name: string; position: string; nfl_team: string; bye_week: number | null }) => {
      await queryClient.invalidateQueries("GetPlayers");
      // Auto-open the draft dialog for the newly created write-in player
      const asPlayer: Player = {
        id: player.id,
        name: player.name,
        position: player.position,
        nfl_team: player.nfl_team,
        bye_week: player.bye_week,
        adp_rank: null,
        dynasty_rank: null,
        positional_rank: null,
        implied_team_points: null,
        draft_rank: null,
        draft_tier: null,
        upside: null,
        bust: null,
        sos: null,
        age: null,
        dynasty_tier: null,
        is_keeper: false,
        keeper_team_id: null,
        is_drafted: false,
        drafted_team_id: null,
        drafted_round: null,
        drafted_pick: null,
        tags: null,
        is_write_in: true,
      };
      setSelectedPlayer(asPlayer);
      setDialogOpen(true);
    },
    [],
  );

  const handleSwapKeeper = useCallback(
    async (oldPlayerId: number, newPlayerId: number, teamId: number) => {
      try {
        const result = await manageKeeper({ action: "swap" as const, playerId: oldPlayerId, teamId, newPlayerId });
        toast.success(result?.message ?? "Keeper swapped!");
        await queryClient.invalidateQueries("GetPlayers");
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Swap failed: " + message);
      }
    },
    [manageKeeper],
  );

  // Loading state
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
          <div className="w-80 border-l border-border p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Empty state — need to initialize DB
  if (players.length === 0 && teams.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background gap-4">
        <img src={ctownReduxLogo} alt="C-Town Redux" className="w-24 h-24 object-contain" />
        <h1 className="text-2xl font-bold">C-Town Command Center</h1>
        <p className="text-muted-foreground text-sm max-w-md text-center">
          Initialize the database with C-Town Redux! Season XX league data to get started.
        </p>
        <Button onClick={handleInitDb} disabled={initLoading} size="lg">
          {initLoading ? "Initializing..." : "Launch Command Center"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Status Bar */}
      <DraftStatusBar picks={picks} teams={teams} players={players} />

      {/* View Toggle Strip */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-card/50">
        <Button
          variant={mainView === "board" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => setMainView("board")}
        >
          <Icon icon="layout-grid" className="h-3 w-3 mr-1.5" />
          Draft Board
        </Button>
        <Button
          variant={mainView === "rosters" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => setMainView("rosters")}
        >
          <Icon icon="users" className="h-3 w-3 mr-1.5" />
          All Rosters
        </Button>
        <Button
          variant={mainView === "recap" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => setMainView("recap")}
        >
          <Icon icon="chart-column-big" className="h-3 w-3 mr-1.5" />
          Recap
        </Button>
        <Button
          variant={mainView === "mock" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => setMainView("mock")}
        >
          <Icon icon="shuffle" className="h-3 w-3 mr-1.5" />
          Mock Draft
        </Button>
        <Button
          variant={mainView === "trade" ? "secondary" : "ghost"}
          size="sm"
          className="h-7 text-xs px-3"
          onClick={() => setMainView("trade")}
        >
          🫱🏻‍🫲🏽
          <span className="ml-1">The C-Town Exchange</span>
        </Button>

        <div className="flex-1" />

        {/* Pick Timer */}
        {mainView === "board" && (
          <PickTimer
            isMyPick={isMyPick}
            currentPickId={currentPick?.id ?? null}
            currentOverallPick={currentPick?.overall_pick ?? 0}
            onFirstPickStart={handleFirstPickStart}
          />
        )}

        {/* Side panel toggles (only when on board view) */}
        {mainView === "board" && (
          <div className="flex items-center gap-1">
            <Button
              variant={sidePanel === "tracker" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setSidePanel("tracker")}
            >
              <Icon icon="list-ordered" className="h-3 w-3 mr-1" />
              Tracker
            </Button>
            <Button
              variant={sidePanel === "watchlist" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setSidePanel("watchlist")}
            >
              <Icon icon="eye" className="h-3 w-3 mr-1" />
              Watchlist
            </Button>
            <Button
              variant={sidePanel === "rivals" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setSidePanel("rivals")}
            >
              <Icon icon="swords" className="h-3 w-3 mr-1" />
              Rivals
            </Button>
            <Button
              variant={sidePanel === "roster" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setSidePanel("roster")}
            >
              <Icon icon="user" className="h-3 w-3 mr-1" />
              My Roster
            </Button>
          </div>
        )}
      </div>

      {/* Main Content */}
      {mainView === "trade" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <ArmChairDealer />
        </div>
      ) : mainView === "mock" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <MockDraftTab players={players} teams={teams} picks={picks} />
        </div>
      ) : mainView === "recap" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <DraftRecap players={players} teams={teams} picks={picks} />
        </div>
      ) : mainView === "rosters" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <AllTeamRosters players={players} teams={teams} onSwapKeeper={handleSwapKeeper} />
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Smart Suggestions (shown when it's JT's pick) */}
          <SmartSuggestions
            players={players}
            myTeam={myTeam}
            isMyPick={isMyPick}
            currentOverallPick={currentPick?.overall_pick ?? 1}
            onDraft={handleDraft}
            teams={teams}
            picks={picks}
          />

          {/* Board + Side Panel */}
          <div className="flex-1 flex overflow-hidden">
            {/* Left Panel — Player Board */}
            <div className={`flex-1 border-r border-border overflow-hidden ${playersFetching ? "opacity-70" : ""}`}>
              <PlayerBoard
                players={players}
                onDraft={handleDraft}
                onToggleTag={handleToggleTag}
                onRemove={handleRemovePlayer}
                onWriteInCreated={handleWriteInCreated}
                onTradeAlert={() => setTradeModalOpen(true)}
                currentOverallPick={currentPick?.overall_pick ?? 1}
                keeperCount={keeperCount}
              />
            </div>

            {/* Right Panel */}
            <div className={`w-[320px] overflow-hidden shrink-0 ${picksFetching && sidePanel === "tracker" ? "opacity-70" : ""}`}>
              {sidePanel === "tracker" && (
                <DraftTracker
                  picks={picks}
                  onUndoPick={handleUndoPick}
                  currentPickId={currentPick?.id ?? null}
                  teamKeepers={teamKeepers}
                />
              )}
              {sidePanel === "watchlist" && (
                <Watchlist
                  players={players}
                  onDraft={handleDraft}
                  onToggleTag={handleToggleTag}
                />
              )}
              {sidePanel === "rivals" && (
                <RivalNeedTracker players={players} teams={teams} />
              )}
              {sidePanel === "roster" && (
                <MyRoster players={players} myTeam={myTeam} picks={picks} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Draft Pick Dialog */}
      <DraftPickDialog
        player={selectedPlayer}
        picks={picks}
        teams={teams}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConfirm={handleConfirmDraft}
        loading={draftingPlayer}
      />

      {/* Draft Day Trade Modal (SirenSale-powered) */}
      <DraftDayTradeModal
        open={tradeModalOpen}
        onOpenChange={setTradeModalOpen}
      />

      {/* Draft Complete Celebration */}
      <DraftCelebration isDraftComplete={isDraftComplete} onGoToRecap={() => setMainView("recap")} />
    </div>
  );
}
