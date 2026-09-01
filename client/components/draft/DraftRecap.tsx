import { useMemo, useState, useCallback, memo } from "react";
import { useApi } from "@/hooks/useApi";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import PositionBadge from "./PositionBadge";
import { cn } from "@/lib/utils";
import { getTeamEmoji, type Player, type Team, type DraftPick } from "@/lib/draft-constants";
import {
  gradeDraft,
  gradeColor,
  gradeBg,
  rankMedal,
  classificationEmoji,
  classificationLabel,
  type TeamGrade,
  type GradedPick,
} from "@/lib/draft-grading";

// ─── Types ──────────────────────────────────────────────────
type DraftRecapProps = {
  players: Player[];
  teams: Team[];
  picks: DraftPick[];
};

// ─── Pick Row ───────────────────────────────────────────────
const PickRow = memo(function PickRow({ gp }: { gp: GradedPick }) {
  const { player, pick, classification, score, boardContext, overallBpaRank, adpFallBonus } = gp;
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 text-[11px] py-[3px] w-full text-left rounded-sm transition-colors cursor-pointer",
          open ? "bg-white/[0.04]" : "hover:bg-white/[0.02]",
        )}
      >
        <span className="text-muted-foreground font-mono w-8 text-right shrink-0">
          {pick.round}.{String(pick.pick_in_round).padStart(2, "0")}
        </span>
        <span className="w-4 text-center shrink-0" title={classificationLabel(classification)}>
          {classificationEmoji(classification)}
        </span>
        <span className="w-7 shrink-0"><PositionBadge position={player.position} /></span>
        <span className="flex-1 min-w-0 truncate">{player.name}</span>
        <span className="text-[10px] text-muted-foreground shrink-0 w-12 text-right tabular-nums">
          {player.adp_rank ?? "—"}
        </span>
        <span
          className="text-[10px] text-muted-foreground shrink-0 w-12 text-right tabular-nums"
          title={`#${overallBpaRank} best player still on the board when this pick was made`}
        >
          #{overallBpaRank}
        </span>
        <span
          className={cn(
            "text-[10px] font-mono font-bold shrink-0 w-8 text-right tabular-nums",
            score > 0 ? "text-green-400" : score < 0 ? "text-red-400" : "text-muted-foreground",
          )}
          title={score > 0 ? `+${score} — great value pick` : score < 0 ? `${score} — reached for this player` : "0 — picked right at expected value"}
        >
          {score > 0 ? "+" : ""}{score}
        </span>
        <span
          className={cn(
            "text-[10px] font-mono shrink-0 w-10 text-right tabular-nums",
            player.adp_rank != null
              ? (player.adp_rank - pick.overall_pick) > 0 ? "text-red-400/70" : "text-green-400/70"
              : "text-muted-foreground/40",
          )}
          title={player.adp_rank != null
            ? (() => {
                const d = Math.round(player.adp_rank - pick.overall_pick);
                return d > 0
                  ? `Drafted ${d} picks before experts expected — a reach`
                  : d < 0
                    ? `Drafted ${Math.abs(d)} picks later than expected — a bargain`
                    : "Drafted right where experts expected";
              })()
            : "No expert ranking available"
          }
        >
          {player.adp_rank != null
            ? (() => { const d = Math.round(player.adp_rank - pick.overall_pick); return d > 0 ? `+${d}` : `${d}`; })()
            : "—"}
        </span>
        <Icon
          icon={open ? "chevron-up" : "chevron-down"}
          className="h-3 w-3 text-muted-foreground/40 shrink-0"
        />
      </button>

      {/* Board context dropdown */}
      {open && boardContext.length > 0 && (
        <div className="ml-[52px] mr-6 mb-1.5 mt-0.5 rounded border border-border/40 bg-black/20 px-2.5 py-1.5">
          <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-1">
            Best available on the board at this pick
          </p>
          {boardContext.map((alt, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 text-[10px] py-[2px]"
            >
              <span className="text-muted-foreground/50 w-4 text-right font-mono">{i + 1}.</span>
              <PositionBadge position={alt.position} />
              <span className="flex-1 min-w-0 truncate text-muted-foreground">
                {alt.name}
              </span>
              <span className="text-[9px] text-muted-foreground/60 tabular-nums">
                ADP {alt.adpRank}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* QB/TE fall bonus indicator */}
      {adpFallBonus >= 40 && !open && (
        <span className="text-green-400/70 text-[9px] ml-[52px]" title={`Fell ${adpFallBonus} spots in available pool`}>
          ⬇️ Fell {adpFallBonus} spots — value grab
        </span>
      )}
    </div>
  );
});

// ─── Team Card ──────────────────────────────────────────────
const TeamRecapCard = memo(function TeamRecapCard({
  tg,
  aiSummary,
  leagueAvg,
}: {
  tg: TeamGrade;
  aiSummary: string | null;
  leagueAvg: number;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", gradeBg(tg.grade))}>
      {/* Header: rank + name + grade */}
      <div className="flex items-center gap-2">
        <span className="text-lg font-black min-w-[36px] text-center">
          {rankMedal(tg.rank)}
        </span>
        <span
          className="w-3 h-3 rounded-full ring-1 ring-white/10 shrink-0"
          style={{ backgroundColor: tg.color }}
        />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold truncate block">
            {getTeamEmoji(tg.teamName)} {tg.teamName}
            {tg.isMyTeam && <span className="text-primary ml-1 text-[10px]">(YOU)</span>}
          </span>
          <span className="text-[10px] text-muted-foreground">{tg.managerName}</span>
        </div>
        <span className={cn("text-2xl font-black", gradeColor(tg.grade))}>
          {tg.grade}
        </span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
        <span>
          Score:{" "}
          <span className={cn("font-bold", tg.totalScore > 0 ? "text-green-400" : tg.totalScore < 0 ? "text-red-400" : "")}>
            {tg.totalScore > 0 ? "+" : ""}{tg.totalScore}
          </span>
        </span>
        <span>
          Avg:{" "}
          <span className={cn("font-bold", tg.avgScore > leagueAvg ? "text-green-400" : tg.avgScore < leagueAvg ? "text-red-400" : "")}>
            {tg.avgScore > 0 ? "+" : ""}{tg.avgScore.toFixed(1)}
          </span>
        </span>
        <span className="text-green-400 font-semibold">
          🎯 {tg.stealCount} steal{tg.stealCount !== 1 ? "s" : ""}
        </span>
        <span className="text-red-400 font-semibold">
          📉 {tg.reachCount} reach{tg.reachCount !== 1 ? "es" : ""}
        </span>
        {tg.wasteCount > 0 && (
          <span className="text-orange-400 font-semibold">
            🗑️ {tg.wasteCount} waste{tg.wasteCount !== 1 ? "s" : ""}
          </span>
        )}
        <span>{tg.picks.length} picks</span>
      </div>

      {/* Position breakdown */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {Object.entries(tg.posCounts)
          .sort(([a], [b]) => {
            const order = ["QB", "RB", "WR", "TE", "K", "DST"];
            return order.indexOf(a) - order.indexOf(b);
          })
          .map(([pos, count]) => (
            <span key={pos} className="flex items-center gap-0.5">
              <PositionBadge position={pos} />
              <span className="text-[10px] text-muted-foreground font-mono">×{count}</span>
            </span>
          ))}
      </div>

      {/* Best Steal & Biggest Reach */}
      <div className="space-y-1">
        {tg.bestSteal && (
          <div className="text-[10px]">
            <span className="text-green-400 font-semibold">🎯 Best steal:</span>{" "}
            <span className="text-foreground">{tg.bestSteal.player.name}</span>{" "}
            <PositionBadge position={tg.bestSteal.player.position} />{" "}
            <span className="text-muted-foreground">
              at {tg.bestSteal.pick.round}.{String(tg.bestSteal.pick.pick_in_round).padStart(2, "0")}
              {" "}— BPA #{tg.bestSteal.overallBpaRank}
            </span>{" "}
            <span className="text-green-400 font-bold">+{tg.bestSteal.score}</span>
          </div>
        )}
        {tg.biggestReach && (
          <div className="text-[10px]">
            <span className="text-red-400 font-semibold">📉 Biggest reach:</span>{" "}
            <span className="text-foreground">{tg.biggestReach.player.name}</span>{" "}
            <PositionBadge position={tg.biggestReach.player.position} />{" "}
            <span className="text-muted-foreground">
              at {tg.biggestReach.pick.round}.{String(tg.biggestReach.pick.pick_in_round).padStart(2, "0")}
              {" "}— BPA #{tg.biggestReach.overallBpaRank}
            </span>{" "}
            <span className="text-red-400 font-bold">{tg.biggestReach.score}</span>
            {tg.biggestReach.receipts.length > 0 && (
              <span className="text-muted-foreground ml-1">
                (passed on {tg.biggestReach.receipts.map((r) => r.name).join(", ")})
              </span>
            )}
          </div>
        )}
      </div>

      {/* AI Summary */}
      {aiSummary && (
        <div className="text-[11px] text-muted-foreground/90 leading-relaxed italic border-l-2 border-primary/30 pl-2 mt-1">
          {aiSummary}
        </div>
      )}

      {/* Expand/collapse picks list */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-[10px] text-primary/70 hover:text-primary transition-colors cursor-pointer"
      >
        <Icon icon={expanded ? "chevron-up" : "chevron-down"} className="h-3 w-3" />
        {expanded ? "Hide" : "Show"} all picks
      </button>

      {expanded && (
        <div className="pt-1 border-t border-border/50">
          {/* Column headers */}
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60 uppercase tracking-wider font-semibold pb-1 mb-0.5 border-b border-border/30">
            <span className="w-8 text-right shrink-0">Pick</span>
            <span className="w-4 shrink-0" />
            <span className="w-7 shrink-0" />
            <span className="flex-1 min-w-0">Player</span>
            <span className="shrink-0 w-12 text-right">ADP</span>
            <span className="shrink-0 w-12 text-right" title="Best Player Available rank — where this player ranked among all undrafted players at pick time">BPA #</span>
            <span className="shrink-0 w-8 text-right" title="Value score — positive is good (steal), negative is bad (reach)">Val</span>
            <span className="shrink-0 w-10 text-right" title="ADP differential — how many picks earlier or later than experts expected">ADP ±</span>
            <span className="w-4 shrink-0" />
          </div>
          <div className="space-y-0">
            {tg.picks.map((gp) => (
              <PickRow key={gp.pick.id} gp={gp} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

// ─── Main Component ─────────────────────────────────────────
const DraftRecap = memo(function DraftRecap({ players, teams, picks }: DraftRecapProps) {
  const { run: generateRecap, loading: aiLoading, data: aiData } = useApi("GenerateDraftRecap");
  const [aiRequested, setAiRequested] = useState(false);

  const completedPicks = useMemo(
    () => picks.filter((p) => p.is_complete && p.player_id),
    [picks],
  );

  const isDraftComplete = completedPicks.length === picks.length && picks.length > 0;

  const { teamGrades, leagueAvg } = useMemo(
    () => gradeDraft(players, picks, teams),
    [players, picks, teams],
  );

  // Build AI summary map
  const aiSummaryMap = useMemo(() => {
    const map = new Map<string, string>();
    if (aiData?.summaries) {
      for (const s of aiData.summaries) {
        map.set(s.teamName, s.summary);
      }
    }
    return map;
  }, [aiData]);

  // Draft superlatives — top 5 steals, reaches, and perfect picks across all teams
  const superlatives = useMemo(() => {
    const allPicks = teamGrades.flatMap((tg) =>
      tg.picks.map((gp) => ({ ...gp, teamName: tg.teamName })),
    );
    // ADP differential: positive = ADP higher than pick slot (drafted before ADP)
    // For steals: players who fell the most (picked later than ADP) → most NEGATIVE diff
    // For reaches: players drafted earliest vs ADP → most POSITIVE diff
    const adpDiff = (gp: (typeof allPicks)[0]) => (gp.player.adp_rank ?? 999) - gp.pick.overall_pick;
    const isRbWr = (gp: (typeof allPicks)[0]) => gp.player.position === "RB" || gp.player.position === "WR";
    const isQbTe = (gp: (typeof allPicks)[0]) => gp.player.position === "QB" || gp.player.position === "TE";
    const hasAdp = (gp: (typeof allPicks)[0]) => gp.player.adp_rank != null;

    // Main 3 tiles — RB/WR only
    const steals = [...allPicks]
      .filter((p) => p.classification === "steal" && isRbWr(p) && hasAdp(p))
      .sort((a, b) => adpDiff(b) - adpDiff(a))
      .slice(0, 5);
    const reaches = [...allPicks]
      .filter((p) => (p.classification === "reach") && isRbWr(p) && hasAdp(p))
      .sort((a, b) => adpDiff(b) - adpDiff(a))
      .slice(0, 5);
    const perfect = [...allPicks]
      .filter((p) => isRbWr(p) && hasAdp(p))
      .sort((a, b) =>
        Math.abs((a.player.adp_rank ?? 999) - a.pick.overall_pick) -
        Math.abs((b.player.adp_rank ?? 999) - b.pick.overall_pick),
      )
      .slice(0, 5);

    // QB/TE corner — one QB and one TE per category
    const qbPicks = allPicks.filter((p) => p.player.position === "QB" && hasAdp(p));
    const tePicks = allPicks.filter((p) => p.player.position === "TE" && hasAdp(p));
    const bestByFall = (arr: typeof allPicks) => [...arr].sort((a, b) => adpDiff(b) - adpDiff(a))[0] ?? null;
    const worstWaste = (arr: typeof allPicks) => [...arr].filter((p) => p.classification === "positional_waste").sort((a, b) => a.score - b.score)[0] ?? null;
    const bestTiming = (arr: typeof allPicks) => [...arr].sort((a, b) =>
      Math.abs((a.player.adp_rank ?? 999) - a.pick.overall_pick) - Math.abs((b.player.adp_rank ?? 999) - b.pick.overall_pick),
    )[0] ?? null;

    const qbTe = {
      bestFall: { qb: bestByFall(qbPicks), te: bestByFall(tePicks) },
      worstWaste: { qb: worstWaste(qbPicks), te: worstWaste(tePicks) },
      perfect: { qb: bestTiming(qbPicks), te: bestTiming(tePicks) },
    };

    return { steals, reaches, perfect, qbTe };
  }, [teamGrades]);

  const handleGenerateAI = useCallback(async () => {
    setAiRequested(true);
    try {
      await generateRecap({
        leagueAvgValue: leagueAvg,
        teams: teamGrades.map((tg) => ({
          teamName: tg.teamName,
          managerName: tg.managerName,
          rank: tg.rank,
          grade: tg.grade,
          totalValue: tg.totalScore,
          avgValue: tg.avgScore,
          stealCount: tg.stealCount,
          reachCount: tg.reachCount,
          wasteCount: tg.wasteCount,
          picks: tg.picks.map((gp) => ({
            playerName: gp.player.name,
            position: gp.player.position,
            round: gp.pick.round,
            pickInRound: gp.pick.pick_in_round,
            overallPick: gp.pick.overall_pick,
            adpRank: gp.player.adp_rank,
            value: gp.score,
            classification: gp.classification,
            bpaRank: gp.overallBpaRank,
            receipts: gp.receipts.map((r) => `${r.name} (${r.position})`),
          })),
        })),
      });
    } catch {
      // error is available via the hook
    }
  }, [generateRecap, teamGrades, leagueAvg]);

  if (completedPicks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
        <span className="text-4xl">📋</span>
        <p className="text-sm">Draft recap will appear here once picks are made</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-bold">
              {isDraftComplete ? "🏆 Final Draft Recap" : "📊 Draft Recap (In Progress)"}
            </h2>
            <span className="text-xs text-muted-foreground">
              {completedPicks.length}/{picks.length} picks • Board-aware BPA grading • League avg:{" "}
              <span className={cn("font-bold", leagueAvg > 0 ? "text-green-400" : leagueAvg < 0 ? "text-red-400" : "")}>
                {leagueAvg > 0 ? "+" : ""}{leagueAvg.toFixed(1)}
              </span>
            </span>
          </div>
          {isDraftComplete && !aiRequested && (
            <Button size="sm" variant="outline" onClick={handleGenerateAI} disabled={aiLoading} className="gap-1.5">
              <Icon icon="sparkles" className="h-3.5 w-3.5" />
              Generate AI Summaries
            </Button>
          )}
          {aiLoading && (
            <span className="text-xs text-muted-foreground animate-pulse">
              ✨ Gemini is analyzing the draft...
            </span>
          )}
        </div>

        {/* Legend */}
        <div className="rounded-lg border border-border/50 bg-card/50 p-3 text-[11px] text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground text-xs">How Board-Aware BPA (Best Player Available) Grading Works</p>
          <p>
            <strong>BPA = Best Player Available.</strong> For every pick, we simulate who was still on the board at that moment — <strong>keepers are excluded</strong> from the pool
            (they were never available). Then we rank the pick against the best remaining players.
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <p>🎯 <strong className="text-green-400">Steal</strong> — Took a top-3 available RB/WR at their position</p>
            <p>✅ <strong className="text-blue-400">Right Pick</strong> — Solid value, top-7 available RB/WR</p>
            <p>📉 <strong className="text-red-400">Reach</strong> — Passed on clearly better RB/WR (receipts shown)</p>
            <p>🗑️ <strong className="text-orange-400">Pos. Waste</strong> — 2nd QB/TE when quality RB/WR was on board</p>
          </div>
          <p>
            <strong>QB/TE bonus:</strong> If a QB or TE fell 40+ ADP spots in the available pool, it counts as a steal (value grab).
          </p>
          <p>
            <strong>Grades</strong> are curved 1→{teams.length} — top scorer gets A+, bottom gets F. Scores sum each pick's BPA rating.
          </p>
        </div>

        {/* Draft Superlatives */}
        {teamGrades.length > 0 && (
          <>
          <div className="grid grid-cols-4 gap-3">
            {([
              { title: "🎯 Biggest Steals", items: superlatives.steals, color: "green" },
              { title: "📉 Biggest Reaches", items: superlatives.reaches, color: "red" },
              { title: "✅ Perfect Picks", items: superlatives.perfect, color: "blue" },
            ] as const).map(({ title, items, color }) => (
              <div
                key={title}
                className={cn(
                  "rounded-lg border p-2.5",
                  color === "green" && "border-green-500/20 bg-green-500/5",
                  color === "red" && "border-red-500/20 bg-red-500/5",
                  color === "blue" && "border-blue-500/20 bg-blue-500/5",
                )}
              >
                <p className={cn(
                  "text-[10px] uppercase tracking-wider font-bold mb-2",
                  color === "green" && "text-green-400",
                  color === "red" && "text-red-400",
                  color === "blue" && "text-blue-400",
                )}>
                  {title}
                </p>
                <div className="space-y-1">
                  {items.map((gp, i) => (
                    <div key={gp.pick.id} className="space-y-0">
                      <div className="flex items-center gap-1.5 text-[10px]">
                        <span className={cn(
                          "font-bold w-3 text-right",
                          color === "green" && "text-green-400/60",
                          color === "red" && "text-red-400/60",
                          color === "blue" && "text-blue-400/60",
                        )}>
                          {i + 1}
                        </span>
                        <PositionBadge position={gp.player.position} />
                        <span className="flex-1 min-w-0 truncate font-medium">{gp.player.name}</span>
                        <span className={cn(
                          "font-bold tabular-nums text-[10px]",
                          color === "green" && "text-green-400",
                          color === "red" && "text-red-400",
                          color === "blue" && "text-blue-400",
                        )}>
                          {(() => {
                            const diff = Math.round((gp.player.adp_rank ?? 0) - gp.pick.overall_pick);
                            if (color === "blue") return `±${Math.abs(diff)}`;
                            if (color === "green") { const fall = -diff; return fall > 0 ? `+${fall}` : `${fall}`; }
                            return diff > 0 ? `+${diff}` : `${diff}`;
                          })()}
                        </span>
                      </div>
                      <div className="text-[9px] text-muted-foreground/50 ml-[18px]">
                        Pick {gp.pick.round}.{String(gp.pick.pick_in_round).padStart(2, "0")} · ADP {gp.player.adp_rank ?? "—"} · {gp.teamName}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* QB/TE Corner */}
            <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-2.5">
              <p className="text-[10px] uppercase tracking-wider font-bold mb-2 text-purple-400">
                🧊 QB/TE Corner
              </p>
              <div className="space-y-2">
                {(
                  [
                    { label: "Best Value", qb: superlatives.qbTe.bestFall.qb, te: superlatives.qbTe.bestFall.te },
                    { label: "Worst Waste", qb: superlatives.qbTe.worstWaste.qb, te: superlatives.qbTe.worstWaste.te },
                    { label: "Perfect Timing", qb: superlatives.qbTe.perfect.qb, te: superlatives.qbTe.perfect.te },
                  ] as const
                ).map(({ label, qb, te }) => (
                  <div key={label}>
                    <p className="text-[9px] uppercase tracking-wider text-purple-400/60 font-semibold">{label}</p>
                    {[qb, te].map((entry) =>
                      entry ? (
                        <div key={entry.pick.id} className="flex items-center gap-1.5 text-[10px]">
                          <PositionBadge position={entry.player.position} />
                          <span className="font-medium truncate flex-1 min-w-0">{entry.player.name}</span>
                          <span className="text-[9px] text-muted-foreground/50 shrink-0">
                            {entry.pick.round}.{String(entry.pick.pick_in_round).padStart(2, "0")} · ADP {entry.player.adp_rank ?? "—"}
                          </span>
                        </div>
                      ) : null,
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="text-[9px] text-muted-foreground/40 mt-1.5 text-center">
            Numbers show ADP vs. pick slot — Steals fell past their ADP (great value). Reaches were drafted before their ADP. Perfect Picks had the closest ADP-to-slot match.
          </p>
          </>
        )}

        {/* Team Cards */}
        <div className="space-y-3">
          {teamGrades.map((tg) => (
            <TeamRecapCard
              key={tg.teamId}
              tg={tg}
              aiSummary={aiSummaryMap.get(tg.teamName) ?? null}
              leagueAvg={leagueAvg}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
});

export default DraftRecap;
