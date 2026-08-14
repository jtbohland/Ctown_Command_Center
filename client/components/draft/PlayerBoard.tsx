import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@/components/ui/icon";
import PlayerRow from "./PlayerRow";
import WriteInModal from "./WriteInModal";
import { TAG_OPTIONS, type Player, type TagKey } from "@/lib/draft-constants";

type PlayerBoardProps = {
  players: Player[];
  onDraft: (playerId: number) => void;
  onToggleTag: (playerId: number, tag: TagKey) => void;
  onWriteInCreated?: (player: {
    id: number;
    name: string;
    position: string;
    nfl_team: string;
    bye_week: number | null;
  }) => void;
};

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;

export default function PlayerBoard({ players, onDraft, onToggleTag, onWriteInCreated }: PlayerBoardProps) {
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"adp" | "draft" | "dynasty" | "positional">("draft");
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [writeInOpen, setWriteInOpen] = useState(false);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedSearch(e.target.value), 300);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const availablePlayers = useMemo(() => {
    return players.filter((p) => !p.is_drafted);
  }, [players]);

  const filteredPlayers = useMemo(() => {
    let result = availablePlayers;

    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.nfl_team.toLowerCase().includes(q),
      );
    }

    if (posFilter !== "ALL") {
      result = result.filter((p) => p.position === posFilter);
    }

    if (tagFilter) {
      result = result.filter((p) => p.tags?.includes(tagFilter));
    }

    // Sort helpers — null values always sort to the bottom (999)
    const rank = (p: Player, field: keyof Player, fallback?: keyof Player): number => {
      const v = p[field];
      if (v != null && typeof v === "number") return v;
      if (fallback) {
        const fb = p[fallback];
        if (fb != null && typeof fb === "number") return fb;
      }
      return 999;
    };

    result = [...result].sort((a, b) => {
      if (sortBy === "draft") return rank(a, "draft_rank", "adp_rank") - rank(b, "draft_rank", "adp_rank");
      if (sortBy === "dynasty") return rank(a, "dynasty_rank") - rank(b, "dynasty_rank");
      if (sortBy === "positional") return rank(a, "positional_rank", "draft_rank") - rank(b, "positional_rank", "draft_rank");
      return rank(a, "adp_rank", "draft_rank") - rank(b, "adp_rank", "draft_rank");
    });

    return result;
  }, [availablePlayers, debouncedSearch, posFilter, tagFilter, sortBy]);

  // Auto-switch sort when position filter changes
  useEffect(() => {
    if (posFilter === "ALL") {
      setSortBy("draft");
    } else {
      setSortBy("positional");
    }
  }, [posFilter]);

  // Next best available by position — use draft_rank consistently so ALL and position tabs agree
  const nextBest = useMemo(() => {
    const byRank = (a: Player, b: Player) =>
      (a.draft_rank ?? a.adp_rank ?? 999) - (b.draft_rank ?? b.adp_rank ?? 999);
    const best: Record<string, Player | undefined> = {};
    for (const pos of ["QB", "RB", "WR", "TE"]) {
      best[pos] = [...availablePlayers]
        .filter((p) => p.position === pos)
        .sort(byRank)[0];
    }
    best["OVERALL"] = [...availablePlayers].sort(byRank)[0];
    return best;
  }, [availablePlayers]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Player Board
          </h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {filteredPlayers.length} / {availablePlayers.length}
            </span>
            <Button
              size="sm"
              className="h-6 px-2.5 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white border-0 shadow-md shadow-amber-900/30"
              onClick={() => setWriteInOpen(true)}
            >
              ✏️ Write In
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Icon icon="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder="Search players or teams..."
            className="pl-8 pr-7 h-8 text-sm bg-secondary/50"
          />
          {search && (
            <button
              onClick={() => { setSearch(""); setDebouncedSearch(""); clearTimeout(timerRef.current); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-muted-foreground/20 hover:bg-muted-foreground/40 flex items-center justify-center cursor-pointer transition-colors"
              title="Clear search"
            >
              <Icon icon="x" className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Position filters */}
        <div className="flex items-center gap-1">
          {POSITIONS.map((pos) => (
            <Button
              key={pos}
              variant={posFilter === pos ? "default" : "ghost"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setPosFilter(pos)}
            >
              {pos}
            </Button>
          ))}
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            variant={sortBy === "adp" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setSortBy("adp")}
          >
            ADP
          </Button>
          <Button
            variant={sortBy === "draft" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setSortBy("draft")}
          >
            DRF
          </Button>
          <Button
            variant={sortBy === "dynasty" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setSortBy("dynasty")}
          >
            DYN
          </Button>
          <Button
            variant={sortBy === "positional" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setSortBy("positional")}
          >
            POS
          </Button>
        </div>

        {/* Tag filters */}
        <div className="flex items-center gap-1 flex-wrap">
          {TAG_OPTIONS.map((tag) => (
            <button
              key={tag.key}
              onClick={() => setTagFilter(tagFilter === tag.key ? null : tag.key)}
              className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] border transition-colors cursor-pointer ${
                tagFilter === tag.key
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              <span>{tag.emoji}</span>
              <span className="hidden sm:inline">{tag.label}</span>
            </button>
          ))}
        </div>

        {/* Next Best Available strip */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-secondary/30 rounded-md px-2 py-1.5">
          <span className="font-semibold text-foreground uppercase tracking-wider shrink-0">Next Best:</span>
          {(["OVERALL", "QB", "RB", "WR", "TE"] as const).map((pos) => {
            const p = nextBest[pos];
            if (!p) return null;
            return (
              <span key={pos} className="shrink-0">
                <span className="font-medium text-foreground/80">
                  {pos === "OVERALL" ? "OVR" : pos}:
                </span>{" "}
                {p.name} ({p.draft_rank ?? p.adp_rank ?? "–"}))
              </span>
            );
          })}
        </div>
      </div>

      {/* Column Headers */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-secondary/20 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        <span className="w-7 text-right shrink-0">ADP</span>
        <span className="w-[52px] shrink-0 text-center">POS</span>
        <span className="flex-1">Player</span>
        <span className="hidden lg:block w-12 text-center">DRF</span>
        <span className="hidden lg:block w-12 text-center">DYN</span>
        <span className="hidden md:flex items-center gap-2.5">
          <span className="w-8 text-center">SOS</span>
          <span className="w-16 text-center">VEG</span>
          <span className="w-8 text-center">UP</span>
          <span className="w-8 text-center">BST</span>
        </span>
        <span className="w-[88px] shrink-0" />
      </div>

      {/* Player List */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        <div className="p-2 space-y-0.5">
          {filteredPlayers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Icon icon="search-x" className="h-8 w-8 mb-2 opacity-40" />
              <p className="text-sm">No players match your filters</p>
            </div>
          ) : (
            filteredPlayers.map((player, index) => (
              <PlayerRow
                key={player.id}
                player={player}
                onDraft={onDraft}
                onToggleTag={onToggleTag}
                isHighlighted={player.tags?.includes("target")}
                boardPosition={index + 1}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Write-In Modal */}
      <WriteInModal
        open={writeInOpen}
        onClose={() => setWriteInOpen(false)}
        onPlayerCreated={(player) => {
          onWriteInCreated?.(player);
        }}
      />
    </div>
  );
}
