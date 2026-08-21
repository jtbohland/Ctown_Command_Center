// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL VALUATION SPEC — SINGLE SOURCE OF TRUTH
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️  MIRRORED FILE — DO NOT EDIT ONE COPY IN ISOLATION.
//
//     server/lib/valuation/valuation-spec.ts
//     client/lib/valuation/valuation-spec.ts
//
// These two files MUST be byte-for-byte identical. The build separates the
// client and server TypeScript projects (tsconfig.client.json excludes
// server/, tsconfig.server.json only includes server/**), so neither side can
// import the other. Instead we mirror this module and enforce equality with a
// computed parity check:
//
//     npm run check        → runs scripts/check-valuation-parity.ts
//
// The check compares the two files' contents AND their independently computed
// VALUATION_SPEC_FINGERPRINT. Any drift fails the build loudly.
//
// This module is intentionally DEPENDENCY-FREE (no imports at all) so that the
// two copies can be identical bytes.
//
// ─────────────────────────────────────────────────────────────────────────────
// Canonical formula (per skills/app/ppr-leader-data-plan.md):
//
//   player_value = baseline × (1 − actuals_weight)
//                + actuals_value × actuals_weight
//                + dynasty_adjustments
//
//   baseline      = BASE_VALUE × (1 / adp_rank) ^ POWER
//   actuals_value = 60% positional total-points percentile
//                 + 40% positional PPG percentile
//   actuals_weight is derived from the trade/valuation DATE, never a UI toggle.
// ─────────────────────────────────────────────────────────────────────────────

export const VALUATION_SPEC_VERSION = "phase3.2";

// ─── Core power-law constants ────────────────────────────────────────────────

/** Value assigned to a hypothetical ADP rank of 1. */
export const BASE_VALUE = 10000;

/** Power-law exponent. Lower = flatter curve = less top-heavy. */
export const POWER = 0.6;

/** Keepers retained per team before the draft starts. */
export const KEEPERS_PER_TEAM = 4;

/** C-Town league size by draft year: 10 teams 2019-2024, 11 teams 2025+. */
export const LEAGUE_SIZE_BY_YEAR: Record<number, number> = {
  2019: 10,
  2020: 10,
  2021: 10,
  2022: 10,
  2023: 10,
  2024: 10,
  2025: 11,
  2026: 11,
  2027: 11,
  2028: 11,
};

export const DEFAULT_LEAGUE_SIZE = 11;

/** The draft year the live Exchange values against. */
export const CURRENT_DRAFT_YEAR = 2026;

/** The season the live Exchange values against. */
export const CURRENT_SEASON = "2026-27";

export function getLeagueSize(year: number): number {
  return LEAGUE_SIZE_BY_YEAR[year] ?? DEFAULT_LEAGUE_SIZE;
}

export function getKeeperOffset(year: number): number {
  return getLeagueSize(year) * KEEPERS_PER_TEAM;
}

/** Convert a season string like "2024-25" to its draft year (2025). */
export function seasonToDraftYear(season: string): number {
  const parts = season.split("-");
  if (parts.length === 2 && parts[1].length === 2) {
    const prefix = parts[0].substring(0, 2);
    return parseInt(prefix + parts[1], 10);
  }
  return parseInt(parts[0], 10) || CURRENT_DRAFT_YEAR;
}

/**
 * Baseline value from an ADP rank.
 * `power` is overridable so the Exchange's `valueCurve` modifier can flatten or
 * steepen the curve, but the CANONICAL default is POWER.
 */
export function calcPlayerValue(adpRank: number, power: number = POWER): number {
  if (adpRank <= 0) return 0;
  return BASE_VALUE * Math.pow(1 / adpRank, power);
}

// ─── Future pick discount (CANONICAL: step table) ────────────────────────────
//
// Phase 3 / Decision A: the step table is canonical. The live Exchange
// previously used a geometric model — (1 − 0.10) ^ yearsOut — which valued a
// two-years-out pick at 0.81 while every historical verdict engine valued the
// same pick at 0.65. That 25% gap meant the same asset was priced differently
// on the Exchange than in the trade ledger. The Exchange now conforms to the
// historical engine; historical verdicts are unchanged.

export const FUTURE_PICK_DISCOUNT: Record<number, number> = {
  0: 1.0, // same draft year
  1: 0.8, // one year out
  2: 0.65, // two years out
};

export const DEFAULT_FUTURE_DISCOUNT = 0.5; // three or more years out

