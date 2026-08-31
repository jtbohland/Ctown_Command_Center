import { useMemo, useState, useCallback, memo } from "react";
import { useApi } from "@/hooks/useApi";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  const { player, pick, classification, score, receipts, rbWrBpaRank, overallBpaRank, adpFallBonus } = gp;

  return (
    <div className="flex items-start gap-1.5 text-[11px] py-0.5">
      <span className="text-muted-foreground font-mono w-8 text-right shrink-0">
        {pick.round}.{String(pick.pick_in_round).padStart(2, "0")}
      </span>
      <span className="w-4 text-center shrink-0" title={classificationLabel(classification)}>
        {classificationEmoji(classification)}
      </span>
      <PositionBadge position={player.position} />
      <span className="flex-1 min-w-0 truncate">{player.name}</span>
      <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
        ADP {player.adp_rank ?? "—"}
      </span>
      <span className="text-[10px] text-muted-foreground shrink-0 w-10 text-right tabular-nums">
        BPA #{overallBpaRank}
      </span>
      <span
        className={cn(
          "text-[10px] font-mono font-bold shrink-0 w-8 text-right tabular-nums",
          score > 0 ? "text-green-400" : score < 0 ? "text-red-400" : "text-muted-foreground",
        )}
      >
        {score > 0 ? "+" : ""}{score}
      </span>
      {/* Reach receipts */}
      {classification === "reach" && receipts.length > 0 && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-red-400/70 cursor-help text-[9px] ml-0.5 shrink-0">📋</span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-60">
              <p className="text-[10px] font-semibold mb-1">Better RB/WR available:</p>
              {receipts.map((r, i) => (
                <p key={i} className="text-[10px]">
                  {i + 1}. {r.name} ({r.position}) — ADP {r.adpRank}
                </p>
              ))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {/* QB/TE fall bonus indicator */}
      {adpFallBonus >= 40 && (
        <span className="text-green-400/70 text-[9px] ml-0.5 shrink-0" title={`Fell ${adpFallBonus} spots in available pool`}>
          ⬇️
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
        <div className="space-y-0.5 pt-1 border-t border-border/50">
          {tg.picks.map((gp) => (
            <PickRow key={gp.pick.id} gp={gp} />
          ))}
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
          <p className="font-semibold text-foreground text-xs">How Board-Aware BPA Grading Works</p>
          <p>
            For every pick, we simulate who was still on the board at that moment — <strong>keepers are excluded</strong> from the pool
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
