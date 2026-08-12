import { useState, useCallback, useMemo } from "react";
import { useApi } from "@/hooks/useApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import { SEVERITY_COLORS, type VerdictSeverity } from "@/lib/trade-utils";
import { type TradeModifiers, DEFAULT_MODIFIERS } from "@/lib/trade-modifiers";

import TradeResults from "./TradeResults";
import ModelCustomizer from "./ModelCustomizer";

type Player = { id: number; name: string; position: string; nfl_team: string; adp_rank: number | null };
type Team = { id: number; team_name: string; manager_name: string; color: string };
type DraftCapitalRow = { id: number; year: number; round: number; original_team_id: number; current_team_id: number; original_team_name: string; current_team_name: string };

type Asset = {
  type: "player" | "pick";
  playerName?: string;
  playerPosition?: string;
  playerAdp?: number | null;
  pickYear?: number;
  pickRound?: number;
  pickNumber?: number | null;
};

interface Props {
  players: Player[];
  teams: Team[];
  draftCapital: DraftCapitalRow[];
}

export default function TradeBuilder({ players, teams, draftCapital }: Props) {
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [teamAGives, setTeamAGives] = useState<Asset[]>([]);
  const [teamBGives, setTeamBGives] = useState<Asset[]>([]);
  const [result, setResult] = useState<any>(null);
  const [modifiers, setModifiers] = useState<TradeModifiers>({ ...DEFAULT_MODIFIERS });

  const { run: evaluateTrade, loading: evaluating } = useApi("EvaluateTrade");

  const getTeamPicks = useCallback(
    (teamId: number) => draftCapital.filter((dc) => dc.current_team_id === teamId),
    [draftCapital]
  );

  const handleAddPlayer = useCallback(
    (side: "A" | "B", playerId: string) => {
      const player = players.find((p) => p.id === Number(playerId));
      if (!player) return;
      const asset: Asset = {
        type: "player",
        playerName: player.name,
        playerPosition: player.position,
        playerAdp: player.adp_rank,
      };
      if (side === "A") setTeamAGives((prev) => [...prev, asset]);
      else setTeamBGives((prev) => [...prev, asset]);
    },
    [players]
  );

  const handleAddPick = useCallback(
    (side: "A" | "B", pickKey: string) => {
      const [yearStr, roundStr] = pickKey.split("-");
      const asset: Asset = {
        type: "pick",
        pickYear: Number(yearStr),
        pickRound: Number(roundStr),
        pickNumber: null,
      };
      if (side === "A") setTeamAGives((prev) => [...prev, asset]);
      else setTeamBGives((prev) => [...prev, asset]);
    },
    []
  );

  const handleRemoveAsset = useCallback((side: "A" | "B", index: number) => {
    if (side === "A") setTeamAGives((prev) => prev.filter((_, i) => i !== index));
    else setTeamBGives((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleEvaluate = useCallback(async () => {
    if (!teamAId || !teamBId) {
      toast.error("Select both teams first!");
      return;
    }
    if (teamAGives.length === 0 || teamBGives.length === 0) {
      toast.error("Both sides need at least one asset");
      return;
    }
    try {
      const res = await evaluateTrade({
        teamAId,
        teamBId,
        teamAGives: teamAGives.map((a) => ({
          type: a.type,
          playerName: a.playerName ?? null,
          playerPosition: a.playerPosition ?? null,
          playerAdp: a.playerAdp ?? null,
          pickYear: a.pickYear ?? null,
          pickRound: a.pickRound ?? null,
          pickNumber: a.pickNumber ?? null,
        })),
        teamBGives: teamBGives.map((a) => ({
          type: a.type,
          playerName: a.playerName ?? null,
          playerPosition: a.playerPosition ?? null,
          playerAdp: a.playerAdp ?? null,
          pickYear: a.pickYear ?? null,
          pickRound: a.pickRound ?? null,
          pickNumber: a.pickNumber ?? null,
        })),
        modifiers,
      });
      setResult(res);
    } catch (err) {
      const message = err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
      toast.error("Evaluation failed: " + message);
    }
  }, [teamAId, teamBId, teamAGives, teamBGives, modifiers, evaluateTrade]);

  const handleReset = useCallback(() => {
    setTeamAGives([]);
    setTeamBGives([]);
    setResult(null);
  }, []);

  const teamA = teams.find((t) => t.id === teamAId);
  const teamB = teams.find((t) => t.id === teamBId);
  const teamAName = teamA?.team_name ?? "Team A";
  const teamBName = teamB?.team_name ?? "Team B";

  return (
    <div className="space-y-4">
      {/* Team Selectors — side by side with team colors */}
      <div className="grid grid-cols-2 gap-4">
        <TeamSelector
          label="🏠 HOME SIDE"
          team={teamA}
          teams={teams}
          onSelect={(id) => { setTeamAId(id); setTeamAGives([]); setResult(null); }}
          accentClass="from-blue-600/20 to-blue-900/10"
          borderClass="border-blue-500/40"
        />
        <TeamSelector
          label="🏟️ AWAY SIDE"
          team={teamB}
          teams={teams}
          onSelect={(id) => { setTeamBId(id); setTeamBGives([]); setResult(null); }}
          accentClass="from-red-600/20 to-red-900/10"
          borderClass="border-red-500/40"
        />
      </div>

      {/* Trade Panels — vivid colors */}
      <div className="grid grid-cols-2 gap-4">
        <TradeSidePanel
          label={`${getTeamEmoji(teamAName)} ${teamAName} Sends`}
          assets={teamAGives}
          players={players}
          picks={teamAId ? getTeamPicks(teamAId) : []}
          onAddPlayer={(id) => handleAddPlayer("A", id)}
          onAddPick={(key) => handleAddPick("A", key)}
          onRemove={(idx) => handleRemoveAsset("A", idx)}
          accentColor={teamA?.color ?? "#3b82f6"}
          gradientClass="from-blue-600/15 to-transparent"
          borderClass="border-blue-500/30"
        />
        <TradeSidePanel
          label={`${getTeamEmoji(teamBName)} ${teamBName} Sends`}
          assets={teamBGives}
          players={players}
          picks={teamBId ? getTeamPicks(teamBId) : []}
          onAddPlayer={(id) => handleAddPlayer("B", id)}
          onAddPick={(key) => handleAddPick("B", key)}
          onRemove={(idx) => handleRemoveAsset("B", idx)}
          accentColor={teamB?.color ?? "#ef4444"}
          gradientClass="from-red-600/15 to-transparent"
          borderClass="border-red-500/30"
        />
      </div>

      {/* Swap Arrow + Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleEvaluate}
          disabled={evaluating || !teamAId || !teamBId || teamAGives.length === 0 || teamBGives.length === 0}
          size="lg"
          className="flex-1 bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-500 hover:to-red-500 text-white font-bold text-base h-12 shadow-lg"
        >
          {evaluating ? (
            <span className="animate-pulse">⏳ Crunching Numbers...</span>
          ) : (
            <>⚖️ Evaluate Trade</>
          )}
        </Button>
        <Button variant="outline" onClick={handleReset} size="lg" className="h-12">
          🔄 Reset
        </Button>
      </div>

      {/* Model Customizer — collapsible */}
      <ModelCustomizer modifiers={modifiers} onChange={setModifiers} />

      {/* Formula Explainer — collapsible, open by default */}
      <details open className="group rounded-xl border border-border/50 bg-muted/10 overflow-hidden">
        <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none hover:bg-muted/20 transition-colors list-none">
          <span className="text-base">📐</span>
          <span className="text-xs font-bold text-muted-foreground">How the Formula Works</span>
          <span className="ml-auto text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="px-4 pb-4 pt-2 space-y-3 text-xs text-muted-foreground border-t border-border/30">
          <p>
            Every player and pick is assigned a <span className="font-semibold text-foreground">point value</span> based on their
            ADP (Average Draft Position) at the time of the trade. Earlier ADP = more valuable.
          </p>
          <div className="rounded-lg bg-background/60 border border-border/40 p-3 font-mono text-[10px] space-y-1.5">
            <div><span className="text-blue-400">Player value</span> = 10,000 × (1 / ADP)^0.6</div>
            <div><span className="text-amber-400">Pick value</span> = 10,000 × (1 / effective ADP)^0.6 × year discount</div>
            <div className="border-t border-border/20 pt-1.5">
              <span className="text-emerald-400">Keeper offset:</span> 11 teams × 4 keepers = <span className="text-foreground font-bold">44</span>
            </div>
            <div><span className="text-muted-foreground">Pick 1.01 → ADP 45 · Pick 2.01 → ADP 56 · Pick 3.01 → ADP 67</span></div>
            <div><span className="text-muted-foreground">Year discount: 2026 → 1.0× · 2027 → 0.8× · 2028 → 0.65×</span></div>
          </div>
          <div className="rounded-lg bg-background/60 border border-border/40 p-3 space-y-1.5 text-[10px] font-mono">
            <div className="text-[11px] font-sans font-bold text-foreground mb-1">🏈 Dynasty Multipliers</div>
            <div><span className="text-purple-400">Rookie premium:</span> 1.10× — top-50 NFL pick in their draft year</div>
            <div><span className="text-pink-400">Positional scarcity:</span> 1.08× — top-5 QB or TE by ADP</div>
            <div><span className="text-cyan-400">Age curve:</span> ≤24 → 1.06× · 25-27 → 1.03× · 28-29 → 1.00× · 30-31 → 0.95× · 32+ → 0.90×</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { emoji: "🧤", label: "Fair Catch", desc: "Within 5% — both sides happy" },
              { emoji: "📈", label: "Edge Rush", desc: "5–15% gap — one side wins" },
              { emoji: "🏆", label: "Pick Six", desc: "15–25% gap — significant advantage" },
              { emoji: "🚩", label: "Flag on the Play", desc: "25%+ gap — someone got fleeced" },
            ].map((v) => (
              <div key={v.label} className="flex items-start gap-1.5 bg-muted/20 rounded-lg px-2.5 py-2">
                <span className="text-base leading-none">{v.emoji}</span>
                <div>
                  <div className="font-semibold text-foreground">{v.label}</div>
                  <div className="text-[10px]">{v.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>

      {/* Results */}
      {result && (
        <TradeResults
          result={result}
          teamAName={teamAName}
          teamBName={teamBName}
          teamAColor={teamA?.color}
          teamBColor={teamB?.color}
        />
      )}
    </div>
  );
}

// ─── Team Selector ──────────────────────────────────────────
function TeamSelector({
  label,
  team,
  teams,
  onSelect,
  accentClass,
  borderClass,
}: {
  label: string;
  team: Team | undefined;
  teams: Team[];
  onSelect: (id: number) => void;
  accentClass: string;
  borderClass: string;
}) {
  return (
    <div className={`rounded-xl border ${borderClass} bg-gradient-to-b ${accentClass} p-3`}>
      <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1.5 uppercase">{label}</div>
      <Select value={team?.id?.toString() ?? ""} onValueChange={(v) => onSelect(Number(v))}>
        <SelectTrigger className="w-full h-10 text-sm font-medium">
          <SelectValue placeholder="Select team..." />
        </SelectTrigger>
        <SelectContent>
          {teams.map((t) => (
            <SelectItem key={t.id} value={t.id.toString()}>
              {getTeamEmoji(t.team_name)} {t.team_name} ({t.manager_name})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {team && (
        <div className="mt-1.5 text-center">
          <span className="text-2xl">{getTeamEmoji(team.team_name)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Trade Side Panel ───────────────────────────────────────
interface SidePanelProps {
  label: string;
  assets: Asset[];
  players: Player[];
  picks: { year: number; round: number; original_team_name: string }[];
  onAddPlayer: (playerId: string) => void;
  onAddPick: (pickKey: string) => void;
  onRemove: (index: number) => void;
  accentColor: string;
  gradientClass: string;
  borderClass: string;
}

function TradeSidePanel({ label, assets, players, picks, onAddPlayer, onAddPick, onRemove, accentColor, gradientClass, borderClass }: SidePanelProps) {
  return (
    <div
      className={`rounded-xl border-2 ${borderClass} bg-gradient-to-b ${gradientClass} p-4 space-y-3`}
      style={{ borderTopColor: accentColor, borderTopWidth: 4 }}
    >
      <h3 className="text-sm font-bold flex items-center gap-1.5">
        <span>{label}</span>
        <Badge variant="secondary" className="text-[10px] ml-auto">{assets.length} item{assets.length !== 1 ? "s" : ""}</Badge>
      </h3>

      {/* Asset list */}
      <div className="space-y-1.5 min-h-[80px]">
        {assets.length === 0 && (
          <div className="flex items-center justify-center h-[80px] border border-dashed border-muted-foreground/30 rounded-lg">
            <p className="text-xs text-muted-foreground italic">Drop players & picks here 👇</p>
          </div>
        )}
        {assets.map((asset, i) => (
          <div key={i} className="flex items-center gap-2 bg-background/60 backdrop-blur-sm rounded-lg px-3 py-2 text-xs border border-border/50 group">
            {asset.type === "player" ? (
              <Badge className={`text-[10px] px-1.5 py-0 ${POSITION_BG_CLASSES[asset.playerPosition ?? ""] ?? "bg-muted"}`}>
                {asset.playerPosition}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">
                📋
              </Badge>
            )}
            <span className="flex-1 truncate font-medium">
              {asset.type === "player"
                ? asset.playerName
                : `${asset.pickYear} Round ${asset.pickRound}`}
            </span>
            {asset.type === "player" && asset.playerAdp && (
              <span className="text-[10px] text-muted-foreground font-mono">ADP {asset.playerAdp}</span>
            )}
            <button
              onClick={() => onRemove(i)}
              className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Icon icon="x" className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Add dropdowns */}
      <div className="space-y-2">
        <Select onValueChange={onAddPlayer} value="">
          <SelectTrigger className="h-8 text-xs bg-background/50">
            <SelectValue placeholder="➕ Add player..." />
          </SelectTrigger>
          <SelectContent>
            {players.slice(0, 150).map((p) => (
              <SelectItem key={p.id} value={p.id.toString()}>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground ml-1">({p.position})</span>
                {p.adp_rank ? <span className="text-muted-foreground ml-1">ADP {p.adp_rank}</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={onAddPick} value="">
          <SelectTrigger className="h-8 text-xs bg-background/50">
            <SelectValue placeholder="➕ Add draft pick..." />
          </SelectTrigger>
          <SelectContent>
            {picks.length > 0 && (
              <>
                {picks.map((p, i) => (
                  <SelectItem key={`own-${i}`} value={`${p.year}-${p.round}`}>
                    🎯 {p.year} Rd {p.round} (from {p.original_team_name.split(" ")[0]})
                  </SelectItem>
                ))}
              </>
            )}
            {[2026, 2027, 2028].map((year) =>
              [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((round) => (
                <SelectItem key={`gen-${year}-${round}`} value={`${year}-${round}`}>
                  {year} Round {round}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
