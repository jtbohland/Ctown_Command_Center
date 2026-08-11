import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import PositionBadge from "./PositionBadge";
import TagSelector from "./TagSelector";
import { getTagEmoji, getPlayerSos, getRookieStarDisplay, type Player, type TagKey } from "@/lib/draft-constants";
import RatingBars, { parseRatingString } from "./RatingBars";
import { VegasBar } from "./VegasBar";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type PlayerRowProps = {
  player: Player;
  onDraft: (playerId: number) => void;
  onToggleTag: (playerId: number, tag: TagKey) => void;
  isHighlighted?: boolean;
  compact?: boolean;
  boardPosition?: number; // 1-indexed position on the sorted board
};

const PlayerRow = memo(function PlayerRow({ player, onDraft, onToggleTag, isHighlighted, compact, boardPosition }: PlayerRowProps) {
  const tags = player.tags ? player.tags.split(",") : [];

  const handleToggleTag = useCallback(
    (tag: TagKey) => {
      onToggleTag(player.id, tag);
    },
    [player.id, onToggleTag],
  );

  const handleDraft = useCallback(() => {
    onDraft(player.id);
  }, [player.id, onDraft]);

  const sosScore = getPlayerSos(player.nfl_team, player.position);
  const upsideScore = parseRatingString(player.upside);
  const bustScore = parseRatingString(player.bust);
  const rookieStars = getRookieStarDisplay(player.name);

  return (
    <div
      className={cn(
        "group flex items-center gap-2 px-3 py-2 rounded-md border border-transparent transition-colors hover:bg-accent/50 hover:border-border cursor-pointer",
        isHighlighted && "bg-primary/10 border-primary/30",
        compact && "py-1.5",
      )}
    >
      {/* ADP Rank */}
      <span className="text-xs text-muted-foreground w-7 text-right shrink-0 font-mono">
        {player.adp_rank ?? "-"}
      </span>

      {/* Position badge */}
      <PositionBadge position={player.position} />

      {/* Name & Team */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm truncate">{player.name}</span>
          {tags.length > 0 && (
            <span className="text-xs shrink-0">
              {tags.map((t) => getTagEmoji(t)).join("")}
            </span>
          )}
          {/* Value Alert — STEAL badge */}
          {boardPosition != null && player.adp_rank != null && boardPosition - player.adp_rank >= 10 && (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-400 animate-pulse shrink-0">
              STEAL
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{player.nfl_team}</span>
          {player.bye_week && (
            <>
              <span className="opacity-40">•</span>
              <span>Bye {player.bye_week}</span>
            </>
          )}
          {player.age && (
            <>
              <span className="opacity-40">•</span>
              <span>Age {player.age}</span>
            </>
          )}
          {player.draft_tier && (
            <>
              <span className="opacity-40">•</span>
              <span>T{player.draft_tier}</span>
            </>
          )}
          {rookieStars && (
            <>
              <span className="opacity-40">•</span>
              <span className="text-[10px]" title={`Rookie overall: ${rookieStars.length}/5`}>{rookieStars}</span>
            </>
          )}
        </div>
      </div>

      {/* Ranking columns */}
      <div className="hidden lg:flex items-center gap-3 shrink-0 text-[10px] text-muted-foreground font-mono">
        <div className="w-12 text-center" title="Draft Rank">
          {player.draft_rank ?? "-"}
        </div>
        <div className="w-12 text-center" title="Dynasty Rank">
          {player.dynasty_rank ?? "-"}
        </div>
      </div>

      {/* SOS / Upside / Bust — all as consistent bar indicators */}
      <div className="hidden md:flex items-center gap-2.5 shrink-0">
        <div className="w-8 flex justify-center" title={`SOS: ${sosScore ?? "–"}/5`}>
          <RatingBars score={sosScore} variant="sos" />
        </div>
        <div className="w-16 flex justify-center">
          <VegasBar nflTeam={player.nfl_team} />
        </div>
        <div className="w-8 flex justify-center" title={`Upside: ${upsideScore ?? "–"}/5`}>
          <RatingBars score={upsideScore} variant="upside" />
        </div>
        <div className="w-8 flex justify-center" title={`Bust: ${bustScore ?? "–"}/5`}>
          <RatingBars score={bustScore} variant="bust" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <TagSelector currentTags={tags} onToggleTag={handleToggleTag}>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Icon icon="tags" className="h-3.5 w-3.5" />
          </Button>
        </TagSelector>
        <Button
          variant="default"
          size="sm"
          className="h-7 text-xs px-2"
          onClick={handleDraft}
        >
          Draft
        </Button>
      </div>
    </div>
  );
});

export default PlayerRow;
