// ─── Player Value Engine ────────────────────────────────────
// Computes a 0-100 normalized value from ADP rank.
// Pre-season: 100% ADP-weighted (no actuals yet).
// In-season: will blend with actuals per PPR Leader Data Plan weights.
//
// This is the single source of truth for player valuation across
// Redux Rosters, Deal Desk, and Sound the Alarm.

const MAX_ADP = 500; // ADP range: 1–500

/**
 * Compute a 0–100 normalized value from ADP rank.
 * Rank 1 → ~100, Rank 500 → ~0.2
 * Players without ADP get 0.
 */
export function computePlayerValue(adpRank: number | null): number {
  if (adpRank == null || adpRank <= 0) return 0;
  const clamped = Math.min(adpRank, MAX_ADP);
  return Math.round(((MAX_ADP - clamped + 1) / MAX_ADP) * 100 * 10) / 10;
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
): string {
  const value = computePlayerValue(adpRank);
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
): string {
  const valueLabel = formatPlayerValueLabel(adpRank, position, positionalRank);
  return `${name} (${valueLabel})`;
}
