import { useState, useCallback, useMemo, useRef } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useApi } from "@/hooks/useApi";
import { queryClient } from "@superblocksteam/library";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
import { getTeamEmoji } from "@/lib/draft-constants";
import seasonXxLogo from "@/public/logos/season-xx.png";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      if (fileInputRef.current) fileInputRef.current.value = "";
      await queryClient.invalidateQueries("GetPlayers");
    } catch (error) {
      const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
      toast.error("Upload failed: " + message);
    }
  }, [selectedFile, uploadPlayers, uploadMode]);

  const keeperCount = useMemo(() => players.filter((p) => p.is_keeper).length, [players]);

  // ── Build future-year draft tracker from draft capital ────
  const futurePicksByRound = useMemo(() => {
    if (!isFutureYear) return new Map<number, typeof draftCapital>();
    const filtered = draftCapital.filter((dc) => dc.year === selectedYear);
    const byRound = new Map<number, typeof draftCapital>();
    for (const dc of filtered) {
      const arr = byRound.get(dc.round) ?? [];
      arr.push(dc);
      byRound.set(dc.round, arr);
    }
    return byRound;
  }, [draftCapital, selectedYear, isFutureYear]);

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
  // FUTURE YEAR — Same layout as current year, but empty +
  // draft tracker showing pick ownership from draft capital
  // ─────────────────────────────────────────────────────────
  if (isFutureYear) {
    const totalRounds = 11;
    const roundNumbers = Array.from({ length: totalRounds }, (_, i) => i + 1);

    return (
      <div className="flex flex-col h-full bg-background overflow-hidden">
        {/* Compact Header */}
        <DraftRoomHeader selectedYear={selectedYear} onYearChange={setSelectedYear} />

        {/* View Tabs (disabled for future) */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-card/50">
          <Button variant="secondary" size="sm" className="h-7 text-xs px-3">🏈 Draft Board</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-3 opacity-40 cursor-not-allowed">👥 All Rosters</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-3 opacity-40 cursor-not-allowed">📊 Recap</Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-3 opacity-40 cursor-not-allowed">🔮 Mock Draft</Button>
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground/60">Unlocks pre-season {selectedYear}</span>
        </div>

        {/* Board + Tracker layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Empty board area */}
          <div className="flex-1 overflow-auto p-5">
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="text-5xl mb-4 opacity-40">🏈</span>
              <h3 className="text-lg font-bold text-muted-foreground/60 mb-1">
                {selectedYear} Draft Board
              </h3>
              <p className="text-xs text-muted-foreground/40 max-w-sm">
                The draft board will populate once ADP rankings are uploaded for the {selectedYear} season.
                Use the pick tracker on the right to see current pick ownership.
              </p>
            </div>

            {/* Draft Capital banks below the empty board */}
            <div className="mt-4">
              <DraftCapitalView
                draftCapital={draftCapital}
                teams={teams}
              />
            </div>
          </div>

          {/* Pick Tracker — populated from draft capital */}
          <div className="w-[320px] border-l border-border overflow-auto shrink-0 bg-card/30">
            <div className="px-3 py-2 border-b border-border/50 sticky top-0 bg-card/80 backdrop-blur-sm z-10">
              <div className="text-xs font-bold">📋 {selectedYear} Pick Tracker</div>
              <div className="text-[10px] text-muted-foreground">
                {futurePicksByRound.size > 0
                  ? `${Array.from(futurePicksByRound.values()).reduce((s, arr) => s + arr.length, 0)} picks across ${futurePicksByRound.size} rounds`
                  : "No draft capital data for this year"}
              </div>
            </div>
            <div className="p-2 space-y-3">
              {roundNumbers.map((round) => {
                const roundPicks = futurePicksByRound.get(round) ?? [];
                if (roundPicks.length === 0) return null;
                return (
                  <div key={round}>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
                      Round {round}
                    </div>
                    <div className="space-y-0.5">
                      {roundPicks.map((dc) => {
                        const owner = teams.find((t) => t.id === dc.current_team_id);
                        const original = teams.find((t) => t.id === dc.original_team_id);
                        const isTraded = dc.current_team_id !== dc.original_team_id;
                        const isMine = owner?.is_my_team;
                        return (
                          <div
                            key={dc.id}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm ${
                              isMine ? "bg-primary/10 border border-primary/30" : ""
                            }`}
                          >
                            <span className="text-[10px] font-mono text-muted-foreground w-5 text-right shrink-0">
                              {round}.
                            </span>
                            {owner && (
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
                                style={{ backgroundColor: owner.color }}
                              />
                            )}
                            <span className={`text-xs flex-1 truncate ${isMine ? "font-bold text-primary" : ""}`}>
                              {owner ? `${getTeamEmoji(owner.team_name)} ${owner.team_name}` : "TBD"}
                            </span>
                            {isTraded && original && (
                              <span className="text-[9px] text-amber-400 shrink-0">
                                via {getTeamEmoji(original.team_name)} {original.team_name.split(" ")[0]}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {futurePicksByRound.size === 0 && (
                <div className="flex flex-col items-center py-8 text-center">
                  <span className="text-2xl mb-2 opacity-30">📋</span>
                  <p className="text-xs text-muted-foreground/50">No pick data yet for {selectedYear}</p>
                </div>
              )}
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
      {/* Compact Header with year selector */}
      <DraftRoomHeader selectedYear={selectedYear} onYearChange={setSelectedYear} />

      {/* Status Bar */}
      {selectedYear === CURRENT_DRAFT_YEAR && (
        <DraftStatusBar picks={picks} teams={teams} players={players} />
      )}

      {/* View Toggle Strip */}
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border bg-card/50">
        <Button variant={draftView === "board" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-3" onClick={() => setDraftView("board")}>
          🏈 Draft Board
        </Button>
        <Button variant={draftView === "rosters" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-3" onClick={() => setDraftView("rosters")}>
          👥 All Rosters
        </Button>
        <Button variant={draftView === "recap" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-3" onClick={() => setDraftView("recap")}>
          📊 Recap
        </Button>
        <Button variant={draftView === "mock" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-3" onClick={() => setDraftView("mock")}>
          🔮 Mock Draft
        </Button>

        <div className="w-px h-5 bg-border/50 mx-1" />

        {/* CSV upload — clean inline bar */}
        {draftView === "board" && (
          <div className="flex items-center gap-1.5">
            {(["players", "dynasty", "rookie"] as const).map((mode) => (
              <Button
                key={mode}
                variant={uploadMode === mode ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => {
                  setUploadMode(mode);
                  setSelectedFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              >
                {mode === "players" ? "📋 ADP" : mode === "dynasty" ? "👑 Dynasty" : "🍼 Rookie"}
              </Button>
            ))}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="hidden"
              id="draft-csv-upload"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => fileInputRef.current?.click()}
            >
              📂 {selectedFile ? selectedFile.name.slice(0, 20) : "Choose CSV"}
            </Button>
            {selectedFile && (
              <Button size="sm" className="h-7 text-xs px-3" onClick={handleUpload} disabled={uploading}>
                {uploading ? "Uploading…" : "⬆️ Upload"}
              </Button>
            )}
          </div>
        )}

        <div className="flex-1" />

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
              📋 Tracker
            </Button>
            <Button variant={sidePanel === "watchlist" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setSidePanel("watchlist")}>
              👁️ Watchlist
            </Button>
            <Button variant={sidePanel === "rivals" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setSidePanel("rivals")}>
              ⚔️ Rivals
            </Button>
            <Button variant={sidePanel === "roster" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setSidePanel("roster")}>
              🏠 My Roster
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

// ─── Compact Draft Room Header ──────────────────────────────
// Uses league logo + "Season XX · Est. 2006" — no duplicate branding
function DraftRoomHeader({ selectedYear, onYearChange }: { selectedYear: number; onYearChange: (y: number) => void }) {
  return (
    <div className="flex items-center gap-3 px-5 py-2 border-b border-border bg-card">
      <img src={seasonXxLogo} alt="Season XX" className="w-8 h-8 rounded-lg object-contain" />
      <div className="flex-1">
        <div className="text-sm font-bold leading-none">Draft Room</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Season XX · Est. 2006</div>
      </div>
      <Select value={String(selectedYear)} onValueChange={(v) => onYearChange(Number(v))}>
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {YEARS.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y} {y === CURRENT_DRAFT_YEAR ? "✓" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
