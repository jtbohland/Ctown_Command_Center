/**
 * Board-aware BPA grading engine for the C-Town Redux! draft.
 *
 * For each pick, simulates the available player pool at that moment
 * (keepers removed, previously drafted players removed), then grades
 * the pick relative to who was still on the board.
 */
import type { Player, DraftPick } from "@/lib/draft-constants";

// ─── Types ──────────────────────────────────────────────────

export type PickClassification = "steal" | "right" | "reach" | "positional_waste";

export type GradedPick = {
  player: Player;
  pick: DraftPick;
  /** Where this player ranked among ALL available (by ADP). 1 = best available */
  overallBpaRank: number;
  /** Where this player ranked among available at SAME POSITION. 0 if not RB/WR */
  positionBpaRank: number;
  /** Where this player ranked among available RB/WR specifically */
  rbWrBpaRank: number;
  /** Classification of this pick */
  classification: PickClassification;
  /** Numeric score: positive = good, negative = bad */
  score: number;
  /** Top 3 better RB/WR that were available (for reaches) */
  receipts: { name: string; position: string; adpRank: number }[];
  /** Top 5 best available players at this pick (all positions, actually drafted only) */
  boardContext: { name: string; position: string; adpRank: number; wasDrafted: boolean }[];
  /** Best available RB/WR at this pick */
  bestAvailableRbWr: { name: string; position: string; adpRank: number } | null;
  /** How far the player fell in available pool vs ADP (for QB/TE bonus) */
  adpFallBonus: number;
  /** Whether this is a positional waste (2nd+ QB/TE when quality RB/WR on board) */
  isPositionalWaste: boolean;
};

export type TeamGrade = {
  teamId: number;
  teamName: string;
  managerName: string;
  color: string;
  isMyTeam: boolean;
  rank: number;
  grade: string;
  totalScore: number;
  avgScore: number;
  picks: GradedPick[];
  stealCount: number;
  reachCount: number;
  wasteCount: number;
  bestSteal: GradedPick | null;
  biggestReach: GradedPick | null;
  posCounts: Record<string, number>;
  championships: number;
};

// ─── Helpers ────────────────────────────────────────────────

function gradeFromRank(rank: number, total: number): string {
  const pct = (rank - 1) / Math.max(total - 1, 1);
  if (pct <= 0.09) return "A+";
  if (pct <= 0.18) return "A";
  if (pct <= 0.27) return "A-";
  if (pct <= 0.36) return "B+";
  if (pct <= 0.50) return "B";
  if (pct <= 0.63) return "B-";
  if (pct <= 0.72) return "C+";
  if (pct <= 0.81) return "C";
  if (pct <= 0.90) return "D";
  return "F";
}

export function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-green-400";
  if (grade.startsWith("B")) return "text-blue-400";
  if (grade.startsWith("C")) return "text-amber-400";
  if (grade === "D") return "text-orange-400";
  return "text-red-400";
}

export function gradeBg(grade: string): string {
  if (grade.startsWith("A")) return "bg-green-500/10 border-green-500/20";
  if (grade.startsWith("B")) return "bg-blue-500/10 border-blue-500/20";
  if (grade.startsWith("C")) return "bg-amber-500/10 border-amber-500/20";
  if (grade === "D") return "bg-orange-500/10 border-orange-500/20";
  return "bg-red-500/10 border-red-500/20";
}

export function rankMedal(rank: number): string {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `#${rank}`;
}

export function classificationEmoji(c: PickClassification): string {
  switch (c) {
    case "steal": return "🎯";
    case "right": return "✅";
    case "reach": return "📉";
    case "positional_waste": return "🗑️";
  }
}

export function classificationLabel(c: PickClassification): string {
  switch (c) {
    case "steal": return "Steal";
    case "right": return "Right Pick";
    case "reach": return "Reach";
    case "positional_waste": return "Pos. Waste";
  }
}

// ─── Core Grading Algorithm ─────────────────────────────────

