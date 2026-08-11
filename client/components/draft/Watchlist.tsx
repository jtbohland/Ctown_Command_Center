import { useMemo, memo, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import PositionBadge from "./PositionBadge";
import { TAG_OPTIONS, type Player, type TagKey } from "@/lib/draft-constants";

type WatchlistProps = {
  players: Player[];
  onDraft: (playerId: number) => void;
  onToggleTag: (playerId: number, tag: TagKey) => void;
};

type GroupedWatch = {
  tagKey: string;
  emoji: string;
  label: string;
  players: Player[];
};

const WatchlistItem = memo(function WatchlistItem({
  player,
  onDraft,
  onRemove,
}: {
  player: Player;
  onDraft: (id: number) => void;
  onRemove: (id: number, tag: TagKey) => void;
}) {
  const tags = player.tags ? player.tags.split(",") : [];
  const primaryTag = tags[0] as TagKey;

  return (
    <div className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors">
      <PositionBadge position={player.position} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-medium text-xs truncate">{player.name}</span>
          <span className="text-[10px] text-muted-foreground">{player.nfl_team}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          ADP #{player.adp_rank ?? "-"}
          {player.draft_rank && ` • Draft #${player.draft_rank}`}
        </div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(player.id, primaryTag)}
          title="Remove from watchlist"
        >
          <Icon icon="x" className="h-3 w-3" />
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => onDraft(player.id)}
        >
          Draft
        </Button>
      </div>
    </div>
  );
});

export default function Watchlist({ players, onDraft, onToggleTag }: WatchlistProps) {
  // Get all tagged, undrafted players
  const watchlistPlayers = useMemo(() => {
    return players
      .filter((p) => !p.is_drafted && p.tags && p.tags.length > 0)
      .sort((a, b) => (a.adp_rank ?? 999) - (b.adp_rank ?? 999));
  }, [players]);

  // Group by primary tag
  const grouped = useMemo((): GroupedWatch[] => {
    const tagMap = new Map<string, Player[]>();

    for (const player of watchlistPlayers) {
      const tags = player.tags!.split(",");
      const primary = tags[0];
      if (!tagMap.has(primary)) tagMap.set(primary, []);
      tagMap.get(primary)!.push(player);
    }

    // Order groups by TAG_OPTIONS order
    const result: GroupedWatch[] = [];
    for (const tag of TAG_OPTIONS) {
      const players = tagMap.get(tag.key);
      if (players && players.length > 0) {
        result.push({ tagKey: tag.key, emoji: tag.emoji, label: tag.label, players });
      }
    }
    return result;
  }, [watchlistPlayers]);

  const handleRemove = useCallback(
    (playerId: number, tag: TagKey) => {
      onToggleTag(playerId, tag);
    },
    [onToggleTag],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Icon icon="eye" className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Watchlist
          </h2>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {watchlistPlayers.length} player{watchlistPlayers.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0 overflow-hidden">
        {watchlistPlayers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
            <Icon icon="eye-off" className="h-6 w-6 mb-2 opacity-40" />
            <p className="text-xs text-center">No tagged players yet</p>
            <p className="text-[10px] text-center mt-1 opacity-60">
              Tag players on the board to add them to your watchlist
            </p>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            {grouped.map((group) => (
              <div key={group.tagKey}>
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span className="text-xs">{group.emoji}</span>
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {group.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 ml-auto">
                    {group.players.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {group.players.map((player) => (
                    <WatchlistItem
                      key={player.id}
                      player={player}
                      onDraft={onDraft}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
