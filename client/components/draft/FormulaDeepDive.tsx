// ─── Formula Deep Dive ─────────────────────────────────────
// Explains the blended ADP + Actuals valuation engine.
// Pre-season example (pure ADP) + Mid-season example (actuals-weighted).

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";

// ── Constants (mirrored from the valuation engine) ──────────
const BASE = 10000;
const POWER = 0.6;
const KEEPER_OFFSET = 44; // 11 teams × 4 keepers
const FUTURE_DISCOUNT = 0.10;
const CURRENT_YEAR = 2026;
const LEAGUE_SIZE = 11;

function calcValue(adp: number): number {
  return BASE * Math.pow(1 / adp, POWER);
}

// ── Example assets ──────────────────────────────────────────
interface ExampleAsset {
  name: string;
  type: "player" | "pick";
  position?: string;
  adp?: number;
  age?: number;
  rookiePick?: number;
  pickYear?: number;
  pickRound?: number;
  // Mid-season actuals fields
  actualsPercentile?: number; // 0-100 server percentile
  positionTotal?: number;     // total players at position in ADP
}

// ── Pre-season trade (pure ADP, 0% actuals weight) ──────────
const PRESEASON_A: ExampleAsset[] = [
  { name: "Ja'Marr Chase", type: "player", position: "WR", adp: 3, age: 26 },
  { name: "2027 Rd 2", type: "pick", pickYear: 2027, pickRound: 2 },
];
const PRESEASON_B: ExampleAsset[] = [
  { name: "Carnell Tate", type: "player", position: "WR", adp: 66, age: 21, rookiePick: 4 },
  { name: "Saquon Barkley", type: "player", position: "RB", adp: 14, age: 29 },
  { name: "2026 Rd 1", type: "pick", pickYear: 2026, pickRound: 1 },
];

// ── Mid-season trade (Week 10, ~62% actuals weight) ─────────
const MIDSEASON_A: ExampleAsset[] = [
  { name: "CeeDee Lamb", type: "player", position: "WR", adp: 5, age: 27,
    actualsPercentile: 88, positionTotal: 120 },
  { name: "2026 Rd 3", type: "pick", pickYear: 2026, pickRound: 3 },
];
const MIDSEASON_B: ExampleAsset[] = [
  { name: "Drake London", type: "player", position: "WR", adp: 22, age: 24,
    actualsPercentile: 72, positionTotal: 120 },
  { name: "2026 Rd 1", type: "pick", pickYear: 2026, pickRound: 1 },
];

const MIDSEASON_WEIGHT = 0.62; // ~Week 10 weight

// ── Compute breakdown ───────────────────────────────────────
interface Breakdown {
  asset: ExampleAsset;
  baseValue: number;
  adpUsed: number;
  factors: { label: string; multiplier: number; explanation: string }[];
  finalValue: number;
  // Blended fields (mid-season only)
  actualsScaled?: number;
  blendedValue?: number;
  blendWeight?: number;
}

