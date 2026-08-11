import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import PositionBadge from "./PositionBadge";
import { getTagEmoji, getRookieStarDisplay, type Player } from "@/lib/draft-constants";

// ─── Falling Tier Definitions ───────────────────────────────

const FALLING_TIERS = [
  { key: "freefall", emoji: "🥵", label: "FREE FALL", minGap: 20, color: "text-red-400", bg: "bg-red-500/10 border-red-500/25", accent: "text-red-300" },
  { key: "falling",  emoji: "😱", label: "FALLING",   minGap: 12, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/25", accent: "text-orange-300" },
  { key: "value",    emoji: "🤑", label: "VALUE",     minGap: 8,  color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25", accent: "text-emerald-300" },
] as const;

type FallingPlayer = Player & {
  adpGap: number;
  tierKey: string;
  parsedTags: string[];
};

// ─── Falling Row ────────────────────────────────────────────

const FallingRow = memo(function FallingRow({
  player,
  tier,
  onDraft,
}: {
  player: FallingPlayer;
  tier: typeof FALLING_TIERS[number];
  onDraft: (id: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-secondary/30 transition-colors">
      <span className={`text-xs font-bold shrink-0 ${tier.color}`}>
        📉 −{player.adpGap}
      </span>
      <PositionBadge position={player.position} />
      <span className="font-medium text-xs truncate flex-1 min-w-0">
        {player.name}
        {player.parsedTags.length > 0 && (
          <span className="ml-1 text-[10px]">{player.parsedTags.map((t) => getTagEmoji(t)).join("")}</span>
        )}
        {getRookieStarDisplay(player.name) && (
          <span className="ml-1 text-[9px]" title="Rookie overall">{getRookieStarDisplay(player.name)}</span>
        )}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">{player.nfl_team}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        ADP <span className="font-semibold">{player.adp_rank ?? "-"}</span>
      </span>
      {player.dynasty_rank != null && player.dynasty_rank <= 100 && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          Dyn {player.dynasty_rank}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-6 px-2 text-[10px] font-semibold shrink-0"
        onClick={() => onDraft(player.id)}
      >
        Draft
      </Button>
    </div>
  );
});

// ─── Main Falling Board ─────────────────────────────────────

type FallingBoardProps = {
  players: Player[];
  currentOverallPick: number;
  onDraft: (playerId: number) => void;
};

export default memo(function FallingBoard({ players, currentOverallPick, onDraft }: FallingBoardProps) {
  const tiers = useMemo(() => {
    const available = players.filter((p) => !p.is_drafted && !p.is_keeper && p.adp_rank != null);

    // Compute gaps and assign tiers
    const withGap: FallingPlayer[] = [];
    for (const p of available) {
      const gap = currentOverallPick - (p.adp_rank ?? 0);
      if (gap >= FALLING_TIERS[FALLING_TIERS.length - 1].minGap) {
        const tierDef = FALLING_TIERS.find((t) => gap >= t.minGap)!;
        withGap.push({
          ...p,
          adpGap: Math.round(gap),
          tierKey: tierDef.key,
          parsedTags: p.tags ? p.tags.split(",") : [],
        });
      }
    }

    // Sort by biggest gap first
    withGap.sort((a, b) => b.adpGap - a.adpGap);

    // Group into tiers, limit each tier to 5 players
    return FALLING_TIERS.map((tier) => ({
      ...tier,
      players: withGap.filter((p) => p.tierKey === tier.key).slice(0, 5),
    })).filter((tier) => tier.players.length > 0);
  }, [players, currentOverallPick]);

  if (tiers.length === 0) return null;

  const totalFalling = tiers.reduce((sum, t) => sum + t.players.length, 0);

  return (
    <div className="px-4 py-2.5 border-b border-red-500/15 bg-gradient-to-r from-red-500/5 via-transparent to-orange-500/5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">📉</span>
        <h3 className="text-xs font-bold uppercase tracking-wider text-red-400/90">
          Falling Board
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {totalFalling} player{totalFalling !== 1 ? "s" : ""} below ADP
        </span>
        <span className="text-[9px] text-muted-foreground/60 ml-auto">
          ADP gap vs pick #{currentOverallPick}
        </span>
      </div>

      {/* Tiered sections */}
      <div className="space-y-1.5">
        {tiers.map((tier) => (
          <div key={tier.key} className={`rounded-lg border ${tier.bg}`}>
            {/* Tier header */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-current/10">
              <span className="text-xs">{tier.emoji}</span>
              <span className={`text-[10px] font-black uppercase tracking-widest ${tier.color}`}>
                {tier.label}
              </span>
              <span className="text-[9px] text-muted-foreground/60">
                {tier.key === "freefall" ? "20+" : tier.key === "falling" ? "12-19" : "8-11"} spots below ADP
              </span>
            </div>
            {/* Players */}
            {tier.players.map((player) => (
              <FallingRow
                key={player.id}
                player={player}
                tier={tier}
                onDraft={onDraft}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});
