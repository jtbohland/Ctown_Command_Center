// ─── Trade Valuation Engine (Client-Side) ────────────────────
// Computes trade verdicts using ADP baseline + blended actuals from server.
// Formula: player_value = baseline × (1 - weight) + actualsValue × weight + dynasty_adjustments
// No toggle — every trade auto-blends based on trade date.
//
// 4-State Evidence Model: never assign zero from absence alone.
// Players missing ADP get a dynamic unranked baseline derived from
// the bottom-10 ranked players at their position in that season.

import {
  type AdpEvidence,
  type AdpEntry,
  buildSeasonAdpDetailMap,
  computeUnrankedBaseline,
  resolveEvidence,
  type SeasonCoverage,
} from "./evidence-model";

/** Get max ADP rank from a season's detail map (for export coverage detection) */
function getSeasonMaxRank(detail?: Map<string, AdpEntry>): number | undefined {
  if (!detail || detail.size === 0) return undefined;
  let max = 0;
  for (const entry of detail.values()) {
    if (entry.adpRank > max) max = entry.adpRank;
  }
  return max;
}

export type { AdpEvidence, AdpEntry, SeasonCoverage } from "./evidence-model";
export { buildSeasonAdpDetailMap, buildSeasonCoverageMap } from "./evidence-model";

// ─── Canonical valuation spec ────────────────────────────────
// Every constant and curve below comes from the single source of truth at
// client/lib/valuation/valuation-spec.ts (mirrored byte-for-byte from
// server/lib/valuation/valuation-spec.ts). Nothing in this file may redefine
// a value the spec already owns — that duplication is exactly what let the
// Exchange and the trade ledger drift apart before Phase 3.
import {
  calcPickValue,
  calcPlayerValue,
  CURRENT_DRAFT_YEAR,
  getAgeFactor,
  getKeeperOffset,
  getLeagueSize,
  getRookiePremium,
  getVerdict,
  NFL_WEEK1_TUESDAY,
  POSITIONAL_SCARCITY,
  ROOKIE_MAX_PICK,
  seasonToDraftYear,
  VALUATION_SPEC_FINGERPRINT,
  VALUATION_SPEC_VERSION,
  type Verdict,
  type VerdictSeverity,
} from "./valuation/valuation-spec";

// Re-exported so existing consumers keep importing these from trade-utils.
export {
  calcPickValue,
  calcPlayerValue,
  CURRENT_DRAFT_YEAR,
  getLeagueSize,
  getVerdict,
  seasonToDraftYear,
  VALUATION_SPEC_FINGERPRINT,
  VALUATION_SPEC_VERSION,
};
export type { Verdict, VerdictSeverity };

// normalizeName + extractKeeperRightsPlayer imported from shared module
import { normalizeName, extractKeeperRightsPlayer, getCanonicalDisplayName } from "./normalize-trade-name";
export { normalizeName, extractKeeperRightsPlayer, getCanonicalDisplayName };

// Future-pick discount, the power-law curve, the rookie premium, positional
// scarcity, the age curve and the verdict thresholds all live in the spec.
// They are imported above rather than restated here.

