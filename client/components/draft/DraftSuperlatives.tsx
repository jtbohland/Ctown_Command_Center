import { memo, useMemo } from "react";
import { Button } from "@/components/ui/button";
import PositionBadge from "./PositionBadge";
import { getTagEmoji, getRookieStarDisplay, type Player } from "@/lib/draft-constants";

// ─── Tile Definitions ───────────────────────────────────────

const TILES = [
  {
    key: "steals",
    emoji: "🟢",
    label: "STEALS AVAILABLE",
    subtitle: "Fallen past their ADP — grab these",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/25",
    accent: "text-emerald-300",
    gapColor: "text-emerald-400",
    gapPrefix: "📉 −",
  },
  {
    key: "reaches",
    emoji: "🔴",
    label: "REACHES TO AVOID",
    subtitle: "ADP says not yet — don't overpay",
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/25",
    accent: "text-red-300",
    gapColor: "text-red-400",
    gapPrefix: "📈 +",
  },
  {
    key: "perfect",
    emoji: "🔵",
    label: "PERFECT PICKS",
    subtitle: "ADP matches your pick slot",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/25",
    accent: "text-blue-300",
    gapColor: "text-blue-400",
    gapPrefix: "🎯 ±",
  },
] as const;

type TileDef = (typeof TILES)[number];

type TilePlayer = Player & {
  adpGap: number;
  parsedTags: string[];
};

// ─── Player Row ─────────────────────────────────────────────

