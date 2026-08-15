import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useApiData } from "@/hooks/useApiData";
import { useApi } from "@/hooks/useApi";
import { queryClient } from "@superblocksteam/library";
import { toast } from "sonner";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import PositionBadge from "@/components/draft/PositionBadge";
import { getTeamEmoji } from "@/lib/draft-constants";
import ctownReduxLogo from "@/public/logos/ctown-redux.png";
import ActualsUploader from "@/components/settings/ActualsUploader";
import LeagueOfRecord from "@/components/settings/LeagueOfRecord";

export default function SettingsPage() {
  const navigate = useNavigate();
  const { data: teamsData, loading: teamsLoading } = useApiData("GetTeams", {});
  const { data: playersData, loading: playersLoading, fetching: playersFetching } = useApiData("GetPlayers", {});
  const { run: uploadPlayers, loading: uploading } = useApi("UploadPlayers");
  const { run: initDb, loading: initLoading } = useApi("InitDatabase");
  const { run: manageKeepers, loading: keeperLoading } = useApi("ManageKeepers");

  const teams = teamsData?.teams ?? [];
  const players = playersData?.players ?? [];

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadMode, setUploadMode] = useState<"players" | "keepers" | "dynasty" | "rookie" | "roster">("players");
  const [keeperTeamFilter, setKeeperTeamFilter] = useState<number | null>(null);
  const [keeperSearch, setKeeperSearch] = useState("");
  const [debouncedKeeperSearch, setDebouncedKeeperSearch] = useState("");
  const keeperSearchTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleKeeperSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setKeeperSearch(e.target.value);
    clearTimeout(keeperSearchTimer.current);
    keeperSearchTimer.current = setTimeout(() => setDebouncedKeeperSearch(e.target.value), 300);
  }, []);

  useEffect(() => () => clearTimeout(keeperSearchTimer.current), []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const result = await uploadPlayers({
        csvFile: { files: [selectedFile] },
        mode: uploadMode,
      } as any);
      toast.success(result?.message ?? "Players imported!");
      setSelectedFile(null);
      await queryClient.invalidateQueries("GetPlayers");
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      toast.error("Upload failed: " + message);
    }
  }, [selectedFile, uploadPlayers]);

  const handleInit = useCallback(async () => {
    try {
      const result = await initDb({ force: false });
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

  const keepers = players.filter((p) => p.is_keeper);
  const nonKeeperPlayers = players.filter((p) => !p.is_keeper && !p.is_drafted);

  // Filter non-keeper players with search
  const filteredNonKeepers = useMemo(() => {
    let result = nonKeeperPlayers;
    if (debouncedKeeperSearch) {
      const q = debouncedKeeperSearch.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.position.toLowerCase().includes(q) ||
          p.nfl_team.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => (a.draft_rank ?? a.adp_rank ?? 999) - (b.draft_rank ?? b.adp_rank ?? 999));
  }, [nonKeeperPlayers, debouncedKeeperSearch]);

  const handleAddKeeper = useCallback(
    async (playerId: number, teamId: number) => {
      try {
        await manageKeepers({ action: "add", playerId, teamId });
        await queryClient.invalidateQueries("GetPlayers");
        toast.success("Keeper added!");
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Keeper update failed: " + message);
      }
    },
    [manageKeepers],
  );

  const handleRemoveKeeper = useCallback(
    async (playerId: number) => {
      try {
        await manageKeepers({ action: "remove", playerId, teamId: 0 });
        await queryClient.invalidateQueries("GetPlayers");
        toast.success("Keeper removed");
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error("Keeper update failed: " + message);
      }
    },
    [manageKeepers],
  );

  const positionCounts = players.reduce(
    (acc, p) => {
      acc[p.position] = (acc[p.position] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={ctownReduxLogo} alt="C-Town Redux" className="w-12 h-12 object-contain" />
            <div>
              <h1 className="text-2xl font-bold">League Setup</h1>
              <p className="text-sm text-muted-foreground mt-1">
                C-Town Redux! Season XX &mdash; Configure teams, import players, and manage your draft
              </p>
            </div>
          </div>
          <Button onClick={() => navigate("/")} variant="default">
            <Icon icon="chevron-left" className="h-4 w-4 mr-1" />
            Back to Command Center
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Database init */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Initialize Database</CardTitle>
              <CardDescription>
                Creates tables and seeds 11 sample teams + 60 players. Safe to run multiple times.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleInit} disabled={initLoading} className="w-full">
                <Icon icon="database" className="h-4 w-4 mr-2" />
                {initLoading ? "Initializing..." : "Initialize / Reset Sample Data"}
              </Button>
            </CardContent>
          </Card>

          {/* CSV Upload */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Import CSV Data</CardTitle>
              <CardDescription>
                Upload CSVs to update rankings, add new players, or reassign keepers
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Mode selector */}
              <div className="grid grid-cols-5 gap-2">
                {([
                  { key: "players" as const, icon: "users", label: "Players /\nRankings" },
                  { key: "dynasty" as const, icon: "crown", label: "Dynasty\nRankings" },
                  { key: "keepers" as const, icon: "shield", label: "Keeper\nList" },
                  { key: "rookie" as const, icon: "baby", label: "Rookie\nRankings" },
                  { key: "roster" as const, icon: "clipboard-list", label: "Roster\nUpload" },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    className={`flex flex-col items-center justify-center gap-1 rounded-md border px-2 py-2.5 text-[11px] font-medium leading-tight text-center transition-colors ${uploadMode === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:bg-accent"}`}
                    onClick={() => setUploadMode(tab.key)}
                  >
                    <Icon icon={tab.icon} className="h-4 w-4" />
                    <span className="whitespace-pre-line">{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* Mode description */}
              <div className="text-[11px] text-muted-foreground bg-accent/30 rounded-md px-3 py-2">
                {uploadMode === "players" ? (
                  <>
                    <strong>Players/Rankings mode:</strong> Updates ADP, positional rank, and stats for existing players. New players in the CSV will be added.
                    <br />
                    <span className="text-[10px] opacity-75">
                      Columns: Rank, Player (Bye), Pos, AVG, tier, upside, bust, sos, age
                    </span>
                  </>
                ) : uploadMode === "dynasty" ? (
                  <>
                    <strong>Dynasty Rankings mode:</strong> Updates dynasty rank, dynasty tier, and age from a dynasty-specific CSV.
                    <br />
                    <span className="text-[10px] opacity-75">
                      Columns: RK, TIERS, PLAYER NAME, TEAM, POS, AGE
                    </span>
                  </>
                ) : uploadMode === "keepers" ? (
                  <>
                    <strong>Keeper mode:</strong> Bulk reassign all keepers. Clears existing and assigns new ones.
                    <br />
                    <span className="text-[10px] opacity-75">Columns: team (team name), player (player name)</span>
                  </>
                ) : uploadMode === "rookie" ? (
                  <>
                    <strong>Rookie Rankings mode:</strong> Import a rookie draft class with overall pick order, position, and age.
                    <br />
                    <span className="text-[10px] opacity-75">Columns: Rank/Pick, Player Name, Pos, Age (optional), Year (optional)</span>
                  </>
                ) : (
                  <>
                    <strong>Roster Upload mode:</strong> Assign players to team rosters via CSV. Clears existing assignments and re-applies keepers.
                    <br />
                    <span className="text-[10px] opacity-75">Columns: team (team name or manager), player (player name)</span>
                  </>
                )}
              </div>

              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
              />
              {selectedFile && (
                <div className="text-xs text-muted-foreground">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </div>
              )}
              <Button
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
                className="w-full"
              >
                <Icon icon="upload" className="h-4 w-4 mr-2" />
                {uploading ? "Processing..." : `Upload & ${uploadMode === "keepers" ? "Assign Keepers" : "Import"}`}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Teams overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">League Teams ({teams.length})</CardTitle>
            <CardDescription>
              Your 11-team dynasty league. Share your real team info to customize.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {teamsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : teams.length === 0 ? (
              <p className="text-sm text-muted-foreground">No teams yet. Initialize the database first.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {teams.map((team) => (
                  <div
                    key={team.id}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <span
                      className="w-4 h-4 rounded-full ring-1 ring-white/20 shrink-0"
                      style={{ backgroundColor: team.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {getTeamEmoji(team.team_name)} {team.team_name}
                        {team.is_my_team && (
                          <span className="ml-1.5 text-[10px] text-primary font-bold">(YOU)</span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {team.manager_name} • Pick #{team.draft_position}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Keeper Management */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Keeper Management ({keepers.length} assigned)</CardTitle>
            <CardDescription>
              Manage assumed keepers before draft day. Max 4 per team.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current Keepers by team */}
            {teams.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current Keepers</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[300px] overflow-auto">
                  {teams.map((team) => {
                    const teamKeepers = keepers.filter((p) => p.keeper_team_id === team.id);
                    return (
                      <div key={team.id} className="rounded-lg border px-3 py-2">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: team.color }} />
                          <span className="text-xs font-semibold truncate">{getTeamEmoji(team.team_name)} {team.team_name}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto">{teamKeepers.length}/4</span>
                        </div>
                        {teamKeepers.length === 0 ? (
                          <div className="text-[10px] text-muted-foreground/50 italic">No keepers</div>
                        ) : (
                          <div className="space-y-0.5">
                            {teamKeepers.map((p) => (
                              <div key={p.id} className="flex items-center gap-1.5 text-[11px]">
                                <PositionBadge position={p.position} />
                                <span className="flex-1 truncate">{p.name}</span>
                                <span className="text-[9px] text-muted-foreground font-mono shrink-0">{p.nfl_team}</span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                  onClick={() => handleRemoveKeeper(p.id)}
                                  disabled={keeperLoading}
                                >
                                  <Icon icon="x" className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add keeper */}
            {teams.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Add Keeper</h4>
                <div className="flex items-center gap-2">
                  <select
                    className="flex h-8 rounded-md border border-input bg-background px-2 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    value={keeperTeamFilter ?? ""}
                    onChange={(e) => setKeeperTeamFilter(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Select team...</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {getTeamEmoji(t.team_name)} {t.team_name} ({keepers.filter((k) => k.keeper_team_id === t.id).length}/4)
                      </option>
                    ))}
                  </select>
                </div>
                {keeperTeamFilter && (
                  <div className="space-y-2">
                    <div className="relative">
                      <Icon icon="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={keeperSearch}
                        onChange={handleKeeperSearchChange}
                        placeholder="Search by name, position, or team..."
                        className="pl-8 h-8 text-xs bg-secondary/50"
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground px-1">
                      Showing {filteredNonKeepers.length} of {nonKeeperPlayers.length} available players
                    </div>
                    <ScrollArea className="h-[300px] rounded-md border">
                      <div className="p-2 space-y-0.5">
                        {filteredNonKeepers.map((p) => (
                          <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded-sm hover:bg-accent/50 text-xs">
                            <PositionBadge position={p.position} />
                            <span className="flex-1 truncate">{p.name}</span>
                            <span className="text-muted-foreground text-[10px]">{p.nfl_team}</span>
                            <span className="text-muted-foreground text-[10px] tabular-nums w-8 text-right">#{p.draft_rank ?? p.adp_rank ?? "–"}</span>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] px-2"
                              onClick={() => handleAddKeeper(p.id, keeperTeamFilter)}
                              disabled={keeperLoading}
                            >
                              Add
                            </Button>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actuals Uploader */}
        <ActualsUploader />

        {/* The League of Record — historical CSV archive */}
        <LeagueOfRecord />

        {/* Player stats */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Player Pool ({players.length})</CardTitle>
            <CardDescription>
              {playersFetching && <span className="text-xs">Refreshing...</span>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {playersLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : players.length === 0 ? (
              <p className="text-sm text-muted-foreground">No players loaded. Upload a CSV or initialize sample data.</p>
            ) : (
              <div className="flex items-center gap-4 flex-wrap">
                {["QB", "RB", "WR", "TE"].map((pos) => (
                  <div key={pos} className="flex items-center gap-2">
                    <PositionBadge position={pos} />
                    <span className="text-sm font-medium">{positionCounts[pos] ?? 0}</span>
                  </div>
                ))}
                <div className="w-px h-6 bg-border" />
                <span className="text-sm text-muted-foreground">
                  {players.filter((p) => p.is_drafted).length} drafted
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
