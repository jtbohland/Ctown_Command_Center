// ─── Formula Deep Dive ─────────────────────────────────────
// Worked example trade with annotated math + variable glossary + references.
// Renders inside the Playbook accordion.

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";

// ── Constants (mirrored from evaluate-trade.ts for illustrative math) ──
const BASE = 10000;
const POWER = 0.6;
const KEEPER_OFFSET = 44; // 11 teams × 4 keepers (2026)
const FUTURE_DISCOUNT = 0.10; // 10% per year
const CURRENT_YEAR = 2026;
const LEAGUE_SIZE = 11;

function calcValue(adp: number): number {
  return BASE * Math.pow(1 / adp, POWER);
}

// ── The example trade data ──────────────────────────────────
interface ExampleAsset {
  name: string;
  type: "player" | "pick";
  position?: string;
  adp?: number;
  age?: number;
  rookiePick?: number; // NFL overall pick (2026 class)
  pickYear?: number;
  pickRound?: number;
}

const TEAM_A_SENDS: ExampleAsset[] = [
  { name: "Ja'Marr Chase", type: "player", position: "WR", adp: 3, age: 26 },
  { name: "2027 Rd 2", type: "pick", pickYear: 2027, pickRound: 2 },
];

const TEAM_B_SENDS: ExampleAsset[] = [
  { name: "Carnell Tate", type: "player", position: "WR", adp: 66, age: 21, rookiePick: 4 },
  { name: "Saquon Barkley", type: "player", position: "RB", adp: 14, age: 29 },
  { name: "2026 Rd 1", type: "pick", pickYear: 2026, pickRound: 1 },
];

// ── Compute the full breakdown for an asset ─────────────────
interface Breakdown {
  asset: ExampleAsset;
  baseValue: number;
  adpUsed: number;
  factors: { label: string; multiplier: number; explanation: string }[];
  finalValue: number;
}