export const SEVERITY_COLORS: Record<VerdictSeverity, { bg: string; border: string; text: string; badge: string }> = {
  fair: { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  slight: { bg: "bg-amber-500/10", border: "border-amber-500/30", text: "text-amber-400", badge: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  clear: { bg: "bg-orange-500/10", border: "border-orange-500/30", text: "text-orange-400", badge: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  robbery: { bg: "bg-red-500/10", border: "border-red-500/30", text: "text-red-400", badge: "bg-red-500/20 text-red-400 border-red-500/30" },
};

// ─── C-Town Season Calendar ─────────────────────────────────
// Derives the display season label from trade_date using the same NFL calendar
// the valuation engine uses. A C-Town season (e.g. "2026-27") spans from the
// Super Bowl of the prior NFL season through the following Super Bowl:
//   - Post-Super-Bowl offseason → C-Town draft → preseason → NFL regular season
// Trades after the prior season's Super Bowl belong to the NEXT C-Town season.
//
// NFL Week 1 Tuesday dates come from the canonical spec (NFL_WEEK1_TUESDAY);
// this file no longer keeps its own copy of the calendar.

// Super Bowl Sunday is approximately 22–23 weeks after Week 1 (early February).
// We use Feb 15 of the following year as a conservative cutoff — trades on or
// after this date belong to the NEXT C-Town season's offseason.
const SUPER_BOWL_CUTOFFS: Record<string, string> = {
  "2018-19": "2019-02-15",
  "2019-20": "2020-02-15",
  "2020-21": "2021-02-15",
  "2021-22": "2022-02-15",
  "2022-23": "2023-02-15",
  "2023-24": "2024-02-15",
  "2024-25": "2025-02-15",
  "2025-26": "2026-02-15",
};

// Ordered list of all C-Town seasons (chronological)
const ALL_CTOWN_SEASONS = [
  "2018-19", "2019-20", "2020-21", "2021-22",
  "2022-23", "2023-24", "2024-25", "2025-26", "2026-27",
];

/**
 * Derive the C-Town display season from a trade's stored season and date.
 *
 * Historical trades use the commissioner-assigned `season` field as-is.
 * The only adjustment: if a trade's date falls after the Super Bowl cutoff
 * of its stored season, it belongs to the NEXT C-Town season's offseason.
 * This handles 2026 trades stored as "2025-26" that should display as "2026-27".
 *
 * Returns the stored `season` field as fallback when trade_date is null.
 */
export function getCTownDisplaySeason(tradeDate: string | null, storedSeason: string): string {
  if (!tradeDate) return storedSeason;

  const d = new Date(tradeDate);
  const tradeDateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD

  // Check if the trade date falls after the Super Bowl cutoff of its stored season.
  // If so, it belongs to the next season's offseason.
  const cutoff = SUPER_BOWL_CUTOFFS[storedSeason];
  if (cutoff && tradeDateStr >= cutoff) {
    const idx = ALL_CTOWN_SEASONS.indexOf(storedSeason);
    if (idx >= 0 && idx < ALL_CTOWN_SEASONS.length - 1) {
      return ALL_CTOWN_SEASONS[idx + 1];
    }
  }

  return storedSeason;
}

/**
 * Get the full list of C-Town seasons for dropdown display (newest first).
 */
export function getAllCTownSeasons(): string[] {
  return [...ALL_CTOWN_SEASONS].reverse();
}

/**
 * Derive the C-Town trade phase detail from trade_date and display season.
 * This is for informational display only — does not affect valuations.
 */
export function getCTownPhaseDetail(tradeDate: string | null, displaySeason: string): string {
  if (!tradeDate) return "unknown";

  const d = new Date(tradeDate);
  const tradeDateStr = d.toISOString().slice(0, 10);
  const week1 = NFL_WEEK1_TUESDAY[displaySeason];

  if (!week1) return "offseason";

  if (tradeDateStr >= week1) return "regular_season";

  // Before NFL regular season — determine offseason sub-phase
  // C-Town draft typically happens in late August
  const year = parseInt(displaySeason.split("-")[0], 10);
  const draftWeekendStart = `${year}-08-20`;
  const draftWeekendEnd = `${year}-08-28`;
  const prevSeason = ALL_CTOWN_SEASONS[ALL_CTOWN_SEASONS.indexOf(displaySeason) - 1];
  const postSBCutoff = prevSeason ? SUPER_BOWL_CUTOFFS[prevSeason] : `${year}-02-15`;

  if (tradeDateStr >= draftWeekendEnd) return "post_draft_preseason";
  if (tradeDateStr >= draftWeekendStart) return "draft_weekend";
  if (tradeDateStr >= postSBCutoff) return "postseason_offseason";

  return "offseason";
}

// ─── Shared Types ────────────────────────────────────────────
export interface TradeRow {
  id: number;
  trade_number: number;
  season: string;
  trade_date: string | null;
  team_a_id: number;
  team_b_id: number;
  team_a_name: string;
  team_b_name: string;
  status: string;
  period: string;
  notes: string | null;
  team_c_id: number | null;
  team_c_name: string | null;
  trade_type: string | null;
  participant_count: number | null;
  three_team_complete: boolean | null;
  // Canonical verdict fields from DB (BackfillTradeVerdicts)
  verdict_label: string | null;
  verdict_emoji: string | null;
  verdict_severity: string | null;
  winner_team_id: number | null;
  pct_difference: number | null;
  team_a_total: number | null;
  team_b_total: number | null;
  team_c_total: number | null;
  valuation_complete: boolean | null;
  confidence: string | null;
  confidence_reasons: string[] | null;
}

export interface TradeAssetRow {
  id: number;
  trade_id: number;
  from_team_id: number;
  asset_type: string;
  player_name: string | null;
  player_position: string | null;
  player_adp_at_trade: string | null;
  pick_year: number | null;
  pick_round: number | null;
  pick_number: number | null;
  recipient_team_id: number | null;
  destination_explicit: boolean | null;
}

export interface TeamRow {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
}

export interface PlayerRow {
  id: number;
  name: string;
  position: string;
  nfl_team: string;
  adp_rank: number | null;
  positional_rank: number | null;
  roster_team_id: number | null;
  is_keeper: boolean;
}

export interface DraftCapitalRow {
  id: number;
  year: number;
  round: number;
  original_team_id: number;
  current_team_id: number;
  original_team_name: string;
  current_team_name: string;
}

export interface HistoricalAdpRow {
  player_name: string;
  adp_rank: number;
  season: string;
  position: string;
}

export interface RookieClassEntry {
  nfl_draft_year: number;
  overall_pick: number;
  player_name: string;
  position: string;
  age_on_draft_day: number;
}

export interface DynastyContext {
  rookieClasses: RookieClassEntry[];
  allAdp: HistoricalAdpRow[];
}

// ─── Server Actuals Types (from ComputeTradeActuals API) ─────
export interface PlayerActualsResult {
  playerName: string;
  normalizedName: string;
  position: string;
  season: string;
  seasonPhase: string;
  lastCompletedWeek: number;
  cutoffDate: string;
  totalWeeks: number;
  cumulativePprPoints: number;
  gamesPlayed: number;
  ppg: number;
  totalPtsPercentile: number;
  ppgPercentile: number;
  posRankByPts: number;
  posRankByPpg: number;
  positionTotal: number;
  actualsValue: number;     // 0-100 normalized
  actualsWeight: number;    // 0.0-0.85 phase-based
  fullSeasonTotalPoints: number;
  fullSeasonGamesPlayed: number;
  fullSeasonPpg: number;
  fullSeasonOverallRank: number;
  fullSeasonPositionalRank: number;
}

export interface TradeActualsResult {
  tradeId: number;
  tradeSeason: string;
  tradeDate: string | null;
  seasonPhase: string;
  lastCompletedWeek: number;
  cutoffDate: string;
  actualsWeight: number;
  totalWeeks: number;
  playerActuals: PlayerActualsResult[];
}

// ─── Blended Audit Trail (per-player calculation breakdown) ──
export interface BlendedAuditEntry {
  playerName: string;
  position: string;
  // ADP baseline
  adpRank: number | null;
  baselineValue: number;       // calcPlayerValue(adpRank) with dynasty multipliers
  // Actuals from server
  actualsValue: number;        // 0-100 normalized score from server
  actualsWeight: number;       // phase-based weight (0.0-0.85)
  seasonPhase: string;
  lastCompletedWeek: number;
  cutoffDate: string;
  // Through-cutoff stats
  cumulativePprPoints: number;
  gamesPlayed: number;
  ppg: number;
  totalPtsPercentile: number;
  ppgPercentile: number;
  // Blended result
  blendedValue: number;        // baseline × (1-weight) + actualsValue × weight
  blendDelta: number;          // blendedValue - baselineValue
  // Evidence model (4-state audit)
  evidence?: AdpEvidence;
}

export interface TradeValuation {
  teamAValue: number;
  teamBValue: number;
  pctDifference: number;
  verdict: Verdict;
  winningTeamId: number | null;
  winningTeamName: string | null;
  // Absolute & relative gap metrics
  absoluteValueGap: number;       // |teamAValue - teamBValue| — raw point difference
  tradeSize: number;              // teamAValue + teamBValue — total value moved
  loserLossPercentage: number;    // absoluteValueGap / loserPackageValue × 100 (how much the losing side overpaid)
  // Blended actuals metadata
  seasonPhase?: string;
  actualsWeight?: number;
  lastCompletedWeek?: number;
  blendedAudit?: BlendedAuditEntry[];
}

// ─── Three-Team Trade Types ──────────────────────────────────

export interface TeamValuationResult {
  teamId: number;
  teamName: string;
  sentValue: number;
  receivedValue: number;
  netValue: number;
  rank: number;
}

export interface ThreeTeamValuation {
  teams: [TeamValuationResult, TeamValuationResult, TeamValuationResult];
  winner: TeamValuationResult;
  winnerMarginOverSecond: number;
  conservationCheck: number;
  verdict: Verdict;
  valuation_complete: boolean;
  // Blended actuals metadata
  seasonPhase?: string;
  actualsWeight?: number;
}

/** Type guard: is this trade a three-team trade? */
export function isThreeTeamTrade(trade: TradeRow): boolean {
  return trade.trade_type === "three_team" && trade.participant_count === 3;
}

/**
 * Build a TradeValuation from DB-stored verdict fields.
 * Used by Ledger + History to display canonical verdicts without re-computing.
 */
export function buildValuationFromDb(trade: TradeRow, teams: TeamRow[]): TradeValuation | null {
  if (!trade.valuation_complete || trade.verdict_label == null) return null;
  const teamAValue = trade.team_a_total ?? 0;
  const teamBValue = trade.team_b_total ?? 0;
  const pctDifference = trade.pct_difference ?? 0;
  const absoluteValueGap = Math.abs(teamBValue - teamAValue);
  const tradeSize = teamAValue + teamBValue;
  const winnerTeamId = trade.winner_team_id ?? null;
  const winnerTeam = winnerTeamId != null ? teams.find(t => t.id === winnerTeamId) : null;
  const loserValue = winnerTeamId === trade.team_a_id ? teamBValue
    : winnerTeamId === trade.team_b_id ? teamAValue
    : 0;
  const loserLossPercentage = loserValue > 0 ? Math.round((absoluteValueGap / loserValue) * 100) : 0;

  return {
    teamAValue,
    teamBValue,
    pctDifference: Math.round(Math.abs(pctDifference) * 10) / 10,
    verdict: {
      label: trade.verdict_label,
      emoji: trade.verdict_emoji ?? "",
      severity: (trade.verdict_severity ?? "fair") as VerdictSeverity,
    },
    winningTeamId: winnerTeamId,
    winningTeamName: winnerTeam?.team_name ?? null,
    absoluteValueGap,
    tradeSize,
    loserLossPercentage,
  };
}

// ─── Dynasty Multiplier Helper ───────────────────────────────
function applyDynastyMultiplier(
  baseValue: number,
  playerName: string,
  playerPosition: string | null,
  playerAdp: number | null,
  tradeSeason: string,
  ctx: DynastyContext,
): number {
  let multiplier = 1.0;
  const nameNorm = normalizeName(playerName);
  const draftYear = parseInt(tradeSeason.split("-")[0]);

  // 1. Graduated rookie premium
  const rookieMatch = ctx.rookieClasses.find(
    (r) =>
      r.nfl_draft_year === draftYear &&
      r.overall_pick <= ROOKIE_MAX_PICK &&
      normalizeName(r.player_name) === nameNorm,
  );
  if (rookieMatch) multiplier *= getRookiePremium(rookieMatch.overall_pick);

  // 2. Positional scarcity: top-5 QB or TE by ADP
  const pos = playerPosition?.toUpperCase() ?? "";
  if ((pos === "QB" || pos === "TE") && playerAdp !== null) {
    const seasonAdp = ctx.allAdp
      .filter((a) => a.season === tradeSeason && a.position.toUpperCase() === pos)
      .sort((a, b) => a.adp_rank - b.adp_rank);
    const posRank = seasonAdp.findIndex((a) => normalizeName(a.player_name) === nameNorm);
    if (posRank >= 0 && posRank < 5) multiplier *= POSITIONAL_SCARCITY;
  }

  // 3. Age curve
  const rookieEntry = ctx.rookieClasses.find(
    (r) => normalizeName(r.player_name) === nameNorm,
  );
  if (rookieEntry) {
    const currentAge = rookieEntry.age_on_draft_day + (draftYear - rookieEntry.nfl_draft_year);
    const ageFactor = getAgeFactor(currentAge);
    multiplier *= ageFactor;
  }

  return baseValue * multiplier;
}

/** Build a season-keyed ADP map: season → (lowercased player name → adp_rank) */
export function buildSeasonAdpMap(
  historicalAdp: HistoricalAdpRow[],
): Map<string, Map<string, number>> {
  const map = new Map<string, Map<string, number>>();
  for (const row of historicalAdp) {
    if (!map.has(row.season)) map.set(row.season, new Map());
    map.get(row.season)!.set(normalizeName(row.player_name), row.adp_rank);
  }
  return map;
}

/** Look up a player's ADP for a specific season */
export function getSeasonAdp(
  seasonAdpMap: Map<string, Map<string, number>>,
  season: string,
  playerName: string,
): number | null {
  return seasonAdpMap.get(season)?.get(normalizeName(playerName)) ?? null;
}

// ─── Actuals Map Builder ─────────────────────────────────────
/** Build a lookup: tradeId → (normalizedPlayerName → PlayerActualsResult) */
export function buildTradeActualsMap(
  results: TradeActualsResult[],
): Map<number, { meta: TradeActualsResult; players: Map<string, PlayerActualsResult> }> {
  const map = new Map<number, { meta: TradeActualsResult; players: Map<string, PlayerActualsResult> }>();
  for (const r of results) {
    const players = new Map<string, PlayerActualsResult>();
    for (const p of r.playerActuals) {
      players.set(p.normalizedName, p);
    }
    map.set(r.tradeId, { meta: r, players });
  }
  return map;
}

// ─── Blended Asset Value ─────────────────────────────────────
/**
 * Compute the blended value for a single player asset.
 *
 * Formula: baseline × (1 - weight) + actualsScaled × weight
 *
 * actualsValue from server is 0-100 normalized. We scale it to the same
 * magnitude as the power-law baseline by using a reference mapping:
 *   actualsScaled = calcPlayerValue(interpolatedRank)
 *
 * where interpolatedRank maps the 0-100 percentile to an ADP rank.
 * 100th percentile → rank 1 (best), 0th percentile → rank totalInPosition.
 *
 * This ensures both sides of the blend are on the same power-law scale.
 */
function computeBlendedPlayerValue(
  baselineValue: number,
  actuals: PlayerActualsResult | undefined,
  playerName: string,
  playerPosition: string | null,
  playerAdp: number | null,
  tradeSeason: string,
  dynastyCtx: DynastyContext | undefined,
  audit: BlendedAuditEntry[] | undefined,
  seasonAdpDetail?: Map<string, AdpEntry>,
  unrankedFallbackFactor?: number,
): number {
  // ── Fallback baseline for unranked players ──
  // If ADP is missing, compute a dynamic unranked baseline instead of leaving at 0.
  // Rule: "Never assign zero from absence alone."
  let effectiveBaseline = baselineValue;
  let fallbackApplied = false;
  if (effectiveBaseline <= 0 && seasonAdpDetail && unrankedFallbackFactor !== undefined) {
    // Check for rookie baseline first
    const nameNorm = normalizeName(playerName);
    const draftYear = parseInt(tradeSeason.split("-")[0]);
    const rookieMatch = dynastyCtx?.rookieClasses.find(
      (r) => r.nfl_draft_year === draftYear && normalizeName(r.player_name) === nameNorm,
    );
    if (rookieMatch) {
      // Confirmed rookie — use pick-based baseline
      const rookieRank = rookieMatch.overall_pick + getKeeperOffset(draftYear);
      effectiveBaseline = calcPlayerValue(rookieRank);
      fallbackApplied = true;
    } else {
      // Generic unranked baseline
      const pos = playerPosition?.toUpperCase() ?? actuals?.position ?? "RB";
      const result = computeUnrankedBaseline(pos, seasonAdpDetail, seasonAdpDetail, unrankedFallbackFactor);
      if (result.unrankedBaseline > 0) {
        effectiveBaseline = result.unrankedBaseline;
        fallbackApplied = true;
      }
    }
  }

  if (!actuals || actuals.actualsWeight === 0) {
    // Preseason or no actuals — use baseline only
    if (audit) {
      const evidence = seasonAdpDetail && unrankedFallbackFactor !== undefined
        ? resolveEvidence({
            playerName,
            playerPosition,
            adpRank: playerAdp,
            hasActuals: !!actuals,
            actualsValue: actuals?.actualsValue ?? null,
            actualsWeight: 0,
            baselineBeforeDynasty: effectiveBaseline,
            baselineAfterDynasty: effectiveBaseline,
            blendedValue: effectiveBaseline,
            unrankedFallbackFactor,
            seasonAdpDetail,
            rookieClasses: dynastyCtx?.rookieClasses,
            tradeSeason,
            seasonMaxRank: getSeasonMaxRank(seasonAdpDetail),
          })
        : undefined;

      audit.push({
        playerName,
        position: actuals?.position ?? playerPosition ?? "UNKNOWN",
        adpRank: playerAdp,
        baselineValue: effectiveBaseline,
        actualsValue: actuals?.actualsValue ?? 0,
        actualsWeight: 0,
        seasonPhase: actuals?.seasonPhase ?? "preseason",
        lastCompletedWeek: actuals?.lastCompletedWeek ?? 0,
        cutoffDate: actuals?.cutoffDate ?? "",
        cumulativePprPoints: actuals?.cumulativePprPoints ?? 0,
        gamesPlayed: actuals?.gamesPlayed ?? 0,
        ppg: actuals?.ppg ?? 0,
        totalPtsPercentile: actuals?.totalPtsPercentile ?? 0,
        ppgPercentile: actuals?.ppgPercentile ?? 0,
        blendedValue: effectiveBaseline,
        blendDelta: 0,
        evidence,
      });
    }
    return effectiveBaseline;
  }

  const weight = actuals.actualsWeight;

  // Scale actuals percentile (0-100) to power-law value space.
  // Map percentile to an effective rank: percentile 100 → rank 1, percentile 0 → rank 300
  // We use the position pool size as the denominator when available.
  const posTotal = actuals.positionTotal > 0 ? actuals.positionTotal : 300;
  const effectiveRank = Math.max(1, Math.round(posTotal * (1 - actuals.actualsValue / 100)));
  // Apply keeper offset to match ADP scale (actuals rank is positional, so add offset)
  const draftYear = parseInt(tradeSeason.split("-")[0]);
  const keeperOffset = getKeeperOffset(draftYear);
  let actualsScaled = calcPlayerValue(effectiveRank + keeperOffset);

  // Apply dynasty multipliers to the actuals-scaled value too
  if (dynastyCtx && playerName) {
    actualsScaled = applyDynastyMultiplier(
      actualsScaled,
      playerName,
      playerPosition,
      playerAdp,
      tradeSeason,
      dynastyCtx,
    );
  }

  // ── Actuals-only cap: prevent unranked player from getting elite valuation ──
  // If no ADP signal (fallback was used), cap the positive actuals adjustment
  // so the blended value doesn't exceed the median ranked player value
  if (fallbackApplied && actualsScaled > effectiveBaseline) {
    // Cap at 3× the fallback baseline — prevents waiver wire pickup from
    // being valued like a top-10 pick just from a hot streak
    const maxActualsScaled = effectiveBaseline * 3;
    actualsScaled = Math.min(actualsScaled, maxActualsScaled);
  }

  // ── Sample-size safeguard: dampen weight for small game counts ──
  // A 1-2 game spike should not drive a full-weight actuals adjustment.
  // Apply a games-played dampener that reduces effective weight.
  let effectiveWeight = weight;
  if (actuals.gamesPlayed < 4) {
    const gamesDampener = actuals.gamesPlayed / 4; // 0.25 for 1 game, 0.5 for 2, 0.75 for 3
    effectiveWeight = weight * gamesDampener;
  }

  // Blend: baseline × (1 - weight) + actualsScaled × weight
  const blendedValue = effectiveBaseline * (1 - effectiveWeight) + actualsScaled * effectiveWeight;

  if (audit) {
    const evidence = seasonAdpDetail && unrankedFallbackFactor !== undefined
      ? resolveEvidence({
          playerName,
          playerPosition,
          adpRank: playerAdp,
          hasActuals: true,
          actualsValue: actuals.actualsValue,
          actualsWeight: weight,
          baselineBeforeDynasty: effectiveBaseline,
          baselineAfterDynasty: effectiveBaseline,
          blendedValue,
          unrankedFallbackFactor,
          seasonAdpDetail,
          rookieClasses: dynastyCtx?.rookieClasses,
          tradeSeason,
          seasonMaxRank: getSeasonMaxRank(seasonAdpDetail),
        })
      : undefined;

    audit.push({
      playerName,
      position: actuals.position,
      adpRank: playerAdp,
      baselineValue: effectiveBaseline,
      actualsValue: actuals.actualsValue,
      actualsWeight: weight,
      seasonPhase: actuals.seasonPhase,
      lastCompletedWeek: actuals.lastCompletedWeek,
      cutoffDate: actuals.cutoffDate,
      cumulativePprPoints: actuals.cumulativePprPoints,
      gamesPlayed: actuals.gamesPlayed,
      ppg: actuals.ppg,
      totalPtsPercentile: actuals.totalPtsPercentile,
      ppgPercentile: actuals.ppgPercentile,
      blendedValue,
      blendDelta: blendedValue - effectiveBaseline,
      evidence,
    });
  }

  return blendedValue;
}

/**
 * Compute valuation for a historical trade using season-aware ADP + blended actuals.
 * When tradeActualsMap is provided, automatically blends actuals based on trade date.
 * No toggle — every trade gets the right blend.
 */
export function evaluateHistoricalTrade(
  trade: TradeRow,
  assets: TradeAssetRow[],
  seasonAdpMap: Map<string, Map<string, number>>,
  dynastyCtx?: DynastyContext,
  tradeActualsMap?: Map<number, { meta: TradeActualsResult; players: Map<string, PlayerActualsResult> }>,
  seasonAdpDetailMap?: Map<string, Map<string, AdpEntry>>,
  unrankedFallbackFactor?: number,
): TradeValuation {
  const tradeAssets = assets.filter((a) => a.trade_id === trade.id);
  const teamAAssets = tradeAssets.filter((a) => a.from_team_id === trade.team_a_id);
  const teamBAssets = tradeAssets.filter((a) => a.from_team_id === trade.team_b_id);

  const seasonMap = seasonAdpMap.get(trade.season);
  const seasonDetail = seasonAdpDetailMap?.get(trade.season);
  const tradeActuals = tradeActualsMap?.get(trade.id);
  const audit: BlendedAuditEntry[] = [];

  function sumValue(items: TradeAssetRow[]): number {
    return items.reduce((sum, a) => {
      if (a.asset_type === "player") {
        const adp = a.player_adp_at_trade
          ? Number(a.player_adp_at_trade)
          : seasonMap?.get(normalizeName(a.player_name ?? "")) ?? null;
        let baseValue = adp ? calcPlayerValue(adp) : 0;
        // Apply dynasty multipliers to the baseline
        if (dynastyCtx && a.player_name && baseValue > 0) {
          baseValue = applyDynastyMultiplier(
            baseValue,
            a.player_name,
            a.player_position,
            adp,
            trade.season,
            dynastyCtx,
          );
        }
        // Blend with actuals if available
        const nameNorm = normalizeName(a.player_name ?? "");
        const playerActuals = tradeActuals?.players.get(nameNorm);
        const value = computeBlendedPlayerValue(
          baseValue,
          playerActuals,
          a.player_name ?? "",
          a.player_position,
          adp,
          trade.season,
          dynastyCtx,
          audit,
          seasonDetail,
          unrankedFallbackFactor,
        );
        return sum + value;
      } else {
        const year = a.pick_year;
        const round = a.pick_round ?? 6;
        if (year === null || year === undefined) return sum;
        const refYear = seasonToDraftYear(trade.season);
        return sum + calcPickValue(round, year, a.pick_number ?? undefined, refYear);
      }
    }, 0);
  }

  const teamAValue = sumValue(teamAAssets);
  const teamBValue = sumValue(teamBAssets);
  const avgValue = (teamAValue + teamBValue) / 2;
  const pctDifference = avgValue > 0
    ? Math.round(((teamBValue - teamAValue) / avgValue) * 100 * 10) / 10
    : 0;

  const verdict = getVerdict(pctDifference);
  let winningTeamId: number | null = null;
  let winningTeamName: string | null = null;
  if (Math.abs(pctDifference) > 5) {
    if (pctDifference > 0) {
      winningTeamId = trade.team_a_id;
      winningTeamName = trade.team_a_name;
    } else {
      winningTeamId = trade.team_b_id;
      winningTeamName = trade.team_b_name;
    }
  }

  const absoluteValueGap = Math.abs(teamAValue - teamBValue);
  const tradeSize = teamAValue + teamBValue;
  // Loser loss %: how much the losing side overpaid relative to their own package
  const loserPackageValue = pctDifference > 0 ? teamBValue : teamAValue;
  const loserLossPercentage = loserPackageValue > 0
    ? Math.round((absoluteValueGap / loserPackageValue) * 100 * 10) / 10
    : 0;

  return {
    teamAValue,
    teamBValue,
    pctDifference,
    verdict,
    winningTeamId,
    winningTeamName,
    absoluteValueGap,
    tradeSize,
    loserLossPercentage,
    seasonPhase: tradeActuals?.meta.seasonPhase,
    actualsWeight: tradeActuals?.meta.actualsWeight,
    lastCompletedWeek: tradeActuals?.meta.lastCompletedWeek,
    blendedAudit: audit.length > 0 ? audit : undefined,
  };
}

// ─── Three-Team Trade Valuation ──────────────────────────────

/** Compute the value of a single asset using season ADP + blended actuals */
function computeAssetValue(
  a: TradeAssetRow,
  tradeSeason: string,
  seasonMap: Map<string, number> | undefined,
  dynastyCtx?: DynastyContext,
  tradeActuals?: { meta: TradeActualsResult; players: Map<string, PlayerActualsResult> },
  seasonAdpDetail?: Map<string, AdpEntry>,
  unrankedFallbackFactor?: number,
): number {
  if (a.asset_type === "player") {
    const adp = a.player_adp_at_trade
      ? Number(a.player_adp_at_trade)
      : seasonMap?.get(normalizeName(a.player_name ?? "")) ?? null;
    let baseValue = adp ? calcPlayerValue(adp) : 0;
    if (dynastyCtx && a.player_name && baseValue > 0) {
      baseValue = applyDynastyMultiplier(
        baseValue,
        a.player_name,
        a.player_position,
        adp,
        tradeSeason,
        dynastyCtx,
      );
    }
    // Blend with actuals
    const nameNorm = normalizeName(a.player_name ?? "");
    const playerActuals = tradeActuals?.players.get(nameNorm);
    return computeBlendedPlayerValue(
      baseValue,
      playerActuals,
      a.player_name ?? "",
      a.player_position,
      adp,
      tradeSeason,
      dynastyCtx,
      undefined, // no audit for three-team (could add later)
      seasonAdpDetail,
      unrankedFallbackFactor,
    );
  }
  const year = a.pick_year;
  const round = a.pick_round ?? 6;
  if (year === null || year === undefined) return 0;
  const refYear = seasonToDraftYear(tradeSeason);
  return calcPickValue(round, year, a.pick_number ?? undefined, refYear);
}

/**
 * Evaluate a three-team trade with blended actuals.
 */
export function evaluateThreeTeamTrade(
  trade: TradeRow,
  assets: TradeAssetRow[],
  seasonAdpMap: Map<string, Map<string, number>>,
  dynastyCtx?: DynastyContext,
  tradeActualsMap?: Map<number, { meta: TradeActualsResult; players: Map<string, PlayerActualsResult> }>,
  seasonAdpDetailMap?: Map<string, Map<string, AdpEntry>>,
  unrankedFallbackFactor?: number,
): ThreeTeamValuation {
  const tradeAssets = assets.filter((a) => a.trade_id === trade.id);
  const seasonMap = seasonAdpMap.get(trade.season);
  const seasonDetail = seasonAdpDetailMap?.get(trade.season);
  const tradeActuals = tradeActualsMap?.get(trade.id);

  // Collect all participant team IDs and names
  const teamMap = new Map<number, string>();
  teamMap.set(trade.team_a_id, trade.team_a_name);
  teamMap.set(trade.team_b_id, trade.team_b_name);
  if (trade.team_c_id && trade.team_c_name) {
    teamMap.set(trade.team_c_id, trade.team_c_name);
  }

  const sent = new Map<number, number>();
  const received = new Map<number, number>();
  for (const teamId of teamMap.keys()) {
    sent.set(teamId, 0);
    received.set(teamId, 0);
  }

  for (const asset of tradeAssets) {
    const val = computeAssetValue(asset, trade.season, seasonMap, dynastyCtx, tradeActuals, seasonDetail, unrankedFallbackFactor);
    if (val <= 0) continue;

    sent.set(asset.from_team_id, (sent.get(asset.from_team_id) ?? 0) + val);
    const recipient = asset.recipient_team_id;
    if (recipient) {
      received.set(recipient, (received.get(recipient) ?? 0) + val);
    }
  }

  const results: TeamValuationResult[] = [];
  for (const [teamId, teamName] of teamMap.entries()) {
    const s = sent.get(teamId) ?? 0;
    const r = received.get(teamId) ?? 0;
    results.push({
      teamId,
      teamName,
      sentValue: s,
      receivedValue: r,
      netValue: r - s,
      rank: 0,
    });
  }

  results.sort((a, b) => b.netValue - a.netValue);
  results.forEach((r, i) => { r.rank = i + 1; });

  while (results.length < 3) {
    results.push({ teamId: 0, teamName: "Unknown", sentValue: 0, receivedValue: 0, netValue: 0, rank: results.length + 1 });
  }

  const winner = results[0];
  const second = results[1];
  const winnerMarginOverSecond = winner.netValue - second.netValue;
  const conservationCheck = results.reduce((sum, r) => sum + r.netValue, 0);

  const totalValueMoved = Array.from(sent.values()).reduce((a, b) => a + b, 0);
  const spreadPct = totalValueMoved > 0
    ? Math.round(((winner.netValue - results[2].netValue) / totalValueMoved) * 100 * 10) / 10
    : 0;
  const verdict = getVerdict(spreadPct);

  return {
    teams: results.slice(0, 3) as [TeamValuationResult, TeamValuationResult, TeamValuationResult],
    winner,
    winnerMarginOverSecond,
    conservationCheck,
    verdict,
    valuation_complete: true,
    seasonPhase: tradeActuals?.meta.seasonPhase,
    actualsWeight: tradeActuals?.meta.actualsWeight,
  };
}
