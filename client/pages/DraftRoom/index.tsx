import { useState, useCallback, useMemo, useRef } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useApi } from "@/hooks/useApi";
import { queryClient } from "@superblocksteam/library";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
import type { TagKey, Player } from "@/lib/draft-constants";
import { getTeamEmoji } from "@/lib/draft-constants";
import { CURRENT_SEASON, getSeasonPhaseInfo } from "@/lib/valuation/valuation-spec";
import seasonXxLogo from "@/public/logos/season-xx.png";

// ─── Constants ──────────────────────────────────────────────
const CURRENT_DRAFT_YEAR = 2026;
const FUTURE_YEAR_END = 2030;
const YEARS = Array.from(
  { length: FUTURE_YEAR_END - CURRENT_DRAFT_YEAR + 1 },
  (_, i) => CURRENT_DRAFT_YEAR + i,
);

const PHASE_LABEL: Record<string, string> = {
  preseason: "Preseason",
  early: "Early Season",
  mid: "Mid Season",
  late: "Late Season",
  postseason: "Postseason",
};
const PHASE_COLOR: Record<string, string> = {
  preseason: "text-zinc-400 bg-zinc-500/10 border-zinc-500/30",
  early: "text-sky-400 bg-sky-500/10 border-sky-500/30",
  mid: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  late: "text-orange-400 bg-orange-500/10 border-orange-500/30",
  postseason: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
};

type DraftView = "board" | "rosters" | "recap" | "mock";
type SidePanel = "tracker" | "watchlist" | "roster" | "rivals";