export function gradeDraft(
  players: Player[],
  picks: DraftPick[],
  teams: { id: number; team_name: string; manager_name: string; color: string; is_my_team: boolean; championships: number }[],
): { teamGrades: TeamGrade[]; leagueAvg: number } {
  // Build the draftable pool: all players who are NOT keepers AND have ADP data
  const allDraftable = players.filter((p) => !p.is_keeper && p.adp_rank != null);

  // Build a set of player IDs who were actually drafted — only these are
  // valid "passed on" candidates. A player nobody picked across 121 slots
  // is either a ghost record or genuinely unwanted, not a real BPA option.
  const actuallyDraftedIds = new Set(
    picks.filter((p) => p.is_complete && p.player_id != null).map((p) => p.player_id!),
  );

  // Sort picks by overall_pick order
  const completedPicks = picks
    .filter((p) => p.is_complete && p.player_id != null)
    .sort((a, b) => a.overall_pick - b.overall_pick);

  if (completedPicks.length === 0) {
    return { teamGrades: [], leagueAvg: 0 };
  }

  // Track who has been drafted so far (player IDs)
  const draftedIds = new Set<number>();

  // Track how many QB/TE each team has drafted (for positional waste detection)
  const teamQbCount = new Map<number, number>();
  const teamTeCount = new Map<number, number>();

  // Grade each pick in order
  const gradedPicksByTeam = new Map<number, GradedPick[]>();

  for (const pick of completedPicks) {
    const player = players.find((p) => p.id === pick.player_id);
    if (!player) {
      draftedIds.add(pick.player_id!);
      continue;
    }

    // Available pool at this moment: all draftable players not yet picked
    const available = allDraftable
      .filter((p) => !draftedIds.has(p.id))
      .sort((a, b) => (a.adp_rank ?? 999) - (b.adp_rank ?? 999));

    // Available RB/WR specifically
    const availableRbWr = available.filter((p) => p.position === "RB" || p.position === "WR");

    // For receipts: only include RB/WR who were ACTUALLY drafted later.
    // This prevents phantom/unwanted players from polluting the "passed on" list.
    const receiptCandidates = availableRbWr.filter(
      (p) => p.id !== player.id && actuallyDraftedIds.has(p.id),
    );

    // Where did this player rank in the available pool?
    const overallBpaRank = available.findIndex((p) => p.id === player.id) + 1 || available.length + 1;

    // Position-specific rank
    const samePosition = available.filter((p) => p.position === player.position);
    const positionBpaRank = samePosition.findIndex((p) => p.id === player.id) + 1 || samePosition.length + 1;

    // RB/WR rank (0 if player is QB/TE)
    const isRbWr = player.position === "RB" || player.position === "WR";
    const rbWrBpaRank = isRbWr
      ? (availableRbWr.findIndex((p) => p.id === player.id) + 1 || availableRbWr.length + 1)
      : 0;

    // Best available RB/WR at this pick
    const bestRbWr = availableRbWr[0] ?? null;
    const bestAvailableRbWr = bestRbWr
      ? { name: bestRbWr.name, position: bestRbWr.position, adpRank: bestRbWr.adp_rank ?? 999 }
      : null;

    // Top 3 better RB/WR who were actually drafted later (receipts for reaches)
    const receipts = receiptCandidates
      .slice(0, 3)
      .map((p) => ({ name: p.name, position: p.position, adpRank: p.adp_rank ?? 999 }));

    // Top 5 board alternatives for the context dropdown.
    // Prioritize RB/WR (the premium positions the grading is based on),
    // then fill remaining slots with QB/TE/K if fewer than 5 RB/WR were available.
    const draftedFilter = (p: Player) => p.id !== player.id && actuallyDraftedIds.has(p.id);
    const topRbWr = availableRbWr.filter(draftedFilter).slice(0, 5);
    const remaining = 5 - topRbWr.length;
    const topOther = remaining > 0
      ? available.filter((p) => p.position !== "RB" && p.position !== "WR" && draftedFilter(p)).slice(0, remaining)
      : [];
    const boardContext = [...topRbWr, ...topOther].map((p) => ({
      name: p.name,
      position: p.position,
      adpRank: p.adp_rank ?? 999,
      wasDrafted: true,
    }));

    // ADP fall bonus for QB/TE — how far they fell in the available pool
    const adpFallBonus = (!isRbWr && player.adp_rank != null)
      ? Math.max(0, overallBpaRank - 1) // if ranked #5 in pool but ADP says they should be gone
      : 0;
    const bigFall = adpFallBonus >= 40;

    // Track positional counts
    const teamId = pick.team_id;
    if (player.position === "QB") {
      teamQbCount.set(teamId, (teamQbCount.get(teamId) ?? 0) + 1);
    } else if (player.position === "TE") {
      teamTeCount.set(teamId, (teamTeCount.get(teamId) ?? 0) + 1);
    }

    const qbCount = teamQbCount.get(teamId) ?? 0;
    const teCount = teamTeCount.get(teamId) ?? 0;

    // ─── Classify the pick ───────────────────────────────
    let classification: PickClassification;
    let score: number;
    let isPositionalWaste = false;

    if (isRbWr) {
      // RB/WR picks: grade based on position BPA rank
      if (rbWrBpaRank <= 3) {
        classification = "steal";
        score = Math.max(1, 4 - rbWrBpaRank) * 3; // 9, 6, 3 for ranks 1-3
      } else if (rbWrBpaRank <= 7) {
        classification = "right";
        score = Math.max(0, 8 - rbWrBpaRank); // 3, 2, 1, 0 for ranks 4-7
      } else {
        classification = "reach";
        score = -Math.min(15, rbWrBpaRank - 5); // negative, capped at -15
      }
    } else {
      // QB/TE picks
      if (bigFall) {
        // Credit: player fell 40+ ADP spots in available pool
        classification = "steal";
        score = Math.min(6, Math.floor(adpFallBonus / 10));
      } else if (
        (player.position === "QB" && qbCount > 1) ||
        (player.position === "TE" && teCount > 1)
      ) {
        // 2nd+ QB or TE when quality RB/WR is available
        const bestRbWrAdp = availableRbWr[0]?.adp_rank ?? 999;
        if (bestRbWrAdp < 150) {
          classification = "positional_waste";
          isPositionalWaste = true;
          score = -5;
        } else {
          classification = "right";
          score = 0;
        }
      } else if (positionBpaRank <= 2) {
        // Best QB/TE available — fair pick
        classification = "right";
        score = 2;
      } else {
        classification = "right";
        score = 0;
      }
    }

    const gradedPick: GradedPick = {
      player,
      pick,
      overallBpaRank,
      positionBpaRank,
      rbWrBpaRank,
      classification,
      score,
      receipts: classification === "reach" ? receipts : [],
      boardContext,
      bestAvailableRbWr,
      adpFallBonus,
      isPositionalWaste,
    };

    const existing = gradedPicksByTeam.get(teamId) ?? [];
    existing.push(gradedPick);
    gradedPicksByTeam.set(teamId, existing);

    // Mark player as drafted
    draftedIds.add(player.id);
  }

  // ─── Build team grades ──────────────────────────────────
  const rawGrades: Omit<TeamGrade, "rank" | "grade">[] = teams.map((team) => {
    const teamPicks = gradedPicksByTeam.get(team.id) ?? [];
    const totalScore = teamPicks.reduce((sum, p) => sum + p.score, 0);
    const avgScore = teamPicks.length > 0 ? totalScore / teamPicks.length : 0;

    const steals = teamPicks.filter((p) => p.classification === "steal");
    const reaches = teamPicks.filter((p) => p.classification === "reach");
    const wastes = teamPicks.filter((p) => p.classification === "positional_waste");

    const bestSteal = steals.length > 0
      ? steals.reduce((best, p) => (p.score > best.score ? p : best))
      : null;
    const biggestReach = reaches.length > 0
      ? reaches.reduce((worst, p) => (p.score < worst.score ? p : worst))
      : null;

    const posCounts: Record<string, number> = {};
    for (const gp of teamPicks) {
      posCounts[gp.player.position] = (posCounts[gp.player.position] ?? 0) + 1;
    }

    return {
      teamId: team.id,
      teamName: team.team_name,
      managerName: team.manager_name,
      color: team.color,
      isMyTeam: team.is_my_team,
      totalScore,
      avgScore,
      picks: teamPicks,
      stealCount: steals.length,
      reachCount: reaches.length,
      wasteCount: wastes.length,
      bestSteal,
      biggestReach,
      posCounts,
      championships: team.championships,
    };
  });

  // Sort by totalScore descending
  rawGrades.sort((a, b) => b.totalScore - a.totalScore);

  const total = rawGrades.length;
  const leagueTotal = rawGrades.reduce((s, t) => s + t.avgScore, 0);
  const leagueAvg = total > 0 ? leagueTotal / total : 0;

  const teamGrades: TeamGrade[] = rawGrades.map((t, i) => ({
    ...t,
    rank: i + 1,
    grade: gradeFromRank(i + 1, total),
  }));

  return { teamGrades, leagueAvg };
}