export function getFuturePickDiscount(
  pickYear: number,
  referenceDraftYear: number = CURRENT_DRAFT_YEAR,
): number {
  const yearsAhead = Math.max(0, pickYear - referenceDraftYear);
  return FUTURE_PICK_DISCOUNT[yearsAhead] ?? DEFAULT_FUTURE_DISCOUNT;
}

/**
 * Map a draft pick to the ADP rank it is expected to convert into.
 * Keepers come off the board first, so every pick is offset by the league's
 * total keeper count.
 */
export function pickToExpectedAdp(
  round: number,
  year: number,
  overallPick?: number,
): number {
  const leagueSize = getLeagueSize(year);
  // Use the true overall slot when known; otherwise the round's midpoint.
  const draftPosition = overallPick
    ? overallPick
    : ((round - 1) * leagueSize + 1 + round * leagueSize) / 2;
  return draftPosition + getKeeperOffset(year);
}

export function calcPickValue(
  round: number,
  year: number,
  overallPick?: number,
  referenceYear: number = CURRENT_DRAFT_YEAR,
  power: number = POWER,
): number {
  const effectiveAdp = pickToExpectedAdp(round, year, overallPick);
  return calcPlayerValue(effectiveAdp, power) * getFuturePickDiscount(year, referenceYear);
}

// ─── Dynasty adjustments ─────────────────────────────────────────────────────

export const ROOKIE_MAX_PICK = 128;
export const ROOKIE_MIN_BOOST = 0.01;
export const ROOKIE_MAX_BOOST = 0.2;

/**
 * Graduated rookie premium. Pick 1 gets the full boost, decaying quadratically
 * to ~1% by pick 128. `maxBoost` is the Exchange's `rookieHype` modifier.
 */
export function getRookiePremium(
  overallPick: number,
  maxBoost: number = ROOKIE_MAX_BOOST,
): number {
  if (overallPick < 1 || overallPick > ROOKIE_MAX_PICK) return 1.0;
  const t = (overallPick - 1) / (ROOKIE_MAX_PICK - 1);
  const boost = ROOKIE_MIN_BOOST + (maxBoost - ROOKIE_MIN_BOOST) * Math.pow(1 - t, 2);
  return 1 + boost;
}

/** Top-5 QB / TE scarcity multiplier. */
export const POSITIONAL_SCARCITY = 1.08;

// ─── Unresolved / non-player asset handling ───────────────────────────

/**
 * Exclusive keeper rights are valued at 100% of the underlying player. The
 * rights holder controls the same asset, so discounting them would understate
 * the side of the trade that received them.
 */
export const RIGHTS_VALUE_MULTIPLIER = 1.0;

/**
 * Position-specific ADP ranks used as a floor when a player's identity is
 * resolved but the season has no ADP entry for them. Core rule from the data
 * plan: never assign zero from absence alone.
 */
export const UNRANKED_BASELINE: Record<string, number> = {
  QB: 175,
  RB: 225,
  WR: 250,
  TE: 200,
  K: 300,
  DEF: 300,
};

export const DEFAULT_UNRANKED_BASELINE = 275;

export function getUnrankedBaseline(position: string | null): number {
  if (!position) return DEFAULT_UNRANKED_BASELINE;
  return UNRANKED_BASELINE[position.toUpperCase()] ?? DEFAULT_UNRANKED_BASELINE;
}

export function getRawAgeFactor(age: number): number {
  if (age <= 24) return 1.06;
  if (age <= 27) return 1.03;
  if (age <= 29) return 1.0;
  if (age <= 31) return 0.95;
  return 0.9;
}

/**
 * Age factor with an intensity dial. `ageCurve` of 1.0 applies the raw factor,
 * 0 disables it, 2.0 doubles its effect.
 */
export function getAgeFactor(age: number, ageCurve: number = 1.0): number {
  if (ageCurve === 0) return 1.0;
  return 1.0 + (getRawAgeFactor(age) - 1.0) * ageCurve;
}

// ─── Verdict thresholds ──────────────────────────────────────────────────────

export const FAIR_TOLERANCE = 5;
export const VERDICT_STEP = 10;

export type VerdictSeverity = "fair" | "slight" | "clear" | "robbery";

export interface Verdict {
  label: string;
  emoji: string;
  severity: VerdictSeverity;
}

export function getVerdict(
  pctDiff: number,
  fairTolerance: number = FAIR_TOLERANCE,
  verdictScale: number = 1.0,
): Verdict {
  const absDiff = Math.abs(pctDiff);
  const t1 = fairTolerance;
  const t2 = fairTolerance + VERDICT_STEP * verdictScale;
  const t3 = fairTolerance + VERDICT_STEP * 2 * verdictScale;
  if (absDiff <= t1) return { label: "Fair Catch", emoji: "🧤", severity: "fair" };
  if (absDiff <= t2) return { label: "Edge Rush", emoji: "📈", severity: "slight" };
  if (absDiff <= t3) return { label: "Pick Six", emoji: "🏆", severity: "clear" };
  return { label: "Flag on the Play", emoji: "🚩", severity: "robbery" };
}

