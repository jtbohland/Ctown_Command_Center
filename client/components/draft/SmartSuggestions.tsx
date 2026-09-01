import { useState, useMemo, useCallback, useRef, useEffect, memo, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import PositionBadge from "./PositionBadge";
import { getTagEmoji, getPlayerSos, getPlayerVegas, getRookieStarDisplay, getKeeperWindow, getTeamEmoji, STARTING_SLOTS, type Player, type Team, type DraftPick, type KeeperWindow } from "@/lib/draft-constants";
import RatingBars, { parseRatingString } from "./RatingBars";
import { VegasBar } from "./VegasBar";
import DraftSuperlatives from "./DraftSuperlatives";

type SmartSuggestionsProps = {
  players: Player[];
  myTeam: Team | undefined;
  isMyPick: boolean;
  currentOverallPick: number;
  onDraft: (playerId: number) => void;
  teams: Team[];
  picks: DraftPick[];
};

type ScoreBreakdown = {
  adpPct: number;           // 0–35
  dynastyPts: number;       // 0–10 (was 15, 5 moved to keeper window)
  posRankPts: number;       // 0–10
  needPts: number;          // 0–15
  valuePts: number;         // 0–5
  vegasPts: number;         // 0–3
  sosPts: number;           // 0–2
  tagPts: number;           // 0–10
  keeperWindowPts: number;  // 0–8
  byePenalty: number;       // -5–0
  avoidPenalty: number;     // -25 or 0
};

type ScoredPlayer = Player & {
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  byeConflict: ByeConflict | null;
  sosScore: number | null;
  keeperWindow: KeeperWindow | null;
};

type ByeConflict = {
  week: number;
  count: number;
  names: string[];
};

// ─── Bye Week Helpers ───────────────────────────────────────

function computeByeWeekMap(roster: Player[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const p of roster) {
    if (p.bye_week != null) {
      const list = map.get(p.bye_week) ?? [];
      list.push(p.name);
      map.set(p.bye_week, list);
    }
  }
  return map;
}

function getByeConflict(
  player: Player,
  byeMap: Map<number, string[]>,
): ByeConflict | null {
  if (player.bye_week == null) return null;
  const existing = byeMap.get(player.bye_week);
  if (!existing || existing.length < 2) return null;
  return {
    week: player.bye_week,
    count: existing.length + 1,
    names: existing,
  };
}

// ─── Normalized 0–100 Scoring Algorithm ─────────────────────
//
//  Expert Consensus:  60 pts (ADP percentile 35, Dynasty 15, Positional rank 10)
//  Contextual Fit:    25 pts (Roster need 15, Value/fallen 5, Vegas 3, SOS 2)
//  Tags:              10 pts (🎯 Target +10, 💎 Gem +7, 🚀 Breakout +4, 📈 Upside +3, 🔗 Handcuff +2)
//  Tiebreakers:        5 pts (Bye conflicts −2 to −5)
//  🚫 Avoid penalty −10 (strong but lets steals surface)
//

function computeAllScored(
  players: Player[],
  myTeam: Team | undefined,
  currentOverallPick: number,
): ScoredPlayer[] {
  if (!myTeam) return [];

  const available = players.filter((p) => !p.is_drafted && !p.is_keeper);
  if (available.length === 0) return [];

  // Current roster
  const myRoster = players.filter(
    (p) => p.is_drafted && p.drafted_team_id === myTeam.id,
  );

  const byeMap = computeByeWeekMap(myRoster);

  // Count filled positions
  const filledByPos: Record<string, number> = {};
  for (const p of myRoster) {
    filledByPos[p.position] = (filledByPos[p.position] ?? 0) + 1;
  }

  // Starting needs from roster config
  const posNeeds: Record<string, number> = {};
  for (const slot of STARTING_SLOTS) {
    for (const pos of slot.positions) {
      posNeeds[pos] = (posNeeds[pos] ?? 0) + 1;
    }
  }
  for (const pos of Object.keys(posNeeds)) {
    posNeeds[pos] = Math.max(0, (posNeeds[pos] ?? 0) - (filledByPos[pos] ?? 0));
  }

  const hasQB = (filledByPos["QB"] ?? 0) >= 1;
  const hasTE = (filledByPos["TE"] ?? 0) >= 1;

  // Get ADP range for percentile scaling
  const allAdps = available.map((p) => p.adp_rank ?? 500).sort((a, b) => a - b);
  const totalAvailable = allAdps.length;

  const scored: ScoredPlayer[] = available.map((player) => {
    const adpRank = player.adp_rank ?? 500;
    const dynRank = player.dynasty_rank ?? 500;
    const posRank = player.positional_rank ?? player.draft_rank ?? 500;
    const reasons: string[] = [];

    // ── EXPERT CONSENSUS: 60 pts ──

    // ADP Percentile (0–35 pts)
    // Where does this player's ADP rank among available players?
    // Lower ADP = better = higher score
    const adpPosition = allAdps.filter((a) => a <= adpRank).length;
    const adpPercentile = 1 - (adpPosition / totalAvailable); // 1 = best, 0 = worst
    const adpPct = Math.round(adpPercentile * 35 * 10) / 10;

    // Dynasty Rank (0–10 pts, reduced from 15 — 5 pts moved to Keeper Window)
    // Top 10 dynasty = 10, top 25 = 8, top 50 = 5, top 100 = 3, else = 0
    let dynastyPts = 0;
    if (dynRank <= 10) {
      dynastyPts = 10;
      reasons.push("👑 Dynasty elite");
    } else if (dynRank <= 25) {
      dynastyPts = 8;
    } else if (dynRank <= 50) {
      dynastyPts = 5;
    } else if (dynRank <= 100) {
      dynastyPts = 3;
    }

    // Positional Rank (0–10 pts)
    // Top 5 at position = 10, top 10 = 7, top 20 = 4, top 30 = 2
    let posRankPts = 0;
    if (posRank <= 5) {
      posRankPts = 10;
    } else if (posRank <= 10) {
      posRankPts = 7;
    } else if (posRank <= 20) {
      posRankPts = 4;
    } else if (posRank <= 30) {
      posRankPts = 2;
    }

    // ── CONTEXTUAL FIT: 25 pts ──

    // Roster Need (0–15 pts)
    let needPts = 0;
    const need = posNeeds[player.position] ?? 0;

    if ((player.position === "QB" && hasQB) || (player.position === "TE" && hasTE)) {
      // Already have a starter — apply penalty unless a massive steal
      const valueGap = currentOverallPick - adpRank;
      if (valueGap >= 20 || posRank <= 8) {
        needPts = 2; // give a tiny bit for being a steal, but not a full need score
        reasons.push(`🤯 ${player.position} steal (ADP ${Math.round(adpRank)})`);
      } else {
        needPts = -8; // strong penalty — don't double up when not needed
      }
    } else if (need >= 2) {
      needPts = 15;
      reasons.push(`🔥 Strong ${player.position} need`);
    } else if (need === 1) {
      needPts = 10;
      reasons.push(`Fills ${player.position} need`);
    } else if (player.position === "WR" || player.position === "RB") {
      needPts = 3; // flex-eligible depth is never bad
    }

    // Value / Fallen (0–5 pts)
    let valuePts = 0;
    const adpDiff = currentOverallPick - adpRank;
    if (adpDiff >= 20) {
      valuePts = 5;
      reasons.push(`📉 Huge value (ADP ${Math.round(adpRank)}, pick ${currentOverallPick})`);
    } else if (adpDiff >= 12) {
      valuePts = 4;
      reasons.push(`📉 Falling (ADP ${Math.round(adpRank)})`);
    } else if (adpDiff >= 6) {
      valuePts = 2;
      reasons.push("📈 Value pick");
    }

    // Vegas Implied PPG (0–3 pts)
    let vegasPts = 0;
    const ppg = getPlayerVegas(player.nfl_team);
    if (ppg != null) {
      if (ppg >= 25.5) {
        vegasPts = 3;
        reasons.push(`🟢 Elite O (${ppg.toFixed(1)})`);
      } else if (ppg >= 24) {
        vegasPts = 2;
      } else if (ppg >= 22) {
        vegasPts = 1;
      }
      // Sub-22 gets 0 — no negative from Vegas alone
    }

    // Strength of Schedule (0–2 pts)
    let sosPts = 0;
    const sosScore = getPlayerSos(player.nfl_team, player.position);
    if (sosScore != null) {
      if (sosScore >= 5) {
        sosPts = 2;
        reasons.push(`📅 Cake SOS`);
      } else if (sosScore >= 4) {
        sosPts = 1;
      }
      // SOS ≤ 3 = no bonus — we don't subtract here, experts already factored this into ADP
    }

    // ── TAGS: 10 pts ──

    let tagPts = 0;
    const tags = player.tags ? player.tags.split(",") : [];
    if (tags.includes("target")) {
      tagPts = 10;
      reasons.unshift("🎯 Your target");
    } else if (tags.includes("gem")) {
      tagPts = 7;
      reasons.unshift("💎 Hidden gem");
    } else if (tags.includes("breakout")) {
      tagPts = 4;
      reasons.unshift("🚀 Breakout");
    } else if (tags.includes("upside")) {
      tagPts = 3;
      reasons.unshift("📈 Upside");
    } else if (tags.includes("handcuff")) {
      tagPts = 2;
      reasons.unshift("🔗 Handcuff");
    } else if (tags.includes("rookie")) {
      tagPts = 1;
    }

    // ── AVOID: strong penalty (but not nuclear — let steals surface) ──
    let avoidPenalty = 0;
    if (tags.includes("avoid")) {
      avoidPenalty = -10;
      reasons.unshift("🚫 Avoid");
    }

    // ── KEEPER WINDOW: dynasty shelf-life (0–8 pts) ──
    const keeperWindow = getKeeperWindow(player.position, player.age);
    let keeperWindowPts = 0;
    if (keeperWindow) {
      keeperWindowPts = keeperWindow.points;
      if (keeperWindow.tier === "long" && (player.position === "RB" || player.position === "WR")) {
        reasons.push(`${keeperWindow.emoji} ${keeperWindow.label}`);
      } else if (keeperWindow.tier === "short") {
        reasons.push(`${keeperWindow.emoji} ${keeperWindow.label}`);
      }
    }

    // ── TIEBREAKERS: bye penalties (−5 to 0) ──
    let byePenalty = 0;
    const byeConflict = getByeConflict(player, byeMap);
    if (byeConflict) {
      byePenalty = byeConflict.count >= 5 ? -5 : byeConflict.count >= 4 ? -3 : -2;
    }

    // ── TOTAL ──
    const totalScore =
      adpPct + dynastyPts + posRankPts +  // Expert consensus
      needPts + valuePts + vegasPts + sosPts +  // Contextual fit
      keeperWindowPts +  // Dynasty shelf-life
      tagPts +  // Tags
      byePenalty + avoidPenalty;  // Penalties

    const score = Math.round(totalScore * 10) / 10;

    const breakdown: ScoreBreakdown = {
      adpPct,
      dynastyPts,
      posRankPts,
      needPts: Math.max(0, needPts),
      valuePts,
      vegasPts,
      sosPts,
      tagPts,
      keeperWindowPts,
      byePenalty,
      avoidPenalty,
    };

    return { ...player, score, breakdown, reasons, byeConflict, sosScore, keeperWindow };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ─── Score Breakdown Tooltip ────────────────────────────────

const ScoreBreakdownView = memo(function ScoreBreakdownView({ b }: { b: ScoreBreakdown }) {
  const expertTotal = b.adpPct + b.dynastyPts + b.posRankPts;
  const contextTotal = b.needPts + b.valuePts + b.vegasPts + b.sosPts;

  return (
    <div className="text-[9px] leading-tight space-y-1 min-w-[140px]">
      <div className="font-bold text-foreground/80 border-b border-border/30 pb-0.5 mb-0.5">Score Breakdown</div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Expert ({expertTotal.toFixed(1)}/55)</span>
      </div>
      <div className="pl-2 space-y-0.5 text-muted-foreground/70">
        <div className="flex justify-between"><span>ADP Percentile</span><span>{b.adpPct.toFixed(1)}/35</span></div>
        <div className="flex justify-between"><span>Dynasty Rank</span><span>{b.dynastyPts}/10</span></div>
        <div className="flex justify-between"><span>Positional Rank</span><span>{b.posRankPts}/10</span></div>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Context ({contextTotal}/25)</span>
      </div>
      <div className="pl-2 space-y-0.5 text-muted-foreground/70">
        <div className="flex justify-between"><span>Roster Need</span><span>{b.needPts}/15</span></div>
        <div className="flex justify-between"><span>Value/Fallen</span><span>{b.valuePts}/5</span></div>
        <div className="flex justify-between"><span>Vegas</span><span>{b.vegasPts}/3</span></div>
        <div className="flex justify-between"><span>SOS</span><span>{b.sosPts}/2</span></div>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Keeper Window ({b.keeperWindowPts}/8)</span>
      </div>
      <div className="pl-2 space-y-0.5 text-muted-foreground/70">
        <div className="flex justify-between">
          <span>{b.keeperWindowPts >= 5 ? "🪟 Long" : b.keeperWindowPts >= 2 ? "🖼️ Closing" : b.keeperWindowPts > 0 ? "🪟 Stable" : "🚪 Short"}</span>
          <span>{b.keeperWindowPts}/8</span>
        </div>
      </div>
      {b.tagPts > 0 && (
        <div className="flex justify-between"><span className="text-muted-foreground">Tags</span><span>{b.tagPts}/10</span></div>
      )}
      {b.byePenalty < 0 && (
        <div className="flex justify-between text-amber-400"><span>Bye Conflict</span><span>{b.byePenalty}</span></div>
      )}
      {b.avoidPenalty < 0 && (
        <div className="flex justify-between text-red-400"><span>Avoid</span><span>{b.avoidPenalty}</span></div>
      )}
    </div>
  );
});

// ─── Score Badge ────────────────────────────────────────────

function getScoreColor(score: number): string {
  if (score >= 65) return "text-emerald-400";
  if (score >= 45) return "text-sky-400";
  if (score >= 30) return "text-amber-400";
  return "text-muted-foreground";
}

function getScoreBg(score: number): string {
  if (score >= 65) return "bg-emerald-500/15 border-emerald-500/30";
  if (score >= 45) return "bg-sky-500/15 border-sky-500/30";
  if (score >= 30) return "bg-amber-500/15 border-amber-500/30";
  return "bg-secondary/40 border-border/30";
}

// ─── Suggestion Card ────────────────────────────────────────

const SuggestionCard = memo(function SuggestionCard({
  player,
  rank,
  onDraft,
  showByeWarning,
  currentOverallPick,
}: {
  player: ScoredPlayer;
  rank: number;
  onDraft: (id: number) => void;
  showByeWarning?: boolean;
  currentOverallPick?: number;
}) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const tags = player.tags ? player.tags.split(",") : [];
  const adpGap = currentOverallPick != null && player.adp_rank != null
    ? Math.round(currentOverallPick - player.adp_rank)
    : 0;

  return (
    <div className="flex flex-col rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="text-xs font-black text-primary/60 w-4 shrink-0">#{rank}</span>
        {/* Score badge */}
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold tabular-nums cursor-pointer ${getScoreBg(player.score)} ${getScoreColor(player.score)}`}
          title="Click for score breakdown"
        >
          {player.score.toFixed(1)}
        </button>
        {/* Keeper Window badge */}
        {player.keeperWindow && (
          <span
            className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${player.keeperWindow.bgClass}`}
            title={`${player.keeperWindow.label} — ${player.keeperWindow.points}/8 pts`}
          >
            {player.keeperWindow.emoji} {player.keeperWindow.label}
          </span>
        )}
        {/* ADP fallen chip */}
        {adpGap >= 8 && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums border ${
            adpGap >= 20 ? "bg-red-500/15 border-red-500/30 text-red-400" :
            adpGap >= 12 ? "bg-orange-500/15 border-orange-500/30 text-orange-400" :
            "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
          }`} title={`${adpGap} spots below ADP`}>
            📉 −{adpGap}
          </span>
        )}
        <PositionBadge position={player.position} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-sm truncate">{player.name}</span>
            {tags.length > 0 && (
              <span className="text-xs shrink-0">
                {tags.map((t) => getTagEmoji(t)).join("")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
            <span>{player.nfl_team}</span>
            <span className="opacity-40">•</span>
            <span>ADP #{player.adp_rank ?? "-"}</span>
            {player.bye_week != null && (
              <>
                <span className="opacity-40">•</span>
                <span>Bye {player.bye_week}</span>
              </>
            )}
            {player.dynasty_rank != null && player.dynasty_rank <= 50 && (
              <>
                <span className="opacity-40">•</span>
                <span>Dyn #{player.dynasty_rank}</span>
              </>
            )}
            {player.age != null && (
              <>
                <span className="opacity-40">•</span>
                <span>Age {player.age}</span>
              </>
            )}
            {player.sosScore != null && (
              <>
                <span className="opacity-40">•</span>
                <span className="inline-flex items-center gap-1">
                  SOS <RatingBars score={player.sosScore} variant="sos" />
                </span>
              </>
            )}
            {getRookieStarDisplay(player.name) && (
              <>
                <span className="opacity-40">•</span>
                <span className="text-[10px]" title={`Rookie overall`}>{getRookieStarDisplay(player.name)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-primary/80 font-medium truncate">
              {player.reasons.slice(0, 3).join(" • ")}
            </span>
            <span className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground shrink-0" title="Vegas Implied PPG">
              <VegasBar nflTeam={player.nfl_team} />
            </span>
            {parseRatingString(player.upside) != null && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-green-400/80 shrink-0" title={`Upside: ${player.upside}`}>
                UP <RatingBars score={parseRatingString(player.upside)} variant="upside" />
              </span>
            )}
            {parseRatingString(player.bust) != null && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-red-400/80 shrink-0" title={`Bust: ${player.bust}`}>
                BST <RatingBars score={parseRatingString(player.bust)} variant="bust" />
              </span>
            )}
          </div>
        </div>
        <Button
          variant="default"
          size="sm"
          className="h-8 px-3 text-xs font-semibold shrink-0"
          onClick={() => onDraft(player.id)}
        >
          <Icon icon="zap" className="h-3 w-3 mr-1" />
          Draft
        </Button>
      </div>

      {/* Score breakdown (expandable) */}
      {showBreakdown && (
        <div className="px-3 pb-2 -mt-0.5">
          <div className="rounded-md bg-secondary/40 border border-border/30 px-3 py-2">
            <ScoreBreakdownView b={player.breakdown} />
          </div>
        </div>
      )}

      {/* Bye week warning banner */}
      {showByeWarning && player.byeConflict && (
        <div className="px-3 pb-2 -mt-0.5">
          <div className="flex items-center gap-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 text-[10px] text-amber-400">
            <Icon icon="alert-triangle" className="h-3 w-3 shrink-0" />
            <span>
              <span className="font-semibold">{player.byeConflict.count} players on Bye {player.byeConflict.week}</span>
              {" "}— {player.byeConflict.names.join(", ")} + {player.name}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

// ─── All Players Row (compact for full list view) ───────────

const AllPlayersRow = memo(function AllPlayersRow({
  player,
  rank,
  onDraft,
}: {
  player: ScoredPlayer;
  rank: number;
  onDraft: (id: number) => void;
}) {
  const tags = player.tags ? player.tags.split(",") : [];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-secondary/30 transition-colors border-b border-border/20 last:border-0">
      <span className="text-[10px] font-mono text-muted-foreground/50 w-5 text-right shrink-0">{rank}</span>
      <span className={`shrink-0 rounded border px-1 py-0 text-[9px] font-bold tabular-nums ${getScoreBg(player.score)} ${getScoreColor(player.score)}`}>
        {player.score.toFixed(1)}
      </span>
      <PositionBadge position={player.position} />
      <span className="font-medium text-xs truncate flex-1 min-w-0">
        {player.name}
        {tags.length > 0 && (
          <span className="ml-1 text-[10px]">{tags.map((t) => getTagEmoji(t)).join("")}</span>
        )}
        {getRookieStarDisplay(player.name) && (
          <span className="ml-1 text-[9px]" title="Rookie overall">{getRookieStarDisplay(player.name)}</span>
        )}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0">{player.nfl_team}</span>
      <span className="text-[10px] text-muted-foreground shrink-0 w-12 text-right">ADP {player.adp_rank ?? "-"}</span>
      {player.dynasty_rank != null && player.dynasty_rank <= 100 && (
        <span className="text-[10px] text-muted-foreground shrink-0 w-12 text-right">Dyn {player.dynasty_rank}</span>
      )}
      {player.dynasty_rank == null || player.dynasty_rank > 100 ? (
        <span className="text-[10px] text-muted-foreground/30 shrink-0 w-12 text-right">—</span>
      ) : null}
      {/* Keeper Window mini-badge */}
      {player.keeperWindow && (
        <span
          className={`shrink-0 rounded-full border px-1 py-0 text-[9px] font-semibold ${player.keeperWindow.bgClass}`}
          title={`${player.keeperWindow.label} — ${player.keeperWindow.points}/8 pts`}
        >
          {player.keeperWindow.emoji}
        </span>
      )}
      <span className="text-[10px] text-primary/60 font-medium truncate max-w-[180px] shrink-0">
        {player.reasons[0] || ""}
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

// ─── Expand Levels ──────────────────────────────────────────

const EXPAND_OPTIONS = [
  { label: "Top 4", total: 4 },
  { label: "+2 More", total: 6 },
  { label: "+5 More", total: 9 },
  { label: "+8 More", total: 12 },
] as const;

const ALL_PLAYERS_PAGE_SIZE = 25;

// ─── Main Component ─────────────────────────────────────────

export default function SmartSuggestions({ players, myTeam, isMyPick, currentOverallPick, onDraft, teams, picks }: SmartSuggestionsProps) {
  const [expandLevel, setExpandLevel] = useState(0);
  const [viewMode, setViewMode] = useState<"smart" | "all">("smart");
  const [allPage, setAllPage] = useState(0);
  const [allPosFilter, setAllPosFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // Reset state when pick changes
  useEffect(() => {
    setExpandLevel(0);
    setViewMode("smart");
    setAllPage(0);
    setAllPosFilter("ALL");
    setSearchQuery("");
    setDebouncedSearch("");
  }, [currentOverallPick]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedSearch(e.target.value);
      setAllPage(0);
    }, 300);
  }, []);

  // Compute all scored players (single pass, both views use this)
  const allScored = useMemo(
    () => computeAllScored(players, myTeam, currentOverallPick),
    [players, myTeam, currentOverallPick],
  );

  // ── Rival Scout: next 3 non-JT pickers' RB/WR needs ──
  const rivals = useMemo(() => {
    if (!picks.length || !teams.length) return [];
    // Find the current pick by overall_pick number
    const currentIdx = picks.findIndex(
      (p) => p.overall_pick === currentOverallPick && !p.is_complete,
    );
    if (currentIdx === -1) return [];

    const upcoming: { pick: DraftPick; gap: number }[] = [];
    let count = 0;
    for (let i = currentIdx + 1; i < picks.length && upcoming.length < 3; i++) {
      count++;
      const pk = picks[i];
      if (pk.is_complete || pk.team_id === myTeam?.id) continue;
      upcoming.push({ pick: pk, gap: count });
    }

    return upcoming.map(({ pick: pk, gap }) => {
      const team = teams.find((t) => t.id === pk.team_id);
      const roster = players.filter(
        (p) =>
          (p.is_drafted && p.drafted_team_id === pk.team_id) ||
          (p.is_keeper && p.keeper_team_id === pk.team_id),
      );
      const rbCount = roster.filter((p) => p.position === "RB").length;
      const wrCount = roster.filter((p) => p.position === "WR").length;
      // Simple starter-threshold needs
      let rbSlots = 0;
      let wrSlots = 0;
      for (const slot of STARTING_SLOTS) {
        if ((slot.positions as readonly string[]).includes("RB")) rbSlots++;
        if ((slot.positions as readonly string[]).includes("WR")) wrSlots++;
      }
      const rbNeed = Math.max(0, rbSlots - rbCount);
      const wrNeed = Math.max(0, wrSlots - wrCount);
      const rbLevel: 0 | 1 | 2 = rbNeed >= 2 ? 2 : rbNeed >= 1 ? 1 : 0;
      const wrLevel: 0 | 1 | 2 = wrNeed >= 2 ? 2 : wrNeed >= 1 ? 1 : 0;

      return {
        teamName: team?.team_name ?? "Unknown",
        pickLabel: `${pk.round}.${String(pk.pick_in_round).padStart(2, "0")}`,
        gap,
        rb: { level: rbLevel, filled: rbCount, needed: rbNeed },
        wr: { level: wrLevel, filled: wrCount, needed: wrNeed },
      };
    });
  }, [picks, teams, players, currentOverallPick, myTeam?.id]);

  // Smart picks (top N)
  const maxResults = EXPAND_OPTIONS[expandLevel].total;
  const suggestions = useMemo(() => allScored.slice(0, maxResults), [allScored, maxResults]);

  // All players view — filtered + paginated
  const { allFiltered, allPaged, allTotalPages } = useMemo(() => {
    let filtered = allScored;

    if (debouncedSearch && debouncedSearch.length >= 2) {
      const q = debouncedSearch.toLowerCase();
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(q) || p.nfl_team.toLowerCase().includes(q),
      );
    }

    if (allPosFilter !== "ALL") {
      filtered = filtered.filter((p) => p.position === allPosFilter);
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / ALL_PLAYERS_PAGE_SIZE));
    const paged = filtered.slice(allPage * ALL_PLAYERS_PAGE_SIZE, (allPage + 1) * ALL_PLAYERS_PAGE_SIZE);

    return { allFiltered: filtered, allPaged: paged, allTotalPages: totalPages };
  }, [allScored, debouncedSearch, allPosFilter, allPage]);

  // Smart picks search results (for search within smart view)
  const searchResults = useMemo(() => {
    if (viewMode !== "smart" || !debouncedSearch || debouncedSearch.length < 2) return [];
    const q = debouncedSearch.toLowerCase();
    const suggestionIds = new Set(suggestions.map((s) => s.id));

    return allScored
      .filter(
        (p) =>
          !suggestionIds.has(p.id) &&
          (p.name.toLowerCase().includes(q) || p.nfl_team.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [viewMode, debouncedSearch, allScored, suggestions]);

  const [collapsed, setCollapsed] = useState(false);

  if (!isMyPick || allScored.length === 0) return null;

  return (
    <div className="border-b border-primary/20 bg-gradient-to-r from-primary/5 via-transparent to-primary/5 shrink-0">
      {/* Header row — always visible */}
      <div className="flex items-center gap-2 px-4 py-2">
        <Icon icon="sparkles" className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-bold uppercase tracking-wider text-primary">
          Smart Pick Suggestions
        </h3>
        <span className="text-[10px] text-muted-foreground">
          Pick #{currentOverallPick}
        </span>
        <span className="text-[9px] text-muted-foreground/60 ml-1">
          55 expert · 25 fit · 8 keeper · 10 tags · 5 tiebreak
        </span>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="ml-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title={collapsed ? "Expand suggestions" : "Collapse suggestions"}
        >
          <Icon icon={collapsed ? "chevron-down" : "chevron-up"} className="h-3.5 w-3.5" />
        </button>

        {/* Rival Scout pills — next 3 pickers' RB/WR needs */}
        {rivals.length > 0 && (
          <div className="flex items-center gap-1.5 ml-3 pl-3 border-l border-border/40">
            <span className="text-[10px] text-muted-foreground/50">🎯</span>
            {rivals.map((r, i) => {
              const maxLevel = Math.max(r.rb.level, r.wr.level);
              const pillBorder = maxLevel === 2 ? "border-red-500/30" : maxLevel === 1 ? "border-amber-500/25" : "border-border/40";
              const pillBg = maxLevel === 2 ? "bg-red-500/8" : maxLevel === 1 ? "bg-amber-500/8" : "bg-card/40";
              const levelIcon = (l: number) => l === 2 ? "🔴" : l === 1 ? "🟡" : "✅";
              return (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold ${pillBorder} ${pillBg}`}
                  title={`${r.teamName} (${r.pickLabel}, ${r.gap === 1 ? "next" : `+${r.gap}`}) — RB: ${r.rb.filled} rostered, needs ${r.rb.needed} · WR: ${r.wr.filled} rostered, needs ${r.wr.needed}`}
                >
                  <span className="text-[8px] text-muted-foreground/60">{r.gap === 1 ? "next" : `+${r.gap}`}</span>
                  <span className="truncate max-w-[52px]">{getTeamEmoji(r.teamName)}{r.teamName.split(" ")[0]}</span>
                  <span>{levelIcon(r.rb.level)}<span className="font-bold">RB</span></span>
                  <span>{levelIcon(r.wr.level)}<span className="font-bold">WR</span></span>
                </span>
              );
            })}
          </div>
        )}

        {/* View Mode toggle (hidden when collapsed) */}
        {!collapsed && <div className="flex items-center gap-1 bg-secondary/40 rounded-md p-0.5 ml-auto">
          <button
            onClick={() => { setViewMode("smart"); setAllPage(0); }}
            className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
              viewMode === "smart"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon icon="sparkles" className="h-3 w-3 inline mr-1" />
            Smart Picks
          </button>
          <button
            onClick={() => setViewMode("all")}
            className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
              viewMode === "all"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon icon="list" className="h-3 w-3 inline mr-1" />
            All Players ({allScored.length})
          </button>
        </div>}
      </div>

      {/* Collapsible body — capped at 50vh */}
      {!collapsed && (
      <div className="overflow-y-auto px-4 pb-3" style={{ maxHeight: "50vh" } as CSSProperties}>

      {/* ─── SMART PICKS VIEW ─── */}
      {viewMode === "smart" && (
        <>
          {/* Expand toggles + Search bar */}
          <div className="flex items-center gap-2 mb-2.5 flex-wrap">
            <div className="flex items-center gap-1 bg-secondary/40 rounded-md p-0.5">
              {EXPAND_OPTIONS.map((opt, i) => (
                <button
                  key={opt.label}
                  onClick={() => setExpandLevel(i)}
                  className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                    expandLevel === i
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[200px]">
              <Icon icon="search" className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search available players..."
                className="pl-7 h-7 text-xs bg-secondary/40 border-border/30"
              />
            </div>
          </div>

          {/* Suggestion cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {suggestions.map((player, i) => (
              <SuggestionCard
                key={player.id}
                player={player}
                rank={i + 1}
                onDraft={onDraft}
                showByeWarning
                currentOverallPick={currentOverallPick}
              />
            ))}
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border/30">
              <div className="flex items-center gap-1.5 mb-2">
                <Icon icon="search" className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Search Results
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {searchResults.map((player, i) => (
                  <SuggestionCard
                    key={player.id}
                    player={player}
                    rank={maxResults + i + 1}
                    onDraft={onDraft}
                    showByeWarning={false}
                    currentOverallPick={currentOverallPick}
                  />
                ))}
              </div>
            </div>
          )}

          {debouncedSearch.length >= 2 && searchResults.length === 0 && (
            <div className="mt-2 text-center text-[10px] text-muted-foreground py-2">
              No available players match &ldquo;{debouncedSearch}&rdquo;
            </div>
          )}

          {/* Draft Superlatives — ADP-based value tiles */}
          <div className="mt-3">
            <DraftSuperlatives
              players={players}
              currentOverallPick={currentOverallPick}
              onDraft={onDraft}
              keeperCount={players.filter((p) => p.is_keeper).length}
            />
          </div>
        </>
      )}

      {/* ─── ALL PLAYERS VIEW ─── */}
      {viewMode === "all" && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {/* Position filter */}
            <div className="flex items-center gap-1 bg-secondary/40 rounded-md p-0.5">
              {(["ALL", "QB", "RB", "WR", "TE"] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => { setAllPosFilter(pos); setAllPage(0); }}
                  className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                    allPosFilter === pos
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Icon icon="search" className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search all available players..."
                className="pl-7 h-7 text-xs bg-secondary/40 border-border/30"
              />
            </div>

            {/* Page info */}
            <span className="text-[10px] text-muted-foreground">
              {allFiltered.length} players
            </span>
          </div>

          {/* Compact header */}
          <div className="flex items-center gap-2 px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50 border-b border-border/30">
            <span className="w-5 text-right">#</span>
            <span className="w-10">Score</span>
            <span className="w-10">Pos</span>
            <span className="flex-1">Player</span>
            <span className="w-8">Team</span>
            <span className="w-12 text-right">ADP</span>
            <span className="w-12 text-right">Dynasty</span>
            <span className="max-w-[180px]">Why</span>
            <span className="w-12"></span>
          </div>

          {/* Scrollable list */}
          <ScrollArea className="max-h-[320px] min-h-0 overflow-hidden">
            {allPaged.map((player, i) => (
              <AllPlayersRow
                key={player.id}
                player={player}
                rank={allPage * ALL_PLAYERS_PAGE_SIZE + i + 1}
                onDraft={onDraft}
              />
            ))}
          </ScrollArea>

          {/* Pagination controls */}
          {allTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-2 pt-2 border-t border-border/30">
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={allPage === 0}
                onClick={() => setAllPage((p) => p - 1)}
              >
                <Icon icon="chevron-left" className="h-3 w-3" />
                Prev
              </Button>
              <span className="text-[10px] text-muted-foreground tabular-nums">
                Page {allPage + 1} of {allTotalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px]"
                disabled={allPage >= allTotalPages - 1}
                onClick={() => setAllPage((p) => p + 1)}
              >
                Next
                <Icon icon="chevron-right" className="h-3 w-3" />
              </Button>
            </div>
          )}
        </>
      )}
      </div>
      )}
    </div>
  );
}
