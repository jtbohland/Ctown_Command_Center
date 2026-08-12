import { useState, useCallback, useMemo } from "react";
import { useApi } from "@/hooks/useApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import {
  calcPlayerValue,
  calcPickValue,
  getVerdict,
  SEVERITY_COLORS,
  type VerdictSeverity,
  type TeamValuationResult,
} from "@/lib/trade-utils";
import { type TradeModifiers, DEFAULT_MODIFIERS } from "@/lib/trade-modifiers";

import TradeResults from "./TradeResults";
import ThreeTeamDealResults from "./ThreeTeamDealResults";
import ModelCustomizer from "./ModelCustomizer";
import FormulaDeepDive from "./FormulaDeepDive";

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
  /** For 3-team trades: which team receives this asset */
  recipientSide?: "A" | "B" | "C";
};

interface Props {
  players: Player[];
  teams: Team[];
  draftCapital: DraftCapitalRow[];
}

export default function TradeBuilder({ players, teams, draftCapital }: Props) {
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [teamCId, setTeamCId] = useState<number | null>(null);
  const [teamAGives, setTeamAGives] = useState<Asset[]>([]);
  const [teamBGives, setTeamBGives] = useState<Asset[]>([]);
  const [teamCGives, setTeamCGives] = useState<Asset[]>([]);
  const [wildCardEnabled, setWildCardEnabled] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [threeTeamResult, setThreeTeamResult] = useState<ThreeTeamDealResult | null>(null);
  const [modifiers, setModifiers] = useState<TradeModifiers>({ ...DEFAULT_MODIFIERS });

  const { run: evaluateTrade, loading: evaluating } = useApi("EvaluateTrade");
  const [evaluating3, setEvaluating3] = useState(false);

  const getTeamPicks = useCallback(
    (teamId: number) => draftCapital.filter((dc) => dc.current_team_id === teamId),
    [draftCapital]
  );

  const handleAddPlayer = useCallback(
    (side: "A" | "B" | "C", playerId: string) => {
      const player = players.find((p) => p.id === Number(playerId));
      if (!player) return;
      const asset: Asset = {
        type: "player",
        playerName: player.name,
        playerPosition: player.position,
        playerAdp: player.adp_rank,
      };
      if (side === "A") setTeamAGives((prev) => [...prev, asset]);
      else if (side === "B") setTeamBGives((prev) => [...prev, asset]);
      else setTeamCGives((prev) => [...prev, asset]);
    },
    [players]
  );

  const handleAddPick = useCallback(
    (side: "A" | "B" | "C", pickKey: string) => {
      const [yearStr, roundStr] = pickKey.split("-");
      const asset: Asset = {
        type: "pick",
        pickYear: Number(yearStr),
        pickRound: Number(roundStr),
        pickNumber: null,
      };
      if (side === "A") setTeamAGives((prev) => [...prev, asset]);
      else if (side === "B") setTeamBGives((prev) => [...prev, asset]);
      else setTeamCGives((prev) => [...prev, asset]);
    },
    []
  );

  const handleRemoveAsset = useCallback((side: "A" | "B" | "C", index: number) => {
    if (side === "A") setTeamAGives((prev) => prev.filter((_, i) => i !== index));
    else if (side === "B") setTeamBGives((prev) => prev.filter((_, i) => i !== index));
    else setTeamCGives((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Set which team receives an asset in 3-team mode
  const handleSetRecipient = useCallback((side: "A" | "B" | "C", index: number, recipient: "A" | "B" | "C") => {
    const setter = side === "A" ? setTeamAGives : side === "B" ? setTeamBGives : setTeamCGives;
    setter((prev) => prev.map((a, i) => i === index ? { ...a, recipientSide: recipient } : a));
  }, []);

  // ── Two-team evaluate (existing API) ──
  const handleEvaluate2Team = useCallback(async () => {
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
      setThreeTeamResult(null);
    } catch (err) {
      const message = err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
      toast.error("Evaluation failed: " + message);
    }
  }, [teamAId, teamBId, teamAGives, teamBGives, modifiers, evaluateTrade]);

  // ── Three-team evaluate (client-side) ──
  const handleEvaluate3Team = useCallback(() => {
    if (!teamAId || !teamBId || !teamCId) {
      toast.error("Select all three teams!");
      return;
    }
    const allAssets = [
      ...teamAGives.map((a) => ({ ...a, fromSide: "A" as const })),
      ...teamBGives.map((a) => ({ ...a, fromSide: "B" as const })),
      ...teamCGives.map((a) => ({ ...a, fromSide: "C" as const })),
    ];
    if (allAssets.length === 0) {
      toast.error("Add assets to at least one side");
      return;
    }
    // Check every asset has a recipient assigned
    const unassigned = allAssets.filter((a) => !a.recipientSide);
    if (unassigned.length > 0) {
      toast.error(`${unassigned.length} asset(s) need a recipient! Use the → dropdown on each asset.`);
      return;
    }

    setEvaluating3(true);

    const sideToId = { A: teamAId, B: teamBId, C: teamCId };
    const teamA = teams.find((t) => t.id === teamAId);
    const teamB = teams.find((t) => t.id === teamBId);
    const teamC = teams.find((t) => t.id === teamCId);
    const sideToName = {
      A: teamA?.team_name ?? "Home",
      B: teamB?.team_name ?? "Away",
      C: teamC?.team_name ?? "Wild Card",
    };

    // Compute value per asset
    function assetValue(a: Asset): number {
      if (a.type === "player") {
        const adp = a.playerAdp ?? null;
        return adp ? calcPlayerValue(adp) : 0;
      }
      const year = a.pickYear ?? 2026;
      const round = a.pickRound ?? 6;
      return calcPickValue(round, year, a.pickNumber ?? undefined);
    }

    // Accumulate sent/received per side
    const sent: Record<string, number> = { A: 0, B: 0, C: 0 };
    const received: Record<string, number> = { A: 0, B: 0, C: 0 };
    const assetDetails: { name: string; value: number; fromSide: string; toSide: string }[] = [];

    for (const asset of allAssets) {
      const val = assetValue(asset);
      const from = asset.fromSide;
      const to = asset.recipientSide!;
      sent[from] += val;
      received[to] += val;
      const name = asset.type === "player"
        ? (asset.playerName ?? "Unknown")
        : `${asset.pickYear} Rd ${asset.pickRound}`;
      assetDetails.push({ name, value: val, fromSide: from, toSide: to });
    }

    // Build team results
    const teamResults: TeamValuationResult[] = (["A", "B", "C"] as const).map((side) => ({
      teamId: sideToId[side],
      teamName: sideToName[side],
      sentValue: sent[side],
      receivedValue: received[side],
      netValue: received[side] - sent[side],
      rank: 0,
    }));
    teamResults.sort((a, b) => b.netValue - a.netValue);
    teamResults.forEach((r, i) => { r.rank = i + 1; });

    const winner = teamResults[0];
    const totalValueMoved = sent.A + sent.B + sent.C;
    const spreadPct = totalValueMoved > 0
      ? Math.round(((winner.netValue - teamResults[2].netValue) / totalValueMoved) * 100 * 10) / 10
      : 0;
    const verdict = getVerdict(spreadPct);

    setThreeTeamResult({
      teams: teamResults as [TeamValuationResult, TeamValuationResult, TeamValuationResult],
      winner,
      winnerMarginOverSecond: winner.netValue - teamResults[1].netValue,
      conservationCheck: teamResults.reduce((s, r) => s + r.netValue, 0),
      verdict,
      assetDetails,
      teamColors: {
        [sideToId.A]: teamA?.color ?? "#3b82f6",
        [sideToId.B]: teamB?.color ?? "#ef4444",
        [sideToId.C]: teamC?.color ?? "#a855f7",
      },
      sideNames: {
        A: sideToName.A,
        B: sideToName.B,
        C: sideToName.C,
      },
    });
    setResult(null);
    setEvaluating3(false);
  }, [teamAId, teamBId, teamCId, teamAGives, teamBGives, teamCGives, teams]);

  const handleReset = useCallback(() => {
    setTeamAGives([]);
    setTeamBGives([]);
    setTeamCGives([]);
    setResult(null);
    setThreeTeamResult(null);
  }, []);

  const handleToggleWildCard = useCallback(() => {
    setWildCardEnabled((prev) => {
      if (prev) {
        // Removing wild card — clear team C state
        setTeamCId(null);
        setTeamCGives([]);
        setResult(null);
        setThreeTeamResult(null);
        // Clear recipient assignments from A and B assets
        setTeamAGives((a) => a.map((asset) => ({ ...asset, recipientSide: undefined })));
        setTeamBGives((a) => a.map((asset) => ({ ...asset, recipientSide: undefined })));
      }
      return !prev;
    });
  }, []);

  const teamA = teams.find((t) => t.id === teamAId);
  const teamB = teams.find((t) => t.id === teamBId);
  const teamC = teams.find((t) => t.id === teamCId);
  const teamAName = teamA?.team_name ?? "Team A";
  const teamBName = teamB?.team_name ?? "Team B";
  const teamCName = teamC?.team_name ?? "Wild Card";

  // Teams already selected (for filtering dropdowns)
  const selectedTeamIds = useMemo(() => {
    const ids = new Set<number>();
    if (teamAId) ids.add(teamAId);
    if (teamBId) ids.add(teamBId);
    if (teamCId) ids.add(teamCId);
    return ids;
  }, [teamAId, teamBId, teamCId]);

  // Side labels for recipient dropdowns
  const sideLabels = useMemo(() => {
    const labels: { side: "A" | "B" | "C"; emoji: string; name: string }[] = [
      { side: "A", emoji: getTeamEmoji(teamAName), name: teamAName },
      { side: "B", emoji: getTeamEmoji(teamBName), name: teamBName },
    ];
    if (wildCardEnabled) {
      labels.push({ side: "C", emoji: getTeamEmoji(teamCName), name: teamCName });
    }
    return labels;
  }, [teamAName, teamBName, teamCName, wildCardEnabled]);

  const canEvaluate = wildCardEnabled
    ? teamAId != null && teamBId != null && teamCId != null && (teamAGives.length + teamBGives.length + teamCGives.length) > 0
    : teamAId != null && teamBId != null && teamAGives.length > 0 && teamBGives.length > 0;

  return (
    <div className="space-y-4">
      {/* Wild Card Toggle */}
      <div className="flex items-center justify-end">
        <button
          onClick={handleToggleWildCard}
          className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border transition-all ${
            wildCardEnabled
              ? "bg-purple-500/20 text-purple-400 border-purple-500/40 shadow-[0_0_12px_rgba(168,85,247,0.15)]"
              : "bg-muted/30 text-muted-foreground border-border/40 hover:border-purple-500/30 hover:text-purple-400"
          }`}
        >
          🎰 {wildCardEnabled ? "Remove The Wild Card" : "Add The Wild Card"}
        </button>
      </div>

      {/* Team Selectors */}
      <div className={`grid gap-4 ${wildCardEnabled ? "grid-cols-3" : "grid-cols-2"}`}>
        <TeamSelector
          label="🏠 HOME SIDE"
          team={teamA}
          teams={teams.filter((t) => !selectedTeamIds.has(t.id) || t.id === teamAId)}
          onSelect={(id) => { setTeamAId(id); setTeamAGives([]); setResult(null); setThreeTeamResult(null); }}
          accentClass="from-blue-600/20 to-blue-900/10"
          borderClass="border-blue-500/40"
        />
        <TeamSelector
          label="🏟️ AWAY SIDE"
          team={teamB}
          teams={teams.filter((t) => !selectedTeamIds.has(t.id) || t.id === teamBId)}
          onSelect={(id) => { setTeamBId(id); setTeamBGives([]); setResult(null); setThreeTeamResult(null); }}
          accentClass="from-red-600/20 to-red-900/10"
          borderClass="border-red-500/40"
        />
        {wildCardEnabled && (
          <TeamSelector
            label="🎰 THE WILD CARD"
            team={teamC}
            teams={teams.filter((t) => !selectedTeamIds.has(t.id) || t.id === teamCId)}
            onSelect={(id) => { setTeamCId(id); setTeamCGives([]); setResult(null); setThreeTeamResult(null); }}
            accentClass="from-purple-600/20 to-purple-900/10"
            borderClass="border-purple-500/40"
          />
        )}
      </div>

      {/* Trade Panels */}
      <div className={`grid gap-4 ${wildCardEnabled ? "grid-cols-3" : "grid-cols-2"}`}>
        <TradeSidePanel
          side="A"
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
          showRecipient={wildCardEnabled}
          sideLabels={sideLabels.filter((l) => l.side !== "A")}
          onSetRecipient={(idx, r) => handleSetRecipient("A", idx, r)}
        />
        <TradeSidePanel
          side="B"
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
          showRecipient={wildCardEnabled}
          sideLabels={sideLabels.filter((l) => l.side !== "B")}
          onSetRecipient={(idx, r) => handleSetRecipient("B", idx, r)}
        />
        {wildCardEnabled && (
          <TradeSidePanel
            side="C"
            label={`${getTeamEmoji(teamCName)} ${teamCName} Sends`}
            assets={teamCGives}
            players={players}
            picks={teamCId ? getTeamPicks(teamCId) : []}
            onAddPlayer={(id) => handleAddPlayer("C", id)}
            onAddPick={(key) => handleAddPick("C", key)}
            onRemove={(idx) => handleRemoveAsset("C", idx)}
            accentColor={teamC?.color ?? "#a855f7"}
            gradientClass="from-purple-600/15 to-transparent"
            borderClass="border-purple-500/30"
            showRecipient={wildCardEnabled}
            sideLabels={sideLabels.filter((l) => l.side !== "C")}
            onSetRecipient={(idx, r) => handleSetRecipient("C", idx, r)}
          />
        )}
      </div>

      {/* Evaluate + Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={wildCardEnabled ? handleEvaluate3Team : handleEvaluate2Team}
          disabled={(wildCardEnabled ? evaluating3 : evaluating) || !canEvaluate}
          size="lg"
          className={`flex-1 text-white font-bold text-base h-12 shadow-lg ${
            wildCardEnabled
              ? "bg-gradient-to-r from-blue-600 via-purple-600 to-red-600 hover:from-blue-500 hover:via-purple-500 hover:to-red-500"
              : "bg-gradient-to-r from-blue-600 to-red-600 hover:from-blue-500 hover:to-red-500"
          }`}
        >
          {(wildCardEnabled ? evaluating3 : evaluating) ? (
            <span className="animate-pulse">⏳ Crunching Numbers...</span>
          ) : (
            <>⚖️ Evaluate {wildCardEnabled ? "3-Way " : ""}Trade</>
          )}
        </Button>
        <Button variant="outline" onClick={handleReset} size="lg" className="h-12">
          🔄 Reset
        </Button>
      </div>

      {/* Model Customizer — collapsible */}
      <ModelCustomizer modifiers={modifiers} onChange={setModifiers} />

      {/* Formula Deep Dive — collapsible */}
      <details className="group rounded-xl border border-border/50 bg-muted/10 overflow-hidden">
        <summary className="flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none hover:bg-muted/20 transition-colors list-none">
          <span className="text-base">📐</span>
          <span className="text-xs font-bold text-muted-foreground">How the Formula Works</span>
          <span className="ml-auto text-[10px] text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
        </summary>
        <div className="border-t border-border/30">
          <FormulaDeepDive />
        </div>
      </details>

      {/* Two-team Results */}
      {result && !wildCardEnabled && (
        <TradeResults
          result={result}
          teamAName={teamAName}
          teamBName={teamBName}
          teamAColor={teamA?.color}
          teamBColor={teamB?.color}
        />
      )}

      {/* Three-team Results */}
      {threeTeamResult && wildCardEnabled && (
        <ThreeTeamDealResults result={threeTeamResult} />
      )}
    </div>
  );
}

// ─── Three-Team Deal Result Type ────────────────────────────
export interface ThreeTeamDealResult {
  teams: [TeamValuationResult, TeamValuationResult, TeamValuationResult];
  winner: TeamValuationResult;
  winnerMarginOverSecond: number;
  conservationCheck: number;
  verdict: { label: string; emoji: string; severity: string };
  assetDetails: { name: string; value: number; fromSide: string; toSide: string }[];
  teamColors: Record<number, string>;
  sideNames: Record<string, string>;
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
  side: "A" | "B" | "C";
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
  showRecipient?: boolean;
  sideLabels?: { side: "A" | "B" | "C"; emoji: string; name: string }[];
  onSetRecipient?: (index: number, recipient: "A" | "B" | "C") => void;
}

function TradeSidePanel({
  side,
  label,
  assets,
  players,
  picks,
  onAddPlayer,
  onAddPick,
  onRemove,
  accentColor,
  gradientClass,
  borderClass,
  showRecipient,
  sideLabels,
  onSetRecipient,
}: SidePanelProps) {
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
          <div key={i} className="flex items-center gap-1.5 bg-background/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 text-xs border border-border/50 group">
            {asset.type === "player" ? (
              <Badge className={`text-[10px] px-1.5 py-0 ${POSITION_BG_CLASSES[asset.playerPosition ?? ""] ?? "bg-muted"}`}>
                {asset.playerPosition}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">
                📋
              </Badge>
            )}
            <span className="flex-1 truncate font-medium min-w-0">
              {asset.type === "player"
                ? asset.playerName
                : `${asset.pickYear} Rd ${asset.pickRound}`}
            </span>
            {/* Recipient selector for 3-team mode */}
            {showRecipient && sideLabels && onSetRecipient && (
              <Select
                value={asset.recipientSide ?? ""}
                onValueChange={(v) => onSetRecipient(i, v as "A" | "B" | "C")}
              >
                <SelectTrigger className="h-6 w-24 text-[10px] px-1.5 py-0 bg-muted/50 border-border/50 shrink-0">
                  <SelectValue placeholder="→ To..." />
                </SelectTrigger>
                <SelectContent>
                  {sideLabels.map((sl) => (
                    <SelectItem key={sl.side} value={sl.side} className="text-[11px]">
                      {sl.emoji} {sl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <button
              onClick={() => onRemove(i)}
              className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
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
