// ─── 4-State ADP Evidence Model ──────────────────────────────
// Provides fallback valuation for players missing ADP/actuals data.
// Spec: "Never assign zero from absence alone."
//
// States:
//   adp_and_actuals  — both sources matched (best confidence)
//   actuals_only     — no ADP signal but actuals exist (mid-season pickup, export gap)
//   adp_only         — has ADP but no actuals (preseason trade, IR player)
//   neither_source   — neither ADP nor actuals (true fallback needed)
//
// ADP statuses:
//   matched_exact | matched_normalized | outside_export_range |
//   no_current_adp_signal | adp_only | unresolved_identity
//
// Fallback: dynamic unranked baseline = ranked_tail_value × unranked_fallback_factor
//   ranked_tail_value = median power-law value of bottom-10 matched players at position in season
//   Cross-position clamp: unranked value < min(all ranked player values in season)

import { calcPlayerValue, normalizeName, type HistoricalAdpRow, type RookieClassEntry } from "./trade-utils";

// ─── Evidence Types ──────────────────────────────────────────

export type AdpStatus =
  | "matched_exact"
  | "matched_normalized"
  | "outside_export_range"
  | "no_current_adp_signal"
  | "adp_only"
  | "unresolved_identity";

export type ActualsStatus =
  | "matched"
  | "no_actuals";

export type CombinedEvidenceStatus =
  | "adp_and_actuals"
  | "actuals_only"
  | "adp_only"
  | "neither_source";

export type FallbackType =
  | "none"                 // has ADP, no fallback needed
  | "unranked_baseline"    // dynamic baseline from tail players
  | "actuals_derived"      // value derived from actuals alone
  | "rookie_baseline"      // rookie in draft dataset, valued by pick
  | "positional_floor";    // last-resort positional minimum

export type ValuationConfidence =
  | "high"     // both sources
  | "medium"   // one source (ADP or actuals)
  | "low"      // fallback
  | "minimal"; // unresolved identity / no data

export interface AdpEvidence {
  // Identity resolution
  adpStatus: AdpStatus;
  actualsStatus: ActualsStatus;
  combinedEvidenceStatus: CombinedEvidenceStatus;

  // Baseline source
  baselineSource: "adp" | "fallback" | "actuals_derived";
  baselineValue: number;
  fallbackUsed: boolean;
  fallbackType: FallbackType;
  fallbackReason: string | null;

  // Dynamic unranked baseline details
  rankedTailValue: number | null;       // median value of bottom-10 matched position players
  unrankedFallbackFactor: number | null; // slider-controlled (0.25-0.75, default 0.50)

  // Actuals integration
  actualsWeight: number;
  actualsValue: number | null;
  actualsAdjustment: number;            // delta from actuals blending

  // Final
  dynastyContextAdjustment: number;     // delta from dynasty multipliers
  finalPlayerValue: number;
  valuationConfidence: ValuationConfidence;
}

// ─── Season ADP Map with Position ────────────────────────────

export interface AdpEntry {
  adpRank: number;
  position: string;
  playerName: string;  // normalized
}

/** Export coverage metadata per ADP season */
export interface SeasonCoverage {
  season: string;
  rowCount: number;
  maxRank: number;
  minRank: number;
}

/** Build season-keyed ADP map that preserves position info for fallback calc */
export function buildSeasonAdpDetailMap(
  historicalAdp: HistoricalAdpRow[],
): Map<string, Map<string, AdpEntry>> {
  const map = new Map<string, Map<string, AdpEntry>>();
  for (const row of historicalAdp) {
    if (!map.has(row.season)) map.set(row.season, new Map());
    const nameNorm = normalizeName(row.player_name);
    map.get(row.season)!.set(nameNorm, {
      adpRank: row.adp_rank,
      position: row.position?.toUpperCase() ?? "UNKNOWN",
      playerName: nameNorm,
    });
  }
  return map;
}

/** Build per-season coverage metadata from ADP data */
export function buildSeasonCoverageMap(
  historicalAdp: HistoricalAdpRow[],
): Map<string, SeasonCoverage> {
  const map = new Map<string, SeasonCoverage>();
  for (const row of historicalAdp) {
    const existing = map.get(row.season);
    if (!existing) {
      map.set(row.season, {
        season: row.season,
        rowCount: 1,
        maxRank: row.adp_rank,
        minRank: row.adp_rank,
      });
    } else {
      existing.rowCount++;
      existing.maxRank = Math.max(existing.maxRank, row.adp_rank);
      existing.minRank = Math.min(existing.minRank, row.adp_rank);
    }
  }
  return map;
}

// ─── Dynamic Unranked Baseline ───────────────────────────────