function computeBreakdown(asset: ExampleAsset, useMidseason: boolean): Breakdown {
  const factors: Breakdown["factors"] = [];

  if (asset.type === "pick") {
    const round = asset.pickRound ?? 1;
    const year = asset.pickYear ?? CURRENT_YEAR;
    const startOfRound = (round - 1) * LEAGUE_SIZE + 1;
    const endOfRound = round * LEAGUE_SIZE;
    const midPick = (startOfRound + endOfRound) / 2;
    const adpUsed = midPick + KEEPER_OFFSET;
    const baseValue = calcValue(adpUsed);

    const yearsOut = Math.max(0, year - CURRENT_YEAR);
    let discount = 1.0;
    if (yearsOut > 0) {
      discount = Math.pow(1 - FUTURE_DISCOUNT, yearsOut);
      factors.push({
        label: `Future Pick (${year})`,
        multiplier: discount,
        explanation: `${yearsOut}yr out → (1 − 10%)^${yearsOut} = ${(discount * 100).toFixed(0)}% of face value`,
      });
    }

    return { asset, baseValue, adpUsed, factors, finalValue: baseValue * discount };
  }

  // Player
  const adpUsed = asset.adp ?? 999;
  const baseValue = calcValue(adpUsed);
  let multiplier = 1.0;

  // Rookie hype
  if (asset.rookiePick) {
    const pick = asset.rookiePick;
    const t = (pick - 1) / (128 - 1);
    const boost = 0.01 + (0.20 - 0.01) * Math.pow(1 - t, 2);
    const premium = 1 + boost;
    multiplier *= premium;
    factors.push({
      label: `🌟 Rookie #${pick}`,
      multiplier: premium,
      explanation: `NFL Pick #${pick} gets +${Math.round(boost * 100)}% dynasty hype`,
    });
  }

  // Age curve
  if (asset.age) {
    let ageFactor = 1.0;
    if (asset.age <= 24) ageFactor = 1.06;
    else if (asset.age <= 27) ageFactor = 1.03;
    else if (asset.age <= 29) ageFactor = 1.0;
    else if (asset.age <= 31) ageFactor = 0.95;
    else ageFactor = 0.90;
    if (ageFactor !== 1.0) {
      multiplier *= ageFactor;
      const pct = Math.round((ageFactor - 1) * 100);
      factors.push({
        label: `🎂 Age ${asset.age}`,
        multiplier: ageFactor,
        explanation: `${asset.age <= 27 ? "Prime window" : "Aging"} → ${pct >= 0 ? "+" : ""}${pct}%`,
      });
    }
  }

  const adjustedBaseline = baseValue * multiplier;

  // Mid-season blending
  if (useMidseason && asset.actualsPercentile != null && asset.positionTotal) {
    const effectiveRank = Math.round(asset.positionTotal * (1 - asset.actualsPercentile / 100));
    const actualsScaled = calcValue(effectiveRank + KEEPER_OFFSET);
    const blended = adjustedBaseline * (1 - MIDSEASON_WEIGHT) + actualsScaled * MIDSEASON_WEIGHT;
    return {
      asset, baseValue, adpUsed, factors, finalValue: adjustedBaseline,
      actualsScaled, blendedValue: blended, blendWeight: MIDSEASON_WEIGHT,
    };
  }

  return { asset, baseValue, adpUsed, factors, finalValue: adjustedBaseline };
}

