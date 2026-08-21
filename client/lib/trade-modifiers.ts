// ─── Configurable Trade Model Modifiers ──────────────────────
// Shared type + defaults for the 11 slider-driven parameters
// that control The C-Town Exchange valuation engine.

// Every slider that dials a canonical value takes its NEUTRAL POSITION from
// the valuation spec. At the defaults below the Exchange reproduces the
// canonical engine exactly — the sliders are deviations from the spec, never
// a second source of truth for it.

import {
  FAIR_TOLERANCE,
  POSITIONAL_SCARCITY,
  POWER,
  ROOKIE_MAX_BOOST,
} from "./valuation/valuation-spec";

/**
 * Neutral position of the future-pick dial. The engine treats this value as
 * intensity 1.0 on the canonical step discount table (1.00 / 0.80 / 0.65 /
 * 0.50), NOT as a per-year geometric penalty. Raising it deepens every step;
 * setting it to 0 disables future-pick discounting.
 */
export const NEUTRAL_FUTURE_PICK_DIAL = 0.10;

export interface TradeModifiers {
  // Positional scarcity multipliers (1.0 = no effect)
  qbScarcity: number;      // Neutral: POSITIONAL_SCARCITY — top-5 QB boost
  tePremium: number;        // Default 1.00 — top-5 TE boost (off by default)
  rbPremium: number;        // Default 1.00 — RB value multiplier
  wrPremium: number;        // Default 1.00 — WR value multiplier

  // Dynasty factors
  rookieHype: number;       // Neutral: ROOKIE_MAX_BOOST — max rookie boost for #1 overall
  ageCurve: number;         // Default 1.0  — multiplier on age factor deviation (0=off, 2=aggressive)
  futurePickDiscount: number; // Neutral: NEUTRAL_FUTURE_PICK_DIAL — intensity on the canonical step table

  // Model shape
  valueCurve: number;       // Neutral: POWER — power law exponent (higher = steeper dropoff)

  // Verdict calibration
  fairTolerance: number;    // Neutral: FAIR_TOLERANCE — ±% for "Fair Catch"
  verdictScale: number;     // Default 1.0  — multiplier on verdict thresholds (lower = stricter)

  // Fallback valuation
  unrankedFallbackFactor: number; // Default 0.50 — multiplier on ranked tail for unranked players (0.25-0.75)

  // Déjà Vu
  dejaVuSensitivity: number; // Default 3 — max matches to show (1-10)
}

export const DEFAULT_MODIFIERS: TradeModifiers = {
  qbScarcity: POSITIONAL_SCARCITY,
  tePremium: 1.00,
  rbPremium: 1.00,
  wrPremium: 1.00,
  rookieHype: ROOKIE_MAX_BOOST,
  ageCurve: 1.0,
  futurePickDiscount: NEUTRAL_FUTURE_PICK_DIAL,
  valueCurve: POWER,
  fairTolerance: FAIR_TOLERANCE,
  verdictScale: 1.0,
  unrankedFallbackFactor: 0.50,
  dejaVuSensitivity: 3,
};

export interface SliderConfig {
  key: keyof TradeModifiers;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  format: (v: number) => string;
  category: "positional" | "dynasty" | "model" | "verdict" | "history" | "fallback";
}

const pctFormat = (v: number) => `${Math.round((v - 1) * 100)}%`;
const pctRawFormat = (v: number) => `${Math.round(v * 100)}%`;
const plainPctFormat = (v: number) => `±${v}%`;