/**
 * Compute the dynamic unranked baseline for a position in a season.
 *
 * Algorithm:
 * 1. Find all ranked players of the given position in this season's ADP
 * 2. Take the bottom 10 by ADP rank (worst ranked)
 * 3. Compute their power-law values via calcPlayerValue()
 * 4. Take the median of those 10 values → ranked_tail_value
 * 5. Multiply by unrankedFallbackFactor → unranked_baseline_value
 * 6. Cross-position clamp: ensure result < min(all ranked player values in season)
 */
export function computeUnrankedBaseline(
  position: string,
  seasonAdpDetail: Map<string, AdpEntry>,
  allSeasonEntries: Map<string, AdpEntry>,
  unrankedFallbackFactor: number,
): { unrankedBaseline: number; rankedTailValue: number } {
  const posUpper = position.toUpperCase();

  // 1. Get all ranked players at this position, sorted by ADP rank (worst = highest number)
  const posPlayers = Array.from(seasonAdpDetail.values())
    .filter((e) => e.position === posUpper)
    .sort((a, b) => b.adpRank - a.adpRank); // descending rank = worst first

  if (posPlayers.length === 0) {
    // No ranked players at this position in this season — use global fallback
    // Take bottom 10 across ALL positions
    const allPlayers = Array.from(seasonAdpDetail.values())
      .sort((a, b) => b.adpRank - a.adpRank);
    const tail = allPlayers.slice(0, Math.min(10, allPlayers.length));
    if (tail.length === 0) return { unrankedBaseline: 0, rankedTailValue: 0 };
    const tailValues = tail.map((e) => calcPlayerValue(e.adpRank)).sort((a, b) => a - b);
    const rankedTailValue = median(tailValues);
    const raw = rankedTailValue * unrankedFallbackFactor;
    return { unrankedBaseline: raw, rankedTailValue };
  }

  // 2. Take bottom 10 (or fewer if position has < 10)
  const tail = posPlayers.slice(0, Math.min(10, posPlayers.length));
  const tailValues = tail.map((e) => calcPlayerValue(e.adpRank)).sort((a, b) => a - b);

  // 3. Median
  const rankedTailValue = median(tailValues);

  // 4. Apply factor
  let unrankedBaseline = rankedTailValue * unrankedFallbackFactor;

  // 5. Cross-position clamp: unranked must be below min of ALL ranked player values in season
  const allRankedValues = Array.from(allSeasonEntries.values())
    .map((e) => calcPlayerValue(e.adpRank));
  if (allRankedValues.length > 0) {
    const globalMin = Math.min(...allRankedValues);
    if (unrankedBaseline >= globalMin) {
      unrankedBaseline = globalMin * 0.9; // 10% below the worst ranked player
    }
  }

  return { unrankedBaseline, rankedTailValue };
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ─── Evidence Resolver ───────────────────────────────────────

export interface EvidenceInput {
  playerName: string;
  playerPosition: string | null;
  adpRank: number | null;             // from trade-asset inline ADP or season map
  hasActuals: boolean;
  actualsValue: number | null;        // 0-100 normalized
  actualsWeight: number;              // phase weight
  baselineBeforeDynasty: number;      // calcPlayerValue(adpRank) or 0
  baselineAfterDynasty: number;       // after dynasty multipliers
  blendedValue: number;               // after actuals blending
  unrankedFallbackFactor: number;     // from slider
  seasonAdpDetail: Map<string, AdpEntry>;  // this season's full ADP detail map
  rookieClasses?: RookieClassEntry[]; // for rookie baseline detection
  tradeSeason?: string;               // e.g. "2024-25" to match draft year
  seasonMaxRank?: number;             // max ADP rank in this season's export (for outside_export_range)
}

/**
 * Resolve the complete evidence audit for a player asset.
 * Called after value computation to annotate with provenance.
 */
export function resolveEvidence(input: EvidenceInput): AdpEvidence {
  const {
    playerName,
    playerPosition,
    adpRank,
    hasActuals,
    actualsValue,
    actualsWeight,
    baselineBeforeDynasty,
    baselineAfterDynasty,
    blendedValue,
    unrankedFallbackFactor,
    seasonAdpDetail,
    rookieClasses,
    tradeSeason,
    seasonMaxRank,
  } = input;

  // ── Determine ADP status ──
  let adpStatus: AdpStatus;
  if (adpRank !== null && adpRank > 0) {
    // We found an ADP rank — matched via normalization
    adpStatus = "matched_normalized";
  } else if (seasonMaxRank && seasonMaxRank < 500) {
    // Short export (e.g. 2022 only covers rank 1-353)
    // Player may exist but fall outside the captured range
    adpStatus = "outside_export_range";
  } else {
    adpStatus = "no_current_adp_signal";
  }

  // ── Determine actuals status ──
  const actualsStatus: ActualsStatus = hasActuals ? "matched" : "no_actuals";

  // ── Combined evidence status ──
  let combinedEvidenceStatus: CombinedEvidenceStatus;
  if (adpRank && adpRank > 0 && hasActuals) {
    combinedEvidenceStatus = "adp_and_actuals";
  } else if (hasActuals && (!adpRank || adpRank <= 0)) {
    combinedEvidenceStatus = "actuals_only";
  } else if (adpRank && adpRank > 0 && !hasActuals) {
    combinedEvidenceStatus = "adp_only";
  } else {
    combinedEvidenceStatus = "neither_source";
  }

  // ── Baseline source + fallback ──
  let baselineSource: "adp" | "fallback" | "actuals_derived";
  let fallbackUsed = false;
  let fallbackType: FallbackType = "none";
  let fallbackReason: string | null = null;
  let rankedTailValue: number | null = null;
  let effectiveBaselineValue = baselineBeforeDynasty;
  let finalValue = blendedValue;

  if (adpRank && adpRank > 0) {
    // Normal path — ADP found
    baselineSource = "adp";
  } else if (baselineBeforeDynasty <= 0) {
    // NO ADP — need fallback
    fallbackUsed = true;

    if (hasActuals && actualsValue !== null && actualsValue > 0 && actualsWeight > 0) {
      // Has actuals — derive value from actuals alone
      baselineSource = "actuals_derived";
      fallbackType = "actuals_derived";
      fallbackReason = `No ADP signal; value derived from actuals (score: ${actualsValue.toFixed(1)})`;
      // The blended value should already account for this via the blending function
      // but if baseline was 0, the blend is just actualsScaled * weight
      // We need to provide a minimum baseline so preseason trades aren't zero
      if (actualsWeight === 0) {
        // Preseason trade with no ADP — use unranked baseline
        const pos = playerPosition?.toUpperCase() ?? "RB"; // default to RB for safe fallback
        const result = computeUnrankedBaseline(pos, seasonAdpDetail, seasonAdpDetail, unrankedFallbackFactor);
        effectiveBaselineValue = result.unrankedBaseline;
        rankedTailValue = result.rankedTailValue;
        fallbackType = "unranked_baseline";
        fallbackReason = `No ADP signal, preseason trade; using unranked baseline (tail: ${result.rankedTailValue.toFixed(1)} × ${unrankedFallbackFactor})`;
        finalValue = effectiveBaselineValue;
      }
    } else {
      // Neither ADP nor actuals — check for rookie baseline first
      baselineSource = "fallback";
      const nameNorm = normalizeName(playerName);
      const draftYear = tradeSeason ? parseInt(tradeSeason.split("-")[0]) : 0;
      const rookieMatch = rookieClasses?.find(
        (r) => r.nfl_draft_year === draftYear && normalizeName(r.player_name) === nameNorm,
      );

      if (rookieMatch) {
        // Confirmed rookie — use pick-based baseline (keyed to overall pick)
        // Overall pick maps to an effective ADP rank: pick + keeper offset equivalent
        const rookieRank = rookieMatch.overall_pick + 40; // approximate keeper offset
        effectiveBaselineValue = calcPlayerValue(rookieRank);
        fallbackType = "rookie_baseline";
        fallbackReason = `Confirmed ${draftYear} rookie (pick #${rookieMatch.overall_pick}); using rookie baseline`;
        finalValue = effectiveBaselineValue;
      } else {
        // Generic unranked baseline
        const pos = playerPosition?.toUpperCase() ?? "RB";
        const result = computeUnrankedBaseline(pos, seasonAdpDetail, seasonAdpDetail, unrankedFallbackFactor);
        effectiveBaselineValue = result.unrankedBaseline;
        rankedTailValue = result.rankedTailValue;
        fallbackType = "unranked_baseline";
        fallbackReason = `No ADP or actuals data; using positional unranked baseline (tail: ${result.rankedTailValue.toFixed(1)} × ${unrankedFallbackFactor})`;
        finalValue = effectiveBaselineValue;
      }
    }
  } else {
    baselineSource = "adp";
  }

  // ── Confidence ──
  let valuationConfidence: ValuationConfidence;
  switch (combinedEvidenceStatus) {
    case "adp_and_actuals":
      valuationConfidence = "high";
      break;
    case "adp_only":
    case "actuals_only":
      valuationConfidence = "medium";
      break;
    case "neither_source":
      valuationConfidence = fallbackUsed ? "low" : "minimal";
      break;
  }

  const dynastyContextAdjustment = baselineAfterDynasty - baselineBeforeDynasty;
  const actualsAdjustment = blendedValue - baselineAfterDynasty;

  return {
    adpStatus,
    actualsStatus,
    combinedEvidenceStatus,
    baselineSource,
    baselineValue: effectiveBaselineValue,
    fallbackUsed,
    fallbackType,
    fallbackReason,
    rankedTailValue,
    unrankedFallbackFactor: fallbackUsed ? unrankedFallbackFactor : null,
    actualsWeight,
    actualsValue: actualsValue ?? null,
    actualsAdjustment,
    dynastyContextAdjustment,
    finalPlayerValue: finalValue,
    valuationConfidence,
  };
}