export default function DraftRoom() {
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_DRAFT_YEAR);

  // ── Data loading ──────────────────────────────────────────
  const { data: playersData, loading: playersLoading, fetching: playersFetching } = useApiData("GetPlayers", {});
  const { data: teamsData, loading: teamsLoading } = useApiData("GetTeams", {});
  const { data: picksData, loading: picksLoading, fetching: picksFetching } = useApiData("GetDraftPicks", {});
  const { data: tradeData } = useApiData("GetTradeData", {});
  const { data: actualsData } = useApiData("GetLoadedActualSeasons", {}, { staleTime: 60_000 });

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
  const completedCount = useMemo(() => picks.filter((p) => p.is_complete).length, [picks]);
  const availableCount = players.length - players.filter((p) => p.is_drafted).length;

  const isFutureYear = selectedYear > CURRENT_DRAFT_YEAR;
  const isLiveYear = selectedYear === CURRENT_DRAFT_YEAR && !isDraftComplete;

  // Season phase
  const phaseInfo = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return getSeasonPhaseInfo(today, CURRENT_SEASON);
  }, []);
  const currentActualsWeek = useMemo(() => {
    if (!actualsData?.seasons) return null;
    const s = actualsData.seasons.find((s: { season: string }) => s.season === CURRENT_SEASON);
    return s?.throughWeek ?? null;
  }, [actualsData]);

  // Draft grade
  const draftGrade = useMemo(() => {
    if (!myTeam) return null;
    const myDrafted = players.filter(
      (p) => p.is_drafted && p.drafted_team_id === myTeam.id && !p.is_keeper && p.adp_rank != null && p.drafted_pick != null
    );
    if (myDrafted.length === 0) return null;
    const totalValue = myDrafted.reduce((sum, p) => sum + ((p.adp_rank ?? 0) - (p.drafted_pick ?? 0)), 0);
    return { total: totalValue, picks: myDrafted.length };
  }, [players, myTeam]);

  // ── Handlers ──────────────────────────────────────────────
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

  // ── CSV upload ────────────────────────────────────────────
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

  const triggerUpload = useCallback((mode: "players" | "dynasty" | "rookie") => {
    setUploadMode(mode);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    // Small delay so state updates before click
    setTimeout(() => fileInputRef.current?.click(), 50);
  }, []);

  const keeperCount = useMemo(() => players.filter((p) => p.is_keeper).length, [players]);

  // ── Future-year pick tracker data ─────────────────────────
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
        <div className="h-12 border-b border-border bg-card" />
        <div className="flex-1 p-4 space-y-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════
  //  RENDER
  // ═════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">

      {/* ── ROW 1: Consolidated Header ────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-card">
        {/* League branding */}
        <img src={seasonXxLogo} alt="Season XX" className="w-8 h-8 rounded-lg object-contain shrink-0" />
        <div className="shrink-0">
          <div className="text-sm font-bold leading-none">Draft Room</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Season XX · Est. 2006</div>
        </div>

        <div className="w-px h-7 bg-border/50" />

        {/* Draft status (current year only) */}
        {!isFutureYear && (
          <>
            {isDraftComplete ? (
              <span className="text-xs text-muted-foreground shrink-0">✅ Draft complete</span>
            ) : currentPick ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="w-2.5 h-2.5 rounded-full ring-1 ring-white/20 animate-pulse shrink-0"
                  style={{ backgroundColor: teams.find((t) => t.id === currentPick.team_id)?.color }} />
                <span className={cn("text-xs font-semibold", currentPick.is_my_team && "text-primary")}>
                  {getTeamEmoji(teams.find((t) => t.id === currentPick.team_id)?.team_name ?? "")}
                  {" "}{teams.find((t) => t.id === currentPick.team_id)?.team_name ?? ""}
                  {currentPick.is_my_team && " (YOU)"}
                </span>
                <span className="text-[10px] font-mono text-muted-foreground bg-secondary px-1 py-0.5 rounded">
                  R{currentPick.round}.{String(currentPick.pick_in_round).padStart(2, "0")}
                </span>
              </div>
            ) : null}

            <div className="w-px h-7 bg-border/50" />

            {/* Progress */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs font-mono font-semibold">{completedCount}/{picks.length}</span>
              <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full transition-all duration-500"
                  style={{ width: `${picks.length > 0 ? (completedCount / picks.length) * 100 : 0}%` }} />
              </div>
            </div>

            {/* Available */}
            <span className="text-[10px] text-muted-foreground shrink-0">{availableCount} avail</span>

            {/* Draft Grade */}
            {draftGrade && (
              <>
                <div className="w-px h-7 bg-border/50" />
                <span className={cn(
                  "text-xs font-bold font-mono shrink-0",
                  draftGrade.total > 0 ? "text-green-400" : draftGrade.total < 0 ? "text-red-400" : "text-muted-foreground"
                )}>
                  {draftGrade.total > 0 ? "+" : ""}{draftGrade.total}
                  <span className="text-[10px] text-muted-foreground font-normal ml-0.5">({draftGrade.picks}pk)</span>
                </span>
              </>
            )}
          </>
        )}

        {isFutureYear && (
          <span className="text-xs text-muted-foreground/60 shrink-0">Upload ADP to start</span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Season Phase Badge */}
        <div className={cn(
          "flex items-center gap-1 rounded-md border px-2 py-0.5 shrink-0",
          PHASE_COLOR[phaseInfo.seasonPhase] ?? PHASE_COLOR.preseason,
        )}>
          <div>
            <div className="text-[9px] uppercase tracking-wider font-medium leading-none opacity-70">{CURRENT_SEASON}</div>
            <div className="text-[10px] font-bold leading-tight">
              {PHASE_LABEL[phaseInfo.seasonPhase] ?? "Preseason"}
              {currentActualsWeek != null && currentActualsWeek > 0 && (
                <span className="font-normal opacity-80"> · Wk {currentActualsWeek}</span>
              )}
            </div>
          </div>
        </div>

        {/* CSV Upload Dropdown */}
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2.5 shrink-0">
              📤 Upload CSV
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => triggerUpload("players")}>📋 ADP Rankings</DropdownMenuItem>
            <DropdownMenuItem onClick={() => triggerUpload("dynasty")}>👑 Dynasty Rankings</DropdownMenuItem>
            <DropdownMenuItem onClick={() => triggerUpload("rookie")}>🍼 Rookie Rankings</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {selectedFile && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{selectedFile.name}</span>
            <Button size="sm" className="h-6 text-[10px] px-2" onClick={handleUpload} disabled={uploading}>
              {uploading ? "..." : "⬆️ Upload"}
            </Button>
            <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1" onClick={() => { setSelectedFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
              ✕
            </Button>
          </div>
        )}

        {/* Year Selector */}
        <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
          <SelectTrigger className="h-7 w-24 text-xs shrink-0">
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

      {/* ── ROW 2: Tab Strip ─────────────────────────────── */}
      <div className="flex items-center gap-1 px-4 py-1 border-b border-border/50 bg-card/30">
        {([
          { key: "board" as const, label: "🏈 Draft Board" },
          { key: "rosters" as const, label: "👥 All Rosters" },
          { key: "recap" as const, label: "📊 Recap" },
          { key: "mock" as const, label: "🔮 Mock Draft" },
        ] as const).map((tab) => (
          <Button
            key={tab.key}
            variant={draftView === tab.key ? "secondary" : "ghost"}
            size="sm"
            className={cn("h-7 text-xs px-3", isFutureYear && tab.key !== "board" && "opacity-40 cursor-not-allowed")}
            onClick={() => { if (!isFutureYear || tab.key === "board") setDraftView(tab.key); }}
          >
            {tab.label}
          </Button>
        ))}

        <div className="flex-1" />

        {/* Pick Timer (board view, live draft only) */}
        {draftView === "board" && isLiveYear && (
          <PickTimer
            isMyPick={isMyPick}
            currentPickId={currentPick?.id ?? null}
            currentOverallPick={currentPick?.overall_pick ?? 0}
            onFirstPickStart={handleFirstPickStart}
          />
        )}
      </div>

      {/* ── CONTENT ──────────────────────────────────────── */}
      {isFutureYear ? (
        <FutureYearBoard
          selectedYear={selectedYear}
          draftCapital={draftCapital}
          teams={teams}
          futurePicksByRound={futurePicksByRound}
        />
      ) : draftView === "mock" ? (
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
        /* Board View — PlayerBoard + Side Panel */
        <div className="flex-1 flex flex-col overflow-hidden">
          {isLiveYear && (
            <SmartSuggestions
              players={players} myTeam={myTeam} isMyPick={isMyPick}
              currentOverallPick={currentPick?.overall_pick ?? 1}
              onDraft={handleDraft} teams={teams} picks={picks}
            />
          )}
          <div className="flex-1 flex overflow-hidden">
            {/* Player Board */}
            <div className={`flex-1 border-r border-border overflow-hidden ${playersFetching ? "opacity-70" : ""}`}>
              <PlayerBoard
                players={players} onDraft={handleDraft} onToggleTag={handleToggleTag}
                onRemove={handleRemovePlayer} onWriteInCreated={handleWriteInCreated}
                onTradeAlert={() => setTradeModalOpen(true)}
                currentOverallPick={currentPick?.overall_pick ?? 1}
                keeperCount={keeperCount}
              />
            </div>

            {/* Side Panel with its own tab switcher */}
            <div className={`w-[320px] flex flex-col overflow-hidden shrink-0 ${picksFetching && sidePanel === "tracker" ? "opacity-70" : ""}`}>
              {/* Side panel tabs */}
              <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/50 bg-card/50 shrink-0">
                {([
                  { key: "tracker" as const, label: "📋 Tracker" },
                  { key: "watchlist" as const, label: "👁️ Watch" },
                  { key: "rivals" as const, label: "⚔️ Rivals" },
                  { key: "roster" as const, label: "🏠 Roster" },
                ] as const).map((tab) => (
                  <Button
                    key={tab.key}
                    variant={sidePanel === tab.key ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => setSidePanel(tab.key)}
                  >
                    {tab.label}
                  </Button>
                ))}
              </div>
              {/* Side panel content */}
              <div className="flex-1 overflow-hidden">
                {sidePanel === "tracker" && <DraftTracker picks={picks} onUndoPick={handleUndoPick} currentPickId={currentPick?.id ?? null} teamKeepers={teamKeepers} />}
                {sidePanel === "watchlist" && <Watchlist players={players} onDraft={handleDraft} onToggleTag={handleToggleTag} />}
                {sidePanel === "rivals" && <RivalNeedTracker players={players} teams={teams} />}
                {sidePanel === "roster" && <MyRoster players={players} myTeam={myTeam} picks={picks} />}
              </div>
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

// ─── Future Year Board ──────────────────────────────────────
// Same board + tracker layout as current year but empty/blank.
// No Treasury or Draft Banks — just a clean slate ready for ADP upload.
function FutureYearBoard({
  selectedYear,
  draftCapital,
  teams,
  futurePicksByRound,
}: {
  selectedYear: number;
  draftCapital: any[];
  teams: any[];
  futurePicksByRound: Map<number, any[]>;
}) {
  const totalRounds = 11;
  const roundNumbers = Array.from({ length: totalRounds }, (_, i) => i + 1);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Empty board area — mimics the PlayerBoard layout */}
      <div className="flex-1 flex flex-col overflow-hidden border-r border-border">
        {/* Fake board header row */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border/50 bg-card/20">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Player Board</span>
          <span className="text-[10px] text-muted-foreground/50">0 / 0</span>
          <div className="flex-1" />
        </div>
        {/* Fake filter row */}
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-border/30">
          <div className="h-8 w-64 rounded-md border border-border/30 bg-muted/10" />
          <div className="flex gap-1">
            {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
              <div key={pos} className="h-6 w-10 rounded-md border border-border/20 bg-muted/5 flex items-center justify-center">
                <span className="text-[10px] text-muted-foreground/30 font-semibold">{pos}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Empty rows */}
        <div className="flex-1 overflow-auto p-2">
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="text-4xl mb-3 opacity-30">🏈</span>
            <h3 className="text-base font-bold text-muted-foreground/50 mb-1">
              {selectedYear} Draft Board
            </h3>
            <p className="text-xs text-muted-foreground/40 max-w-xs">
              Upload ADP rankings to populate this board. Once loaded, you can run mock drafts and prepare for draft day.
            </p>
          </div>
          {/* Ghost rows to give the feel of an empty board */}
          <div className="space-y-1 mt-2 max-w-3xl mx-auto">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/10 bg-muted/5">
                <span className="text-[10px] font-mono text-muted-foreground/20 w-6 text-right">{i + 1}</span>
                <div className="h-3 w-24 rounded bg-muted/10" />
                <div className="h-3 w-8 rounded bg-muted/10" />
                <div className="flex-1" />
                <div className="h-3 w-12 rounded bg-muted/10" />
                <div className="h-3 w-12 rounded bg-muted/10" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pick Tracker — populated from draft capital */}
      <div className="w-[320px] flex flex-col overflow-hidden shrink-0">
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-border/50 bg-card/50 shrink-0">
          <span className="text-[10px] font-bold px-2">📋 {selectedYear} Pick Tracker</span>
          <div className="flex-1" />
          <span className="text-[10px] text-muted-foreground">
            {futurePicksByRound.size > 0
              ? `${Array.from(futurePicksByRound.values()).reduce((s, arr) => s + arr.length, 0)} picks`
              : ""}
          </span>
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-3">
          {roundNumbers.map((round) => {
            const roundPicks = futurePicksByRound.get(round) ?? [];
            if (roundPicks.length === 0) return null;
            return (
              <div key={round}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1">
                  Round {round}
                </div>
                <div className="space-y-0.5">
                  {roundPicks.map((dc: any) => {
                    const owner = teams.find((t: any) => t.id === dc.current_team_id);
                    const original = teams.find((t: any) => t.id === dc.original_team_id);
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
  );
}
