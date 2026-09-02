// ─── Player Value Engine ────────────────────────────────────
// Computes a 0-100 normalized value from ADP + Dynasty ranks.
// Formula: 60% ADP + 40% Dynasty (1–500 scale, no dead zone).
// If dynasty rank is missing, falls back to 100% ADP.
// Pre-season: pure ADP+Dynasty blend (no actuals yet).
// In-season: will blend with actuals per PPR Leader Data Plan weights.
//
// This is the single source of truth for player valuation across
// All Rosters, Redux Rosters, Deal Desk, and Sound the Alarm.

export const MAX_RANK = 500; // ADP/Dynasty range: 1–500

/** Convert a rank (1–500) to a 0–100 value. Lower rank = higher value. */
export function rankToValue(rank: number): number {
  const clamped = Math.min(rank, MAX_RANK);
  return Math.round(((MAX_RANK - clamped + 1) / MAX_RANK) * 100 * 10) / 10;
}

/**
 * Compute a blended 0–100 player value.
 * 60% ADP + 40% Dynasty. Falls back to 100% ADP when dynasty is missing.
 * Rank 1 → ~100, Rank 500 → ~0.2, null/0 → 0.
 */
export function computePlayerValue(
  adpRank: number | null,
  dynastyRank?: number | null,
): number {
  if (adpRank == null || adpRank <= 0) return 0;
  const adpVal = rankToValue(adpRank);
  if (dynastyRank == null || dynastyRank <= 0) return adpVal;
  const dynVal = rankToValue(dynastyRank);
  return Math.round((0.60 * adpVal + 0.40 * dynVal) * 10) / 10;
}

/**
 * Build positional label from position + positional_rank.
 * e.g. "QB1", "RB12", "WR3"
 */
export function getPositionalLabel(
  position: string | null | undefined,
  positionalRank: number | null | undefined,
): string {
  if (!position) return "";
  if (positionalRank == null) return position;
  return `${position}${positionalRank}`;
}

/**
 * Format a player's value display for dropdowns and cards.
 * e.g. "QB1 · 93.2" or "93.2" if no positional data.
 */
export function formatPlayerValueLabel(
  adpRank: number | null,
  position?: string | null,
  positionalRank?: number | null,
  dynastyRank?: number | null,
): string {
  const value = computePlayerValue(adpRank, dynastyRank);
  const posLabel = getPositionalLabel(position, positionalRank);
  if (value === 0 && !posLabel) return "—";
  if (value === 0) return posLabel;
  if (!posLabel) return `${value}`;
  return `${posLabel} · ${value}`;
}

/**
 * Format a player dropdown label with name + value context.
 * e.g. "Josh Allen (QB1 · 93.2)"
 */
export function formatDropdownLabel(
  name: string,
  position: string,
  adpRank: number | null,
  positionalRank?: number | null,
  dynastyRank?: number | null,
): string {
  const valueLabel = formatPlayerValueLabel(adpRank, position, positionalRank, dynastyRank);
  return `${name} (${valueLabel})`;
}