const PlayerRow = memo(function PlayerRow({
  player,
  tile,
  onDraft,
}: {
  player: TilePlayer;
  tile: TileDef;
  onDraft: (id: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-secondary/30 transition-colors">
      <span className={`text-xs font-bold shrink-0 w-12 text-right ${tile.gapColor}`}>
        {tile.key === "perfect"
          ? `${tile.gapPrefix}${Math.abs(player.adpGap)}`
          : `${tile.gapPrefix}${Math.abs(player.adpGap)}`}
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

// ─── Position Row (for Best by Position tile) ───────────────

const PositionRow = memo(function PositionRow({
  player,
  onDraft,
}: {
  player: TilePlayer;
  onDraft: (id: number) => void;
}) {
  const gapAbs = Math.abs(player.adpGap);
  const isSteal = player.adpGap > 0; // currentPick - ADP > 0 means fallen past ADP
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-secondary/30 transition-colors">
      <PositionBadge position={player.position} />
      <span className="font-medium text-xs truncate flex-1 min-w-0">
        {player.name}
        {player.parsedTags.length > 0 && (
          <span className="ml-1 text-[10px]">{player.parsedTags.map((t) => getTagEmoji(t)).join("")}</span>
        )}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">{player.nfl_team}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">
        ADP <span className="font-semibold">{player.adp_rank ?? "-"}</span>
      </span>
      {gapAbs > 0 && (
        <span className={`text-[10px] font-semibold shrink-0 ${isSteal ? "text-emerald-400" : "text-red-400"}`}>
          {isSteal ? `−${gapAbs}` : `+${gapAbs}`}
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

// ─── Main Component ─────────────────────────────────────────

type DraftSuperlativesProps = {
  players: Player[];
  currentOverallPick: number;
  onDraft: (playerId: number) => void;
};

export default memo(function DraftSuperlatives({ players, currentOverallPick, onDraft }: DraftSuperlativesProps) {
  const { tiles, bestByPosition } = useMemo(() => {
    const available = players.filter((p) => !p.is_drafted && !p.is_keeper && p.adp_rank != null);

    const enrich = (p: Player): TilePlayer => ({
      ...p,
      adpGap: Math.round(currentOverallPick - (p.adp_rank ?? 0)),
      parsedTags: p.tags ? p.tags.split(",") : [],
    });

    const enriched = available.map(enrich);

    // ── Steals: currentPick - ADP >= 8 (player has fallen past ADP) ──
    const stealsPool = enriched.filter((p) => p.adpGap >= 8).sort((a, b) => b.adpGap - a.adpGap);
    const steals = stealsPool.slice(0, 5);
    const usedIds = new Set(steals.map((p) => p.id));

    // ── Reaches: ADP - currentPick >= 8 (ADP says not yet) ──
    // adpGap is currentPick - ADP, so reaches have adpGap <= -8
    const reachesPool = enriched
      .filter((p) => !usedIds.has(p.id) && p.adpGap <= -8)
      .sort((a, b) => a.adpGap - b.adpGap); // most negative first
    const reaches = reachesPool.slice(0, 5);
    for (const p of reaches) usedIds.add(p.id);

    // ── Perfect: abs(gap) <= 3, excluding steals & reaches ──
    const perfectPool = enriched
      .filter((p) => !usedIds.has(p.id) && Math.abs(p.adpGap) <= 3)
      .sort((a, b) => Math.abs(a.adpGap) - Math.abs(b.adpGap));
    const perfect = perfectPool.slice(0, 5);
    for (const p of perfect) usedIds.add(p.id);

    // ── Best by Position: top 3 per position by ADP value (biggest fall) ──
    const positions = ["RB", "WR", "QB", "TE"] as const;
    const bestByPos = positions.map((pos) => {
      const posPlayers = enriched
        .filter((p) => !usedIds.has(p.id) && p.position === pos)
        .sort((a, b) => b.adpGap - a.adpGap) // biggest value first
        .slice(0, 3);
      // Mark them as used too
      for (const p of posPlayers) usedIds.add(p.id);
      return { position: pos, players: posPlayers };
    }).filter((g) => g.players.length > 0);

    return {
      tiles: [
        { def: TILES[0], players: steals },
        { def: TILES[1], players: reaches },
        { def: TILES[2], players: perfect },
      ].filter((t) => t.players.length > 0),
      bestByPosition: bestByPos,
    };
  }, [players, currentOverallPick]);

  if (tiles.length === 0 && bestByPosition.length === 0) return null;

  return (
    <div className="px-4 py-2.5 border-b border-border/40">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">⚡</span>
        <h3 className="text-xs font-bold uppercase tracking-wider text-foreground/80">
          Draft Day Superlatives
        </h3>
        <span className="text-[9px] text-muted-foreground/60 ml-auto">
          vs pick #{currentOverallPick}
        </span>
      </div>

      {/* Tiles Grid — 2×2 */}
      <div className="grid grid-cols-2 gap-2">
        {/* First 3 tiles */}
        {tiles.map(({ def, players: tilePlayers }) => (
          <div key={def.key} className={`rounded-lg border ${def.bg}`}>
            {/* Tile header */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-current/10">
              <span className="text-xs">{def.emoji}</span>
              <span className={`text-[10px] font-black uppercase tracking-widest ${def.color}`}>
                {def.label}
              </span>
            </div>
            <div className="px-1 py-0.5">
              <p className="text-[9px] text-muted-foreground/60 px-1.5 mb-0.5">{def.subtitle}</p>
              {tilePlayers.map((player) => (
                <PlayerRow key={player.id} player={player} tile={def} onDraft={onDraft} />
              ))}
            </div>
          </div>
        ))}

        {/* Best by Position tile */}
        {bestByPosition.length > 0 && (
          <div className="rounded-lg border bg-purple-500/10 border-purple-500/25">
            <div className="flex items-center gap-1.5 px-2.5 py-1 border-b border-current/10">
              <span className="text-xs">🟣</span>
              <span className="text-[10px] font-black uppercase tracking-widest text-purple-400">
                BEST BY POSITION
              </span>
            </div>
            <div className="px-1 py-0.5">
              <p className="text-[9px] text-muted-foreground/60 px-1.5 mb-0.5">Top available per position</p>
              {bestByPosition.map((group) => (
                <div key={group.position}>
                  {group.players.map((player) => (
                    <PositionRow key={player.id} player={player} onDraft={onDraft} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