// ─── NFL season calendar ─────────────────────────────────────────────────────
//
// Each entry is the Tuesday that opens the season's "week 1 scoring window".

export const NFL_WEEK1_TUESDAY: Record<string, string> = {
  "2018-19": "2018-09-04",
  "2019-20": "2019-09-03",
  "2020-21": "2020-09-08",
  "2021-22": "2021-09-07",
  "2022-23": "2022-09-06",
  "2023-24": "2023-09-05",
  "2024-25": "2024-09-03",
  "2025-26": "2025-09-02",
  "2026-27": "2026-09-08",
};

export const REGULAR_SEASON_WEEKS: Record<string, number> = {
  "2018-19": 17,
  "2019-20": 17,
  "2020-21": 17,
  "2021-22": 18,
  "2022-23": 18,
  "2023-24": 18,
  "2024-25": 18,
  "2025-26": 18,
  "2026-27": 18,
};

export type SeasonPhase = "preseason" | "early" | "mid" | "late" | "postseason";

export interface PhaseInfo {
  lastCompletedWeek: number;
  seasonPhase: SeasonPhase;
  actualsWeight: number;
  totalWeeks: number;
}

/**
 * Determine the season phase and actuals weight for a valuation date.
 *
 * The weight compounds with evidence — the more weeks played, the more we
 * trust on-field production over preseason ADP:
 *
 *   Preseason        →  0%
 *   Early  (wk 1-4)  → 10% → 20%
 *   Mid    (wk 5-10) → 25% → 35%
 *   Late   (wk 11+)  → 40% → 50%
 *   Postseason       → 85%
 *
 * There is deliberately NO user-facing ADP/Actuals toggle: the trade date
 * alone determines the blend.
 */
export function getSeasonPhaseInfo(valuationDate: string, season: string): PhaseInfo {
  const week1Tuesday = NFL_WEEK1_TUESDAY[season];
  const totalWeeks = REGULAR_SEASON_WEEKS[season] ?? 18;

  if (!week1Tuesday) {
    return { lastCompletedWeek: 0, seasonPhase: "preseason", actualsWeight: 0, totalWeeks };
  }

  const valDateMs = new Date(valuationDate).getTime();
  const week1Ms = new Date(week1Tuesday).getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  if (valDateMs < week1Ms) {
    return { lastCompletedWeek: 0, seasonPhase: "preseason", actualsWeight: 0, totalWeeks };
  }

  const weeksElapsed = Math.floor((valDateMs - week1Ms) / msPerWeek);
  const lastCompletedWeek = Math.min(weeksElapsed, totalWeeks);

  let seasonPhase: SeasonPhase;
  let actualsWeight: number;

  if (lastCompletedWeek === 0) {
    seasonPhase = "preseason";
    actualsWeight = 0;
  } else if (lastCompletedWeek <= 4) {
    seasonPhase = "early";
    actualsWeight = 0.1 + (lastCompletedWeek - 1) * (0.1 / 3);
  } else if (lastCompletedWeek <= 10) {
    seasonPhase = "mid";
    actualsWeight = 0.25 + (lastCompletedWeek - 5) * (0.1 / 5);
  } else if (lastCompletedWeek <= totalWeeks) {
    seasonPhase = "late";
    const lateWeeks = totalWeeks - 11 + 1;
    actualsWeight = 0.4 + (lastCompletedWeek - 11) * (0.1 / (lateWeeks - 1));
    actualsWeight = Math.min(actualsWeight, 0.5);
  } else {
    seasonPhase = "postseason";
    actualsWeight = 0.85;
  }

  // All regular season weeks complete → postseason.
  if (lastCompletedWeek >= totalWeeks) {
    seasonPhase = "postseason";
    actualsWeight = 0.85;
  }

  actualsWeight = Math.round(actualsWeight * 1000) / 1000;

  return { lastCompletedWeek, seasonPhase, actualsWeight, totalWeeks };
}

// ─── Actuals value ───────────────────────────────────────────────────────────

export const ACTUALS_PTS_WEIGHT = 0.6;
export const ACTUALS_PPG_WEIGHT = 0.4;

/**
 * Blend positional percentiles into a single 0-100 actuals score.
 * Volume (total points) is weighted over rate (PPG) because a healthy
 * every-week starter is worth more than an efficient part-timer.
 */
