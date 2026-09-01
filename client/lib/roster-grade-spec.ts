// ─────────────────────────────────────────────────────────────────────────────
// C-TOWN ROSTER GRADE RAMP (CLIENT-SIDE)
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight client copy for grade display, color coding, and chart labels.
// The full computation lives server-side in GetRosterGrades.
// ─────────────────────────────────────────────────────────────────────────────

export type LetterGrade = "A+" | "A" | "A−" | "B+" | "B" | "B−" | "C+" | "C" | "C−" | "D+" | "D" | "F";

const GRADE_BY_RANK: LetterGrade[] = [
  "A+", "A", "A−", "B+", "B", "B−", "C+", "C", "C−", "D+", "D",
];

export function gradeFromRank(rank: number): LetterGrade {
  if (rank < 1) return "A+";
  if (rank > GRADE_BY_RANK.length) return "F";
  return GRADE_BY_RANK[rank - 1];
}

/** Grade badge background color. */
export function gradeColor(grade: LetterGrade): string {
  if (grade.startsWith("A")) return "#22c55e";
  if (grade.startsWith("B")) return "#3b82f6";
  if (grade.startsWith("C")) return "#eab308";
  return "#ef4444";
}

/** Tailwind class for grade badge bg. */
export function gradeBgClass(grade: LetterGrade): string {
  if (grade.startsWith("A")) return "bg-green-500/20 text-green-400 border-green-500/30";
  if (grade.startsWith("B")) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (grade.startsWith("C")) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
  return "bg-red-500/20 text-red-400 border-red-500/30";
}
