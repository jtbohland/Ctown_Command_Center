// ─────────────────────────────────────────────────────────────────────────────
// C-TOWN ROSTER GRADE RAMP
// ─────────────────────────────────────────────────────────────────────────────
//
// A separate actuals-weight schedule tuned for the C-Town fantasy calendar:
//   • 14-week regular season (weeks 1–14)
//   • 3-week playoffs (weeks 15–17)
//   • Week 18 is NFL-only — not played
//
// This ramp is ONLY used for Redux Rosters team grades and the trajectory
// chart. Trade verdicts and historical valuations continue to use the
// canonical valuation-spec.ts schedule.
// ─────────────────────────────────────────────────────────────────────────────

import {
  NFL_WEEK1_TUESDAY,
  CURRENT_SEASON,
  BASE_VALUE,
  POWER,
  calcPlayerValue,
} from "./valuation-spec.js";

/** C-Town fantasy regular season length. */
export const CTOWN_REGULAR_SEASON_WEEKS = 14;

/** C-Town fantasy playoff weeks. */
export const CTOWN_PLAYOFF_WEEKS = [15, 16, 17] as const;

/** Total fantasy-relevant weeks. */
export const CTOWN_TOTAL_WEEKS = 17;

export type RosterPhase = "preseason" | "early" | "mid" | "late" | "playoffs" | "postseason";

export interface RosterPhaseInfo {
  lastCompletedWeek: number;
  phase: RosterPhase;
  actualsWeight: number;
}

/**
 * C-Town roster grade phase & actuals weight for a given week number.
 *
 *   Preseason         →  0%
 *   Early  (wk 1-3)   → 12% → 25%   (fast initial signal)
 *   Mid    (wk 4-8)   → 30% → 45%   (week 8 = C-Town midpoint)
 *   Late   (wk 9-14)  → 50% → 65%   (regular season home stretch)
 *   Playoffs (wk 15-17) → 70% → 80%  (nearly full actuals for what matters)
 *   Postseason         → 85%
 */
export function getRosterPhaseForWeek(week: number): RosterPhaseInfo {
  if (week <= 0) {
    return { lastCompletedWeek: 0, phase: "preseason", actualsWeight: 0 };
  }

  if (week <= 3) {
    // Early: 12% at week 1, ramp to 25% at week 3
    const weight = 0.12 + (week - 1) * (0.13 / 2);
    return {
      lastCompletedWeek: week,
      phase: "early",
      actualsWeight: Math.round(weight * 1000) / 1000,
    };
  }

  if (week <= 8) {
    // Mid: 30% at week 4, ramp to 45% at week 8
    const weight = 0.30 + (week - 4) * (0.15 / 4);
    return {
      lastCompletedWeek: week,
      phase: "mid",
      actualsWeight: Math.round(weight * 1000) / 1000,
    };
  }

  if (week <= 14) {
    // Late: 50% at week 9, ramp to 65% at week 14
    const weight = 0.50 + (week - 9) * (0.15 / 5);
    return {
      lastCompletedWeek: week,
      phase: "late",
      actualsWeight: Math.round(weight * 1000) / 1000,
    };
  }

  if (week <= 17) {
    // Playoffs: 70% at week 15, ramp to 80% at week 17
    const weight = 0.70 + (week - 15) * (0.10 / 2);
    return {
      lastCompletedWeek: week,
      phase: "playoffs",
      actualsWeight: Math.round(weight * 1000) / 1000,
    };
  }

  // Post-season (after week 17)
  return { lastCompletedWeek: week, phase: "postseason", actualsWeight: 0.85 };
}

/**
 * Detect which week we're in based on today's date and season calendar.
 */
export function getCurrentWeek(season: string = CURRENT_SEASON): number {
  const week1Tuesday = NFL_WEEK1_TUESDAY[season];
  if (!week1Tuesday) return 0;

  const now = Date.now();
  const week1Ms = new Date(week1Tuesday).getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  if (now < week1Ms) return 0;

  const weeksElapsed = Math.floor((now - week1Ms) / msPerWeek);
  return Math.min(weeksElapsed, CTOWN_TOTAL_WEEKS);
}

/**
 * Detect the last week with actuals data, given which week columns are non-null.
 * Returns 0 if no actuals are loaded.
 */
export function getLastActualsWeek(weekFlags: boolean[]): number {
  for (let i = weekFlags.length - 1; i >= 0; i--) {
    if (weekFlags[i]) return i + 1;
  }
  return 0;
}

// ─── Letter grades ───────────────────────────────────────────────────────────

export type LetterGrade = "A+" | "A" | "A−" | "B+" | "B" | "B−" | "C+" | "C" | "C−" | "D+" | "D" | "F";

/**
 * Assign letter grades based on rank among 11 teams.
 * Uses a bell-curve-inspired distribution:
 *   Rank 1   → A+
 *   Rank 2   → A
 *   Rank 3   → A−
 *   Rank 4   → B+
 *   Rank 5   → B
 *   Rank 6   → B−
 *   Rank 7   → C+
 *   Rank 8   → C
 *   Rank 9   → C−
 *   Rank 10  → D+
 *   Rank 11  → D
 */
const GRADE_BY_RANK: LetterGrade[] = [
  "A+", "A", "A−", "B+", "B", "B−", "C+", "C", "C−", "D+", "D",
];

export function gradeFromRank(rank: number): LetterGrade {
  if (rank < 1) return "A+";
  if (rank > GRADE_BY_RANK.length) return "F";
  return GRADE_BY_RANK[rank - 1];
}

/**
 * Color for a letter grade: green for A/B, yellow for C, red for D/F.
 */
export function gradeColor(grade: LetterGrade): string {
  if (grade.startsWith("A")) return "#22c55e"; // green-500
  if (grade.startsWith("B")) return "#3b82f6"; // blue-500
  if (grade.startsWith("C")) return "#eab308"; // yellow-500
  return "#ef4444"; // red-500
}

export { calcPlayerValue, BASE_VALUE, POWER };