export function computeActualsValue(
  totalPtsPercentile: number,
  ppgPercentile: number,
): number {
  return (
    Math.round(
      (ACTUALS_PTS_WEIGHT * totalPtsPercentile + ACTUALS_PPG_WEIGHT * ppgPercentile) * 10,
    ) / 10
  );
}

/**
 * Convert a 0-100 actuals percentile into an ADP-equivalent rank so it can be
 * scored on the same power-law curve as the baseline. Without this the two
 * sides of the blend would be on incompatible scales.
 */
export function actualsPercentileToAdpEquivalent(
  percentile: number,
  populationSize: number,
): number {
  return Math.max(1, Math.round(populationSize * (1 - percentile / 100) + 1));
}

/** The canonical blend: baseline × (1 − weight) + actuals × weight. */
export function blendValues(
  baselineValue: number,
  actualsValue: number,
  actualsWeight: number,
): number {
  return baselineValue * (1 - actualsWeight) + actualsValue * actualsWeight;
}

// ─── Parity fingerprint ──────────────────────────────────────────────────────

/**
 * A deterministic digest of every numeric constant and of sampled outputs from
 * every curve in this spec. Both mirrored copies compute this independently; if
 * the two disagree, the copies have drifted and the parity check fails.
 *
 * Sampling the curves (not just the constants) means a change to formula SHAPE
 * is caught even when the named constants are untouched.
 */
function computeSpecFingerprint(): string {
  const samples: number[] = [
    BASE_VALUE,
    POWER,
    KEEPERS_PER_TEAM,
    DEFAULT_LEAGUE_SIZE,
    CURRENT_DRAFT_YEAR,
    ROOKIE_MAX_PICK,
    ROOKIE_MIN_BOOST,
    ROOKIE_MAX_BOOST,
    POSITIONAL_SCARCITY,
    FAIR_TOLERANCE,
    VERDICT_STEP,
    ACTUALS_PTS_WEIGHT,
    ACTUALS_PPG_WEIGHT,
    DEFAULT_FUTURE_DISCOUNT,
    RIGHTS_VALUE_MULTIPLIER,
    DEFAULT_UNRANKED_BASELINE,
  ];

  for (const pos of Object.keys(UNRANKED_BASELINE).sort()) {
    samples.push(getUnrankedBaseline(pos));
  }
  samples.push(getUnrankedBaseline(null), getUnrankedBaseline("UNKNOWN"));
  for (const year of [2019, 2024, 2025, 2026, 2027, 2028]) {
    samples.push(getLeagueSize(year), getKeeperOffset(year));
  }
  for (const yearsOut of [0, 1, 2, 3, 5]) {
    samples.push(getFuturePickDiscount(CURRENT_DRAFT_YEAR + yearsOut));
  }
  for (const adp of [1, 5, 12, 44, 100, 250]) {
    samples.push(Math.round(calcPlayerValue(adp) * 1000) / 1000);
  }
  for (const round of [1, 2, 4]) {
    for (const year of [2026, 2027, 2028]) {
      samples.push(Math.round(calcPickValue(round, year) * 1000) / 1000);
    }
  }
  for (const pick of [1, 16, 64, 128, 200]) {
    samples.push(Math.round(getRookiePremium(pick) * 100000) / 100000);
  }
  for (const age of [22, 25, 28, 30, 34]) {
    samples.push(getAgeFactor(age));
  }
  for (const pct of [0, 25, 60, 99]) {
    samples.push(getVerdict(pct).severity.length, Math.abs(pct));
  }
  for (const season of Object.keys(NFL_WEEK1_TUESDAY).sort()) {
    samples.push(REGULAR_SEASON_WEEKS[season] ?? 18);
    const week1 = new Date(NFL_WEEK1_TUESDAY[season]).getTime();
    samples.push(Math.round(week1 / 86400000));
  }
  for (const week of [0, 1, 4, 5, 10, 11, 18, 20]) {
    const probe = new Date(
      new Date(NFL_WEEK1_TUESDAY[CURRENT_SEASON]).getTime() + week * 7 * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    samples.push(getSeasonPhaseInfo(probe, CURRENT_SEASON).actualsWeight);
  }
  samples.push(computeActualsValue(80, 60), actualsPercentileToAdpEquivalent(80, 300));

  // FNV-1a over the serialized samples — stable across engines, no deps.
  const payload = `${VALUATION_SPEC_VERSION}|${samples.join(",")}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${VALUATION_SPEC_VERSION}-${hash.toString(16).padStart(8, "0")}`;
}

export const VALUATION_SPEC_FINGERPRINT = computeSpecFingerprint();
