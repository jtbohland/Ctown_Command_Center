import { useMemo, useState, memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getTeamEmoji } from "@/lib/draft-constants";

interface DraftCapitalRow {
  id: number;
  year: number;
  round: number;
  original_team_id: number;
  current_team_id: number;
  original_team_name: string;
  current_team_name: string;
}

interface Team {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
  is_my_team?: boolean;
}

interface Props {
  draftCapital: DraftCapitalRow[];
  teams: Team[];
}

// ─── Constants ──────────────────────────────────────────────
const TOTAL_ROUNDS = 11;
const FUTURE_YEARS_END = 2035;

// ─── Draft Order Row ────────────────────────────────────────
const DraftOrderRow = memo(function DraftOrderRow({
  pick,
  teams,
  myTeamId,
}: {
  pick: DraftCapitalRow;
  teams: Team[];
  myTeamId: number | null;
}) {
  const ownerTeam = teams.find((t) => t.id === pick.current_team_id);
  const originalTeam = teams.find((t) => t.id === pick.original_team_id);
  const isTraded = pick.current_team_id !== pick.original_team_id;
  const isMine = ownerTeam?.id === myTeamId;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm ${
        isMine ? "bg-primary/10 border border-primary/30" : ""
      }`}
    >
      {/* Pick number */}
      <span className="text-[10px] font-mono text-muted-foreground w-7 text-right shrink-0">
        {pick.round}.{String(Math.ceil(pick.id % 100) || 1).padStart(2, "0")}
      </span>

      {/* Team color dot */}
      {ownerTeam && (
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-white/10"
          style={{ backgroundColor: ownerTeam.color }}
        />
      )}

      {/* Team name */}
      <span className={`text-xs flex-1 truncate ${isMine ? "font-bold text-primary" : ""}`}>
        {ownerTeam ? `${getTeamEmoji(ownerTeam.team_name)} ${ownerTeam.team_name}` : "Unknown"}
      </span>

      {/* Traded indicator */}
      {isTraded && originalTeam && (
        <span className="text-[9px] text-amber-400 shrink-0">
          via {getTeamEmoji(originalTeam.team_name)} {originalTeam.team_name.split(" ")[0]}
        </span>
      )}
    </div>
  );
});

export default function DraftCapitalView({ draftCapital, teams }: Props) {
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [trackerRound, setTrackerRound] = useState<number | "all">("all");

  const myTeamId = useMemo(() => teams.find((t) => t.is_my_team)?.id ?? null, [teams]);

  // Build complete year list from data + future years through 2035
  const years = useMemo(() => {
    const s = new Set(draftCapital.map((dc) => dc.year));
    // Ensure future years up to 2035 are always present
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y <= FUTURE_YEARS_END; y++) {
      s.add(y);
    }
    return Array.from(s).sort();
  }, [draftCapital]);

  const filtered = useMemo(() => {
    if (yearFilter === "all") return draftCapital;
    return draftCapital.filter((dc) => dc.year === Number(yearFilter));
  }, [draftCapital, yearFilter]);

  // For future years without data, generate virtual "full" capital
  const virtualCapital = useMemo(() => {
    if (yearFilter === "all") return [];
    const yr = Number(yearFilter);
    const existingForYear = draftCapital.filter((dc) => dc.year === yr);
    if (existingForYear.length > 0) return []; // data exists, don't virtualize

    // Generate full slate: every team owns all their picks
    const virtual: DraftCapitalRow[] = [];
    let fakeId = -1;
    for (const team of teams) {
      for (let round = 1; round <= TOTAL_ROUNDS; round++) {
        virtual.push({
          id: fakeId--,
          year: yr,
          round,
          original_team_id: team.id,
          current_team_id: team.id,
          original_team_name: team.team_name,
          current_team_name: team.team_name,
        });
      }
    }
    return virtual;
  }, [yearFilter, draftCapital, teams]);

  const allPicks = useMemo(() => [...filtered, ...virtualCapital], [filtered, virtualCapital]);

  // Group by team → what picks they own (sorted alphabetically by manager name)
  const byTeam = useMemo(() => {
    const map = new Map<number, { team: Team; picks: DraftCapitalRow[] }>();
    for (const team of teams) {
      map.set(team.id, { team, picks: [] });
    }
    for (const dc of allPicks) {
      const entry = map.get(dc.current_team_id);
      if (entry) {
        entry.picks.push(dc);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.team.manager_name.localeCompare(b.team.manager_name)
    );
  }, [allPicks, teams]);

  // Draft tracker: ordered picks for the selected year
  const trackerPicks = useMemo(() => {
    if (yearFilter === "all") return [];
    const yr = Number(yearFilter);
    // Build pick order: round × team (by draft_position or team id)
    const sortedTeams = [...teams].sort((a, b) => a.id - b.id);
    const picks: DraftCapitalRow[] = [];
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      for (const team of sortedTeams) {
        // Find who owns this pick
        const pick = allPicks.find(
          (p) => p.year === yr && p.round === round && p.original_team_id === team.id
        );
        if (pick) {
          picks.push(pick);
        }
      }
    }
    return picks;
  }, [yearFilter, allPicks, teams]);

  const trackerRounds = useMemo(() => {
    const r = new Set(trackerPicks.map((p) => p.round));
    return Array.from(r).sort((a, b) => a - b);
  }, [trackerPicks]);

  const filteredTrackerPicks = useMemo(() => {
    if (trackerRound === "all") return trackerPicks;
    return trackerPicks.filter((p) => p.round === trackerRound);
  }, [trackerPicks, trackerRound]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold">💰 Draft Banks</h3>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="h-7 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className={yearFilter !== "all" ? "grid grid-cols-[1fr_280px] gap-4" : ""}>
        {/* Team Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {byTeam.map(({ team, picks }) => {
            const ownPicks = picks.filter((p) => p.original_team_id === team.id);
            const acquiredPicks = picks.filter((p) => p.original_team_id !== team.id);
            const tradedAway = allPicks.filter(
              (dc) => dc.original_team_id === team.id && dc.current_team_id !== team.id
            );
            const isMyTeam = team.id === myTeamId;

            return (
              <div
                key={team.id}
                className={`border rounded-lg p-3 ${
                  isMyTeam ? "border-primary/50 bg-primary/5 ring-1 ring-primary/20" : "border-border"
                }`}
                style={{ borderTopColor: team.color, borderTopWidth: 3 }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm">{getTeamEmoji(team.team_name)}</span>
                  <span className="text-sm font-semibold">{team.team_name}</span>
                  <span className="text-xs text-muted-foreground">{team.manager_name}</span>
                  {isMyTeam && (
                    <Badge className="ml-auto text-[9px] px-1.5 bg-primary/20 text-primary border-primary/30 border">
                      🫵🏼 Your Team
                    </Badge>
                  )}
                </div>

                {/* Own picks */}
                {ownPicks.length > 0 && (
                  <div className="mb-1">
                    <div className="text-[10px] text-muted-foreground font-medium mb-0.5">Own Picks</div>
                    <div className="flex flex-wrap gap-1">
                      {ownPicks.map((p) => (
                        <Badge key={p.id} variant="secondary" className="text-[10px] px-1.5">
                          {p.year} Rd{p.round}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Acquired picks */}
                {acquiredPicks.length > 0 && (
                  <div className="mb-1">
                    <div className="text-[10px] text-emerald-400 font-medium mb-0.5">+ Acquired</div>
                    <div className="flex flex-wrap gap-1">
                      {acquiredPicks.map((p) => (
                        <Badge key={p.id} variant="outline" className="text-[10px] px-1.5 border-emerald-500/30 text-emerald-400">
                          {p.year} Rd{p.round} (from {p.original_team_name})
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Traded away */}
                {tradedAway.length > 0 && (
                  <div>
                    <div className="text-[10px] text-red-400 font-medium mb-0.5">- Traded Away</div>
                    <div className="flex flex-wrap gap-1">
                      {tradedAway.map((p) => (
                        <Badge key={p.id} variant="outline" className="text-[10px] px-1.5 border-red-500/30 text-red-400 line-through">
                          {p.year} Rd{p.round} → {p.current_team_name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {picks.length === 0 && tradedAway.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">No picks in this range</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Draft Tracker (visible when a specific year is selected) */}
        {yearFilter !== "all" && (
          <div className="flex flex-col border border-border rounded-lg overflow-hidden bg-card/30">
            {/* Tracker Header */}
            <div className="px-4 pt-4 pb-3 border-b border-border space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Draft Order
                </h2>
                <span className="text-xs text-muted-foreground">
                  {yearFilter} • {trackerPicks.length} picks
                </span>
              </div>

              {/* Round tabs */}
              <div className="flex items-center gap-1 flex-wrap">
                <Button
                  variant={trackerRound === "all" ? "default" : "ghost"}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setTrackerRound("all")}
                >
                  All
                </Button>
                {trackerRounds.map((r) => (
                  <Button
                    key={r}
                    variant={trackerRound === r ? "default" : "ghost"}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setTrackerRound(r)}
                  >
                    R{r}
                  </Button>
                ))}
              </div>
            </div>

            {/* Picks list */}
            <ScrollArea className="flex-1 min-h-0 max-h-[600px]">
              <div className="p-2 space-y-0.5">
                {filteredTrackerPicks.map((pick, idx) => (
                  <DraftOrderRow
                    key={`${pick.year}-${pick.round}-${pick.original_team_id}-${idx}`}
                    pick={pick}
                    teams={teams}
                    myTeamId={myTeamId}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