function computeBreakdown(asset: ExampleAsset): Breakdown {
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
        explanation: `${yearsOut}yr out → (1 - 0.10)^${yearsOut} = ${(discount * 100).toFixed(0)}%`,
      });
    }

    return {
      asset,
      baseValue,
      adpUsed,
      factors,
      finalValue: baseValue * discount,
    };
  }

  // Player
  const adpUsed = asset.adp ?? 999;
  const baseValue = calcValue(adpUsed);
  let multiplier = 1.0;

  // Rookie hype (2026 class only)
  if (asset.rookiePick) {
    const pick = asset.rookiePick;
    const t = (pick - 1) / (128 - 1);
    const boost = 0.01 + (0.20 - 0.01) * Math.pow(1 - t, 2);
    const premium = 1 + boost;
    multiplier *= premium;
    factors.push({
      label: `Rookie #${pick}`,
      multiplier: premium,
      explanation: `2026 NFL Pick #${pick} → +${Math.round(boost * 100)}% hype`,
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
        label: `Age ${asset.age}`,
        multiplier: ageFactor,
        explanation: `${asset.age <= 27 ? "Young window" : "Aging"} → ${pct >= 0 ? "+" : ""}${pct}%`,
      });
    }
  }

  return {
    asset,
    baseValue,
    adpUsed,
    factors,
    finalValue: baseValue * multiplier,
  };
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
  const [showMath, setShowMath] = useState(true);

  const { teamABreakdowns, teamBBreakdowns, teamATotal, teamBTotal, pctDiff, verdict, winner } = useMemo(() => {
    const aBreaks = TEAM_A_SENDS.map(computeBreakdown);
    const bBreaks = TEAM_B_SENDS.map(computeBreakdown);
    const aTotal = aBreaks.reduce((s, b) => s + b.finalValue, 0);
    const bTotal = bBreaks.reduce((s, b) => s + b.finalValue, 0);
    const avg = (aTotal + bTotal) / 2;
    const pct = avg > 0 ? ((bTotal - aTotal) / avg) * 100 : 0;
    const v = getVerdict(pct);
    const w = Math.abs(pct) <= 5 ? null : pct > 0 ? "Team B" : "Team A";
    return {
      teamABreakdowns: aBreaks,
      teamBBreakdowns: bBreaks,
      teamATotal: aTotal,
      teamBTotal: bTotal,
      pctDiff: pct,
      verdict: v,
      winner: w,
    };
  }, []);

  return (
    <div className="space-y-6 text-sm">
      {/* ─── Section 1: Variable Glossary ─── */}
      <div>
        <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
          Variables & Factors
        </h4>
        <div className="grid gap-2">
          <VarRow
            symbol="V"
            name="Base Value"
            formula="10,000 × (1 / ADP)^0.6"
            desc="Core player worth derived from consensus ADP rank. Lower ADP = higher value. The power curve (0.6) means top picks are exponentially more valuable."
          />
          <VarRow
            symbol="K"
            name="Keeper Offset"
            formula="Teams × Keepers = 11 × 4 = 44"
            desc="In a keeper league, the top 44 players are kept and never enter the draft. So pick 1.01 actually targets ADP 45, not ADP 1."
          />
          <VarRow
            symbol="D"
            name="Future Pick Discount"
            formula="(1 - 0.10)^years_out"
            desc="Future picks lose 10% of value per year into the future. A 2027 pick is worth 90% of a 2026 pick. A 2028 pick is worth ~81%."
          />
          <VarRow
            symbol="R"
            name="Rookie Hype"
            formula="+1% to +20% (graduated by NFL pick)"
            desc="2026 NFL Draft picks get a premium. Pick #1 gets the max boost (+20%), declining quadratically. Pick #128 gets just +1%."
          />
          <VarRow
            symbol="A"
            name="Age Curve"
            formula="≤24: +6% · 25-27: +3% · 28-29: 0% · 30-31: -5% · 32+: -10%"
            desc="Young players in their prime window get a boost. Aging veterans take a hit. Reflects dynasty timelines — you're buying future production."
          />
          <VarRow
            symbol="P"
            name="Positional Scarcity"
            formula="QB top-5: +8% · TE top-5: configurable"
            desc="Elite QBs are scarce in dynasty — the top 5 by ADP get a boost. TE premium is off by default but can be enabled for TE-premium leagues."
          />
          <VarRow
            symbol="%"
            name="Trade Gap"
            formula="(Side B - Side A) / average × 100"
            desc="The percentage difference between sides determines the verdict. Positive = Team A wins (received more). Negative = Team B wins."
          />
        </div>
      </div>

      {/* ─── Section 2: Worked Example ─── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">
            Worked Example
          </h4>
          <button
            onClick={() => setShowMath(!showMath)}
            className="text-[10px] px-2 py-0.5 rounded bg-muted/50 hover:bg-muted text-muted-foreground transition-colors"
          >
            {showMath ? "Hide math" : "Show math"}
          </button>
        </div>

        {/* Trade layout */}
        <div className="rounded-xl border border-border bg-muted/20 overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-2 text-center text-[10px] font-bold uppercase tracking-wider border-b border-border">
            <div className="px-3 py-2 bg-blue-500/5 text-blue-400 border-r border-border">
              Team A Sends
            </div>
            <div className="px-3 py-2 bg-orange-500/5 text-orange-400">
              Team B Sends
            </div>
          </div>

          {/* Asset rows */}
          <div className="grid grid-cols-2 divide-x divide-border">
            <div className="p-3 space-y-3">
              {teamABreakdowns.map((b, i) => (
                <AssetCard key={i} breakdown={b} showMath={showMath} color="blue" />
              ))}
              <TotalRow value={teamATotal} color="blue" />
            </div>
            <div className="p-3 space-y-3">
              {teamBBreakdowns.map((b, i) => (
                <AssetCard key={i} breakdown={b} showMath={showMath} color="orange" />
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
                  <span className={`text-sm font-bold ${verdict.color}`}>
                    {verdict.label}
                  </span>
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
                <span className="text-muted-foreground/70">Trade Gap = </span>
                ({Math.round(teamBTotal).toLocaleString()} − {Math.round(teamATotal).toLocaleString()})
                {" "}/ avg({Math.round(teamATotal).toLocaleString()}, {Math.round(teamBTotal).toLocaleString()})
                {" "}× 100 = <span className={verdict.color}>{pctDiff >= 0 ? "+" : ""}{pctDiff.toFixed(1)}%</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Section 3: References ─── */}
      <div>
        <h4 className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
          References & Data Sources
        </h4>
        <div className="space-y-2">
          <RefItem
            number={1}
            source="FantasyPros Consensus ADP"
            detail="Average Draft Position rankings aggregated from ESPN, Sleeper, CBS, NFL, RTSports, and Fantrax. Covers 9 seasons (2018-19 through 2026-27), 5,315 player-season records. QB, RB, WR, TE only — kickers and defenses excluded."
          />
          <RefItem
            number={2}
            source="NFL Draft Results (2018–2026)"
            detail="Official NFL draft data including overall pick number, position, and age on draft day. Used for the rookie hype premium and age curve calculations. Covers rounds 1–4 (picks 1–128)."
          />
          <RefItem
            number={3}
            source="C-Town WarRoom Historical Trades"
            detail="275 trades from 7 seasons (2018-19 through 2024-25), comprising 1,188 total assets (373 players, 815 picks). Used for Deal Deja Vu matching and league-specific pattern analysis."
          />
          <RefItem
            number={4}
            source="Dynasty Trade Value Research"
            detail="Age curve brackets, positional scarcity multipliers, and power-law value modeling derived from community consensus across dynasty fantasy football analysis. Calibrated to C-Town's 4-keeper, 11-team format."
          />
          <RefItem
            number={5}
            source="Keeper League Structure"
            detail="C-Town league parameters: 10 teams (2019–2024), 11 teams (2025+), 4 keepers per team. These values determine the keeper offset that adjusts draft pick ADP targeting."
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function VarRow({ symbol, name, formula, desc }: { symbol: string; name: string; formula: string; desc: string }) {
  return (
    <div className="flex gap-3 items-start bg-muted/20 rounded-lg p-2.5 border border-border/40">
      <div className="w-7 h-7 rounded-md bg-purple-500/15 border border-purple-500/30 flex items-center justify-center shrink-0">
        <span className="text-xs font-bold font-mono text-purple-400">{symbol}</span>
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

function AssetCard({ breakdown, showMath, color }: { breakdown: Breakdown; showMath: boolean; color: "blue" | "orange" }) {
  const { asset, baseValue, adpUsed, factors, finalValue } = breakdown;
  const isPlayer = asset.type === "player";
  const accentText = color === "blue" ? "text-blue-400" : "text-orange-400";
  const accentBg = color === "blue" ? "bg-blue-500/5" : "bg-orange-500/5";

  return (
    <div className={`rounded-lg border border-border/50 ${accentBg} overflow-hidden`}>
      {/* Asset name row */}
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
            </div>
          </div>
        </div>
        <span className={`text-sm font-extrabold font-mono ${accentText}`}>
          {Math.round(finalValue).toLocaleString()}
        </span>
      </div>

      {/* Math breakdown */}
      {showMath && (
        <div className="border-t border-border/30 px-2.5 py-2 space-y-1.5 bg-background/30">
          {/* Base value step */}
          <MathStep
            label={isPlayer ? `ADP ${adpUsed}` : `Pick → ADP ${Math.round(adpUsed)}`}
            formula={`10,000 × (1/${Math.round(adpUsed)})^0.6`}
            result={Math.round(baseValue).toLocaleString()}
            annotation={
              isPlayer
                ? `Consensus ADP rank from FantasyPros [Ref 1]`
                : `Rd ${asset.pickRound} mid-pick (${Math.round(adpUsed - KEEPER_OFFSET)}) + ${KEEPER_OFFSET} keeper offset [Ref 5]`
            }
          />

          {/* Factor steps */}
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
        </div>
      )}
    </div>
  );
}

function MathStep({
  label,
  formula,
  result,
  annotation,
  isModifier,
}: {
  label: string;
  formula: string;
  result: string;
  annotation: string;
  isModifier?: boolean;
}) {
  return (
    <div className="relative">
      <div className="flex items-center gap-2 text-[10px]">
        {/* Arrow connector */}
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

function RefItem({ number, source, detail }: { number: number; source: string; detail: string }) {
  return (
    <div className="flex gap-2.5 items-start">
      <span className="text-[10px] font-mono font-bold text-muted-foreground bg-muted/40 rounded w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">
        {number}
      </span>
      <div>
        <span className="text-xs font-semibold text-foreground">{source}</span>
        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">{detail}</p>
      </div>
    </div>
  );
}
