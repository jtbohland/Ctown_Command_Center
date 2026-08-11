import { useState, useCallback } from "react";
import { useApi } from "@/hooks/useApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import type { TeamRow, PlayerRow, DraftCapitalRow } from "@/lib/trade-utils";

interface Asset {
  type: "player" | "pick";
  playerName: string | null;
  playerPosition: string | null;
  pickYear: number | null;
  pickRound: number | null;
  pickNumber: number | null;
  fromTeamId: number;
}

interface Props {
  teams: TeamRow[];
  players: PlayerRow[];
  draftCapital: DraftCapitalRow[];
  onSaved: () => void;
}

export default function SirenSale({ teams, players, draftCapital, onSaved }: Props) {
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [season, setSeason] = useState<string>("2025-26");
  const [period, setPeriod] = useState<string>("off-season");
  const [teamAAssets, setTeamAAssets] = useState<Asset[]>([]);
  const [teamBAssets, setTeamBAssets] = useState<Asset[]>([]);
  const [recentSaves, setRecentSaves] = useState<{ tradeNumber: number; teamA: string; teamB: string }[]>([]);

  const { run: saveTrade, loading: saving } = useApi("SaveTrade");

  const addPlayerToSide = useCallback(
    (side: "A" | "B", playerId: string) => {
      const player = players.find((p) => p.id === Number(playerId));
      if (!player) return;
      const teamId = side === "A" ? teamAId : teamBId;
      if (!teamId) return;
      const asset: Asset = {
        type: "player",
        playerName: player.name,
        playerPosition: player.position,
        pickYear: null,
        pickRound: null,
        pickNumber: null,
        fromTeamId: teamId,
      };
      if (side === "A") setTeamAAssets((prev) => [...prev, asset]);
      else setTeamBAssets((prev) => [...prev, asset]);
    },
    [players, teamAId, teamBId]
  );

  const addPickToSide = useCallback(
    (side: "A" | "B", pickKey: string) => {
      const [yearStr, roundStr] = pickKey.split("-");
      const teamId = side === "A" ? teamAId : teamBId;
      if (!teamId) return;
      const asset: Asset = {
        type: "pick",
        playerName: null,
        playerPosition: null,
        pickYear: Number(yearStr),
        pickRound: Number(roundStr),
        pickNumber: null,
        fromTeamId: teamId,
      };
      if (side === "A") setTeamAAssets((prev) => [...prev, asset]);
      else setTeamBAssets((prev) => [...prev, asset]);
    },
    [teamAId, teamBId]
  );

  const removeAsset = useCallback((side: "A" | "B", index: number) => {
    if (side === "A") setTeamAAssets((prev) => prev.filter((_, i) => i !== index));
    else setTeamBAssets((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSave = useCallback(async () => {
    if (!teamAId || !teamBId) {
      toast.error("Select both teams");
      return;
    }
    if (teamAAssets.length === 0 || teamBAssets.length === 0) {
      toast.error("Both sides need at least one asset");
      return;
    }
    try {
      const res = await saveTrade({
        teamAId,
        teamBId,
        season,
        period,
        assets: [...teamAAssets, ...teamBAssets],
      });
      toast.success(`🚨 ${res?.message ?? "Trade saved!"}`);
      setRecentSaves((prev) => [
        { tradeNumber: res?.tradeNumber ?? 0, teamA: teams.find((t) => t.id === teamAId)?.team_name ?? "", teamB: teams.find((t) => t.id === teamBId)?.team_name ?? "" },
        ...prev,
      ]);
      // Reset form
      setTeamAAssets([]);
      setTeamBAssets([]);
      onSaved();
    } catch (err) {
      const message = err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
      toast.error("Save failed: " + message);
    }
  }, [teamAId, teamBId, season, period, teamAAssets, teamBAssets, saveTrade, teams, onSaved]);

  const teamA = teams.find((t) => t.id === teamAId);
  const teamB = teams.find((t) => t.id === teamBId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-red-500/30 bg-gradient-to-r from-red-600/10 via-orange-600/5 to-red-600/10 p-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🚨</span>
          <div>
            <h3 className="text-base font-bold text-red-400">Siren Sale</h3>
            <p className="text-xs text-muted-foreground">Log trades happening around the league that you're not involved in</p>
          </div>
        </div>
      </div>

      {/* Config Row */}
      <div className="flex items-center gap-3">
        <Select value={season} onValueChange={setSeason}>
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2025-26">2025-26</SelectItem>
            <SelectItem value="2024-25">2024-25</SelectItem>
          </SelectContent>
        </Select>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="in-season">In-Season</SelectItem>
            <SelectItem value="off-season">Off-Season</SelectItem>
            <SelectItem value="draft-day">Draft Day</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Team Selectors */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-orange-500/30 bg-gradient-to-b from-orange-600/10 to-transparent p-3">
          <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1.5 uppercase">🏠 Side A</div>
          <Select value={teamAId?.toString() ?? ""} onValueChange={(v) => { setTeamAId(Number(v)); setTeamAAssets([]); }}>
            <SelectTrigger className="w-full h-9 text-sm">
              <SelectValue placeholder="Select team..." />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id.toString()}>
                  {getTeamEmoji(t.team_name)} {t.team_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-xl border border-orange-500/30 bg-gradient-to-b from-orange-600/10 to-transparent p-3">
          <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1.5 uppercase">🏟️ Side B</div>
          <Select value={teamBId?.toString() ?? ""} onValueChange={(v) => { setTeamBId(Number(v)); setTeamBAssets([]); }}>
            <SelectTrigger className="w-full h-9 text-sm">
              <SelectValue placeholder="Select team..." />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id.toString()}>
                  {getTeamEmoji(t.team_name)} {t.team_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Asset Panels */}
      <div className="grid grid-cols-2 gap-4">
        <AssetPanel
          label={teamA ? `${getTeamEmoji(teamA.team_name)} ${teamA.team_name} sends` : "Side A sends"}
          assets={teamAAssets}
          players={players}
          onAddPlayer={(id) => addPlayerToSide("A", id)}
          onAddPick={(key) => addPickToSide("A", key)}
          onRemove={(idx) => removeAsset("A", idx)}
          disabled={!teamAId}
        />
        <AssetPanel
          label={teamB ? `${getTeamEmoji(teamB.team_name)} ${teamB.team_name} sends` : "Side B sends"}
          assets={teamBAssets}
          players={players}
          onAddPlayer={(id) => addPlayerToSide("B", id)}
          onAddPick={(key) => addPickToSide("B", key)}
          onRemove={(idx) => removeAsset("B", idx)}
          disabled={!teamBId}
        />
      </div>

      {/* Save Button */}
      <Button
        onClick={handleSave}
        disabled={saving || !teamAId || !teamBId || teamAAssets.length === 0 || teamBAssets.length === 0}
        size="lg"
        className="w-full h-12 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-bold text-base shadow-lg"
      >
        {saving ? "⏳ Saving..." : "🚨 Log This Trade"}
      </Button>

      {/* Recent Saves */}
      {recentSaves.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <h4 className="text-xs font-bold text-emerald-400 mb-2">✅ Recently Logged</h4>
          <div className="space-y-1">
            {recentSaves.map((s, i) => (
              <div key={i} className="text-xs flex items-center gap-1.5">
                <span className="font-mono text-muted-foreground">#{s.tradeNumber}</span>
                <span>{getTeamEmoji(s.teamA)} {s.teamA.split(" ")[0]}</span>
                <span className="text-muted-foreground">↔</span>
                <span>{getTeamEmoji(s.teamB)} {s.teamB.split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Asset Panel ─────────────────────────────────────────────
function AssetPanel({
  label,
  assets,
  players,
  onAddPlayer,
  onAddPick,
  onRemove,
  disabled,
}: {
  label: string;
  assets: Asset[];
  players: PlayerRow[];
  onAddPlayer: (id: string) => void;
  onAddPick: (key: string) => void;
  onRemove: (idx: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-2">
      <h4 className="text-xs font-bold">{label}</h4>

      <div className="space-y-1 min-h-[60px]">
        {assets.length === 0 && (
          <div className="flex items-center justify-center h-[60px] border border-dashed border-muted-foreground/20 rounded">
            <p className="text-[10px] text-muted-foreground">{disabled ? "Select a team first" : "Add players & picks 👇"}</p>
          </div>
        )}
        {assets.map((a, i) => (
          <div key={i} className="flex items-center gap-1.5 bg-muted/30 rounded px-2 py-1.5 text-xs group">
            {a.type === "player" ? (
              <Badge className={`text-[9px] px-1 py-0 ${POSITION_BG_CLASSES[a.playerPosition ?? ""] ?? "bg-muted"}`}>
                {a.playerPosition}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] px-1 py-0 bg-amber-500/10 border-amber-500/30 text-amber-400">📋</Badge>
            )}
            <span className="flex-1 truncate">{a.type === "player" ? a.playerName : `${a.pickYear} Rd ${a.pickRound}`}</span>
            <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100">
              <Icon icon="x" className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <Select onValueChange={onAddPlayer} value="" disabled={disabled}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="➕ Add player..." />
        </SelectTrigger>
        <SelectContent>
          {players.slice(0, 150).map((p) => (
            <SelectItem key={p.id} value={p.id.toString()}>
              {p.name} ({p.position})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select onValueChange={onAddPick} value="" disabled={disabled}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="➕ Add draft pick..." />
        </SelectTrigger>
        <SelectContent>
          {[2026, 2027, 2028].map((year) =>
            [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((round) => (
              <SelectItem key={`${year}-${round}`} value={`${year}-${round}`}>
                {year} Round {round}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