export const SLIDER_CONFIGS: SliderConfig[] = [
  // ── Positional Scarcity ──
  {
    key: "qbScarcity",
    label: "QB Scarcity",
    description: "Boost for top-5 QBs by ADP",
    min: 1.00, max: 1.25, step: 0.01,
    defaultValue: POSITIONAL_SCARCITY,
    format: (v) => v === 1.0 ? "Off" : `+${Math.round((v - 1) * 100)}%`,
    category: "positional",
  },
  {
    key: "tePremium",
    label: "TE Premium",
    description: "Boost for top-5 TEs by ADP",
    min: 1.00, max: 1.25, step: 0.01,
    defaultValue: 1.00,
    format: (v) => v === 1.0 ? "Off" : `+${Math.round((v - 1) * 100)}%`,
    category: "positional",
  },
  {
    key: "rbPremium",
    label: "RB Adjustment",
    description: "Value multiplier for all RBs",
    min: 0.85, max: 1.15, step: 0.01,
    defaultValue: 1.00,
    format: (v) => v === 1.0 ? "Neutral" : `${v > 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`,
    category: "positional",
  },
  {
    key: "wrPremium",
    label: "WR Adjustment",
    description: "Value multiplier for all WRs",
    min: 0.85, max: 1.15, step: 0.01,
    defaultValue: 1.00,
    format: (v) => v === 1.0 ? "Neutral" : `${v > 1 ? "+" : ""}${Math.round((v - 1) * 100)}%`,
    category: "positional",
  },

  // ── Dynasty Factors ──
  {
    key: "rookieHype",
    label: "Rookie Hype",
    description: "Max dynasty boost for NFL #1 overall pick",
    min: 0.00, max: 0.40, step: 0.01,
    defaultValue: ROOKIE_MAX_BOOST,
    format: (v) => v === 0 ? "Off" : `+${Math.round(v * 100)}%`,
    category: "dynasty",
  },
  {
    key: "ageCurve",
    label: "Age Curve",
    description: "How much age matters (0=ignore, 1=normal, 2=aggressive)",
    min: 0.0, max: 2.0, step: 0.1,
    defaultValue: 1.0,
    format: (v) => v === 0 ? "Off" : v === 1.0 ? "Normal" : v < 1.0 ? "Mild" : "Aggressive",
    category: "dynasty",
  },
  {
    key: "futurePickDiscount",
    label: "Future Pick Discount",
    description:
      "Intensity of the league's future-pick discount (1yr 80%, 2yr 65%, 3yr+ 50%). Normal reproduces the canonical table.",
    min: 0.00, max: 0.25, step: 0.01,
    defaultValue: NEUTRAL_FUTURE_PICK_DIAL,
    format: (v) =>
      v === 0
        ? "Off"
        : v === NEUTRAL_FUTURE_PICK_DIAL
          ? "Normal"
          : v < NEUTRAL_FUTURE_PICK_DIAL
            ? "Softer"
            : "Harsher",
    category: "dynasty",
  },

  // ── Model Shape ──
  {
    key: "valueCurve",
    label: "Value Curve Steepness",
    description: "How fast value drops after ADP #1 (higher = steeper)",
    min: 0.3, max: 0.9, step: 0.05,
    defaultValue: POWER,
    format: (v) => v <= 0.4 ? "Flat" : v <= 0.55 ? "Gentle" : v <= 0.7 ? "Normal" : "Steep",
    category: "model",
  },

  // ── Verdict Calibration ──
  {
    key: "fairTolerance",
    label: "Fair Trade Tolerance",
    description: "% gap considered 'Fair Catch'",
    min: 1, max: 15, step: 1,
    defaultValue: FAIR_TOLERANCE,
    format: (v) => `±${v}%`,
    category: "verdict",
  },
  {
    key: "verdictScale",
    label: "Verdict Strictness",
    description: "Scale all verdict thresholds (lower = stricter grading)",
    min: 0.5, max: 1.5, step: 0.1,
    defaultValue: 1.0,
    format: (v) => v === 1.0 ? "Normal" : v < 1.0 ? "Strict" : "Loose",
    category: "verdict",
  },

  // ── Fallback Valuation ──
  {
    key: "unrankedFallbackFactor",
    label: "Unranked Player Baseline",
    description: "How much value unranked players get relative to the worst ranked players at their position",
    min: 0.25, max: 0.75, step: 0.05,
    defaultValue: 0.50,
    format: (v) => `${Math.round(v * 100)}% of tail`,
    category: "fallback",
  },

  // ── History ──
  {
    key: "dejaVuSensitivity",
    label: "Déjà Vu Matches",
    description: "Max historical trade comparisons to show",
    min: 1, max: 10, step: 1,
    defaultValue: 3,
    format: (v) => `${v} max`,
    category: "history",
  },
];

export const CATEGORY_LABELS: Record<SliderConfig["category"], { label: string; emoji: string }> = {
  positional: { label: "Positional Scarcity", emoji: "🏈" },
  dynasty: { label: "Dynasty Factors", emoji: "👑" },
  model: { label: "Model Shape", emoji: "📐" },
  verdict: { label: "Verdict Calibration", emoji: "⚖️" },
  fallback: { label: "Fallback Valuation", emoji: "🪤" },
  history: { label: "History", emoji: "🔮" },
};