// ── Verdict helper ──────────────────────────────────────────
function getVerdict(pctDiff: number) {
  const abs = Math.abs(pctDiff);
  if (abs <= 5) return { label: "Fair Catch", emoji: "🧤", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30" };
  if (abs <= 15) return { label: "Edge Rush", emoji: "📈", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/30" };
  if (abs <= 25) return { label: "Pick Six", emoji: "🏆", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" };
  return { label: "Flag on the Play", emoji: "🚩", color: "text-red-400", bg: "bg-red-500/10 border-red-500/30" };
}

// ── Main component ──────────────────────────────────────────
export default function FormulaDeepDive() {
  const [mode, setMode] = useState<"preseason" | "midseason">("preseason");
  const [showMath, setShowMath] = useState(true);

  const isMidseason = mode === "midseason";
  const teamASends = isMidseason ? MIDSEASON_A : PRESEASON_A;
  const teamBSends = isMidseason ? MIDSEASON_B : PRESEASON_B;

  const { teamABreakdowns, teamBBreakdowns, teamATotal, teamBTotal, pctDiff, verdict, winner } = useMemo(() => {
    const aBreaks = teamASends.map((a) => computeBreakdown(a, isMidseason));
    const bBreaks = teamBSends.map((a) => computeBreakdown(a, isMidseason));
    const aTotal = aBreaks.reduce((s, b) => s + (b.blendedValue ?? b.finalValue), 0);
    const bTotal = bBreaks.reduce((s, b) => s + (b.blendedValue ?? b.finalValue), 0);
    const avg = (aTotal + bTotal) / 2;
    const pct = avg > 0 ? ((bTotal - aTotal) / avg) * 100 : 0;
    const v = getVerdict(pct);
    const w = Math.abs(pct) <= 5 ? null : aTotal > bTotal ? "Team B" : "Team A";
    return { teamABreakdowns: aBreaks, teamBBreakdowns: bBreaks, teamATotal: aTotal, teamBTotal: bTotal, pctDiff: pct, verdict: v, winner: w };
  }, [mode]);

  return (
    <div className="space-y-6 text-sm">
      {/* ─── Section 1: How It Works (plain English) ─── */}
      <div className="bg-muted/20 rounded-xl p-4 border border-border/40">
        <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">
          How It Works
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Every player and pick gets a <span className="text-foreground font-semibold">point value</span> based
          on their ADP rank. Before the season starts, that's the whole story. Once games begin, real performance
          data blends in — starting small in Week 1 and growing to ~85% weight by the end of the season.
          The formula automatically knows where we are in the season and adjusts the mix.
        </p>
      </div>

      {/* ─── Section 2: Variables & Factors ─── */}
      <div>
        <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
          What Drives The Numbers
        </h4>
        <div className="grid gap-2">
          <VarRow
            emoji="📊"
            name="Base Value"
            formula="10,000 × (1 / ADP) ^ 0.6"
            desc="The starting point. Lower ADP = higher value. The power curve means the gap between ADP 1 and ADP 10 is huge, but ADP 100 vs 110 is tiny."
          />
          <VarRow
            emoji="🔒"
            name="Keeper Offset"
            formula="11 teams × 4 keepers = 44"
            desc="Top 44 players are kept and never hit the draft. Pick 1.01 actually targets the 45th-best player, not the #1."
          />
          <VarRow
            emoji="📉"
            name="Future Pick Discount"
            formula="−10% per year out"
            desc="A 2027 pick is worth 90% of the same pick this year. A 2028 pick? ~81%. Uncertainty costs value."
          />
          <VarRow
            emoji="🌟"
            name="Rookie Hype"
            formula="+1% to +20%"
            desc="Current NFL Draft class gets a dynasty premium. #1 overall gets the max boost, declining by pick. Reflects that rookie ceiling hype."
          />
          <VarRow
            emoji="🎂"
            name="Age Curve"
            formula="≤24: +6% · 25-27: +3% · 30-31: −5% · 32+: −10%"
            desc="Young players in their prime window get a bump. Aging vets take a haircut. Dynasty is about buying future production."
          />
          <VarRow
            emoji="⚡"
            name="Positional Scarcity"
            formula="Top-5 QB: +8%"
            desc="Elite QBs are rare in dynasty — the top 5 get a scarcity boost. TE premium is optional (off by default)."
          />
          <VarRow
            emoji="🔄"
            name="Actuals Blend"
            formula="baseline × (1 − weight) + actuals × weight"
            desc="During the season, real performance data blends in. Week 1 ≈ 5% actuals, Week 10 ≈ 62%, Postseason ≈ 85%. Preseason is pure ADP."
          />
        </div>
      </div>

      {/* ─── Section 3: Worked Example ─── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
            Worked Example
          </h4>
          <div className="flex items-center gap-2">
            {/* Pre-season / Mid-season toggle */}
            <div className="flex rounded-lg bg-muted/40 border border-border/50 overflow-hidden">
              <button
                onClick={() => setMode("preseason")}
                className={`text-[10px] px-2.5 py-1 font-semibold transition-colors ${
                  !isMidseason ? "bg-emerald-500/20 text-emerald-400" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                ☀️ Pre-Season
              </button>
              <button
                onClick={() => setMode("midseason")}
                className={`text-[10px] px-2.5 py-1 font-semibold transition-colors ${
                  isMidseason ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                🏈 Mid-Season
              </button>
            </div>
            <button
              onClick={() => setShowMath(!showMath)}
              className="text-[10px] px-2 py-0.5 rounded bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
            >
              {showMath ? "Hide math" : "Show math"}
            </button>
          </div>
        </div>

        {/* Context badge */}
        <div className={`mb-3 rounded-lg px-3 py-2 text-[11px] border ${
          isMidseason
            ? "bg-amber-500/5 border-amber-500/20 text-amber-300"
            : "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
        }`}>
          {isMidseason ? (
            <>
              <span className="font-semibold">📅 Week 10 trade</span> — Actuals weight: {Math.round(MIDSEASON_WEIGHT * 100)}%.
              Player values are a blend of their ADP baseline and how they've actually performed this season.
            </>
          ) : (
            <>
              <span className="font-semibold">☀️ August trade</span> — Actuals weight: 0%.
              No games played yet, so values are based entirely on consensus ADP rankings.
            </>
          )}
        </div>

        {/* Trade layout */}
        <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
          <div className="grid grid-cols-2 text-center text-[10px] font-bold uppercase tracking-wider border-b border-border">
            <div className="px-3 py-2 bg-blue-500/5 text-blue-400 border-r border-border">
              Team A Sends
            </div>
            <div className="px-3 py-2 bg-orange-500/5 text-orange-400">
              Team B Sends
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="p-3 space-y-3">
              {teamABreakdowns.map((b, i) => (
                <AssetCard key={i} breakdown={b} showMath={showMath} color="blue" isMidseason={isMidseason} />
              ))}
              <TotalRow value={teamATotal} color="blue" />
            </div>
            <div className="p-3 space-y-3">
              {teamBBreakdowns.map((b, i) => (
                <AssetCard key={i} breakdown={b} showMath={showMath} color="orange" isMidseason={isMidseason} />
              ))}
              <TotalRow value={teamBTotal} color="orange" />
            </div>
          </div>

          {/* Verdict bar */}
          <div className={`border-t border-border p-3 ${verdict.bg}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">{verdict.emoji}</span>
                <div>
                  <span className={`text-sm font-bold ${verdict.color}`}>{verdict.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {Math.abs(pctDiff).toFixed(1)}% difference
                  </span>
                </div>
              </div>
              {winner && (
                <Badge variant="outline" className={`text-[10px] ${verdict.color} border-current/30`}>
                  {winner} wins
                </Badge>
              )}
            </div>
            {showMath && (
              <div className="mt-2 text-[10px] font-mono text-muted-foreground bg-background/40 rounded px-2 py-1.5">
                <span className="text-muted-foreground/70">Gap = </span>
                ({Math.round(teamBTotal).toLocaleString()} − {Math.round(teamATotal).toLocaleString()})
                {" ÷ avg × 100 = "}
                <span className={verdict.color}>{pctDiff >= 0 ? "+" : ""}{pctDiff.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Section 4: Evidence Model ─── */}
      <div>
        <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
          🪤 Evidence Model — "Never Zero"
        </h4>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          Not every player has both ADP and actuals data. Instead of assigning zero value
          (which would distort trade verdicts), the engine classifies every player into one
          of four evidence states and applies appropriate fallback valuation:
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-2.5">
            <span className="text-[10px] font-bold text-emerald-400">✅ ADP + Actuals</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Best confidence. Full blend formula with trade-date actuals.</p>
          </div>
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2.5">
            <span className="text-[10px] font-bold text-blue-400">📋 ADP Only</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Preseason trade, IR player, or no qualifying games. Uses ADP baseline, no actuals adjustment.</p>
          </div>
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5">
            <span className="text-[10px] font-bold text-amber-400">📊 Actuals Only</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Mid-season pickup or outside ADP export range. Positional baseline + capped actuals boost.</p>
          </div>
          <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-2.5">
            <span className="text-[10px] font-bold text-yellow-400">🪤 Neither Source</span>
            <p className="text-[10px] text-muted-foreground mt-0.5">Uses rookie baseline (if confirmed in draft data) or dynamic positional floor. Never zero.</p>
          </div>
        </div>
        <div className="bg-muted/30 rounded-lg p-2.5 border border-border/50 space-y-1.5">
          <div className="text-[10px] font-bold text-muted-foreground">Fallback Baseline Formula</div>
          <code className="block text-[10px] font-mono text-muted-foreground bg-background/40 rounded px-2 py-1">
            ranked_tail = median(bottom 10 ranked players at position)
          </code>
          <code className="block text-[10px] font-mono text-muted-foreground bg-background/40 rounded px-2 py-1">
            unranked_baseline = ranked_tail × fallback_factor (default 50%)
          </code>
          <p className="text-[10px] text-muted-foreground/70">
            Cross-position clamp ensures unranked players are always valued below the worst ranked player.
            Adjust the "Unranked Player Baseline" slider in ▶ Advanced Settings to control the factor.
          </p>
        </div>
      </div>

      {/* ─── Section 5: References ─── */}
      <div>
        <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
          Data Sources
        </h4>
        <div className="space-y-2">
          <RefItem
            emoji="📊"
            source="FantasyPros Consensus ADP"
            detail="9 seasons (2018–2027), 5,315 player records. Aggregated from ESPN, Sleeper, CBS, NFL, RTSports, and Fantrax."
          />
          <RefItem
            emoji="🏈"
            source="NFL Draft Results (2018–2026)"
            detail="Official pick numbers, positions, and ages. Powers the rookie hype premium for rounds 1–4."
          />
          <RefItem
            emoji="📈"
            source="In-Season Performance"
            detail="Position-normalized scoring percentiles computed from actual game stats. Updates weekly during the season."
          />
          <RefItem
            emoji="📜"
            source="C-Town Trade History"
            detail="275+ trades across 7 seasons, 1,188 total assets. Used for Déjà Vu matching and The Verdicts."
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function VarRow({ emoji, name, formula, desc }: { emoji: string; name: string; formula: string; desc: string }) {
  return (
    <div className="flex gap-3 items-start bg-muted/20 rounded-lg p-2.5 border border-border/40">
      <div className="w-7 h-7 rounded-md bg-muted/50 border border-border/50 flex items-center justify-center shrink-0">
        <span className="text-sm">{emoji}</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-bold text-foreground">{name}</span>
          <code className="text-[10px] bg-background/60 px-1.5 py-0.5 rounded font-mono text-muted-foreground">{formula}</code>
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

function AssetCard({ breakdown, showMath, color, isMidseason }: {
  breakdown: Breakdown; showMath: boolean; color: "blue" | "orange"; isMidseason: boolean;
}) {
  const { asset, baseValue, adpUsed, factors, finalValue, actualsScaled, blendedValue, blendWeight } = breakdown;
  const isPlayer = asset.type === "player";
  const accentText = color === "blue" ? "text-blue-400" : "text-orange-400";
  const accentBg = color === "blue" ? "bg-blue-500/5" : "bg-orange-500/5";
  const displayValue = blendedValue ?? finalValue;

  return (
    <div className={`rounded-lg border border-border/50 ${accentBg} overflow-hidden`}>
      <div className="px-2.5 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">{isPlayer ? "🏈" : "📋"}</span>
          <div className="min-w-0">
            <span className="text-xs font-bold text-foreground truncate block">{asset.name}</span>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {asset.position && <span>{asset.position}</span>}
              {asset.age && <span>· Age {asset.age}</span>}
              {asset.rookiePick && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-purple-500/10 border-purple-500/30 text-purple-400">
                  ROOKIE
                </Badge>
              )}
              {isMidseason && asset.actualsPercentile != null && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">
                  {asset.actualsPercentile}th %ile
                </Badge>
              )}
            </div>
          </div>
        </div>
        <span className={`text-sm font-extrabold font-mono ${accentText}`}>
          {Math.round(displayValue).toLocaleString()}
        </span>
      </div>

      {showMath && (
        <div className="border-t border-border/30 px-2.5 py-2 space-y-1.5 bg-background/30">
          <MathStep
            label={isPlayer ? `ADP ${adpUsed}` : `Pick → ADP ${Math.round(adpUsed)}`}
            formula={`10,000 × (1/${Math.round(adpUsed)})^0.6`}
            result={Math.round(baseValue).toLocaleString()}
            annotation={
              isPlayer
                ? "Consensus ADP rank → base value"
                : `Rd ${asset.pickRound} mid-pick (${Math.round(adpUsed - KEEPER_OFFSET)}) + ${KEEPER_OFFSET} keeper offset`
            }
          />
          {factors.map((f, i) => {
            const prev = i === 0 ? baseValue : factors.slice(0, i).reduce((v, ff) => v * ff.multiplier, baseValue);
            const after = prev * f.multiplier;
            return (
              <MathStep
                key={i}
                label={f.label}
                formula={`× ${f.multiplier.toFixed(2)}`}
                result={Math.round(after).toLocaleString()}
                annotation={f.explanation}
                isModifier
              />
            );
          })}

          {/* Blending step (mid-season only) */}
          {blendedValue != null && actualsScaled != null && blendWeight != null && (
            <>
              <div className="border-t border-amber-500/20 pt-1.5 mt-1">
                <MathStep
                  label="📈 Actuals Value"
                  formula={`ADP-equiv of ${asset.actualsPercentile}th %ile`}
                  result={Math.round(actualsScaled).toLocaleString()}
                  annotation={`How this player's actual production maps back to value`}
                  isModifier
                />
                <MathStep
                  label="🔄 Blended"
                  formula={`${Math.round(finalValue)} × ${((1 - blendWeight) * 100).toFixed(0)}% + ${Math.round(actualsScaled)} × ${(blendWeight * 100).toFixed(0)}%`}
                  result={Math.round(blendedValue).toLocaleString()}
                  annotation={`Week 10 blend: ${(blendWeight * 100).toFixed(0)}% real performance, ${((1 - blendWeight) * 100).toFixed(0)}% ADP baseline`}
                  isModifier
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MathStep({
  label, formula, result, annotation, isModifier,
}: {
  label: string; formula: string; result: string; annotation: string; isModifier?: boolean;
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-2 text-[10px]">
        <div className="flex flex-col items-center w-3 shrink-0">
          <div className={`w-px h-2 ${isModifier ? "bg-purple-500/40" : "bg-muted-foreground/20"}`} />
          <div className={`text-[8px] ${isModifier ? "text-purple-400" : "text-muted-foreground/50"}`}>
            {isModifier ? "↓" : "→"}
          </div>
        </div>
        <span className={`font-semibold shrink-0 ${isModifier ? "text-purple-400" : "text-foreground"}`}>
          {label}
        </span>
        <code className="font-mono text-muted-foreground/80 shrink-0">{formula}</code>
        <span className="text-muted-foreground/40 mx-0.5">=</span>
        <span className="font-mono font-bold text-foreground">{result}</span>
      </div>
      <div className="ml-5 text-[9px] text-muted-foreground/60 leading-tight mt-0.5 italic">
        {annotation}
      </div>
    </div>
  );
}

function TotalRow({ value, color }: { value: number; color: "blue" | "orange" }) {
  const textColor = color === "blue" ? "text-blue-400" : "text-orange-400";
  const borderColor = color === "blue" ? "border-blue-500/30" : "border-orange-500/30";
  return (
    <div className={`flex items-center justify-between border-t ${borderColor} pt-2 mt-1`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total</span>
      <span className={`text-base font-extrabold font-mono ${textColor}`}>
        {Math.round(value).toLocaleString()}
      </span>
    </div>
  );
}

function RefItem({ emoji, source, detail }: { emoji: string; source: string; detail: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <span className="text-sm mt-0.5">{emoji}</span>
      <div>
        <span className="text-xs font-semibold text-foreground">{source}</span>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{detail}</p>
      </div>
    </div>
  );
}
