import { useState, useCallback, useMemo } from "react";
import SirenCelebration from "./SirenCelebration";
import { useApi } from "@/hooks/useApi";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Textarea } from "@/components/ui/textarea";
import { getTeamEmoji, POSITION_BG_CLASSES } from "@/lib/draft-constants";
import { calcPlayerValue, calcPickValue, type TeamRow, type PlayerRow, type DraftCapitalRow } from "@/lib/trade-utils";
import { formatDropdownLabel } from "@/lib/player-values";

/** Fixed future seasons for Siren Sale — no backlog, future trades only */
const SIREN_SEASONS = [
  "2026-27", "2027-28", "2028-29", "2029-30", "2030-31",
  "2031-32", "2032-33", "2033-34", "2034-35",
] as const;

interface Asset {
  type: "player" | "pick";
  playerName: string | null;
  playerPosition: string | null;
  pickYear: number | null;
  pickRound: number | null;
  pickNumber: number | null;
  fromTeamId: number;
  /** For 3-team trades: which team receives this asset */
  recipientTeamId: number | null;
}

type DraftPick2026 = { round: number; pick_in_round: number; overall_pick: number; team_id: number; team_name: string; manager_name: string; player_id: number | null; is_complete: boolean };

interface Props {
  teams: TeamRow[];
  players: PlayerRow[];
  draftCapital: DraftCapitalRow[];
  draftPicks2026: DraftPick2026[];
  onSaved: () => void;
}

export default function SirenSale({ teams, players, draftCapital, draftPicks2026, onSaved }: Props) {
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [teamCId, setTeamCId] = useState<number | null>(null);
  const [wildCardEnabled, setWildCardEnabled] = useState(false);
  const [season, setSeason] = useState<string>("2026-27");
  const [period, setPeriod] = useState<string>("off-season");
  const [notes, setNotes] = useState<string>("");
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [teamAAssets, setTeamAAssets] = useState<Asset[]>([]);
  const [teamBAssets, setTeamBAssets] = useState<Asset[]>([]);
  const [teamCAssets, setTeamCAssets] = useState<Asset[]>([]);
  const [recentSaves, setRecentSaves] = useState<{ tradeNumber: number; teamA: string; teamB: string; teamC?: string; playersMoved: number; picksMoved: number; verdictEmoji?: string; verdictLabel?: string }[]>([]);

  const { run: saveTrade, loading: saving } = useApi("SaveTrade");
  const { run: evaluateTrade } = useApi("EvaluateTrade");
  const { run: persistVerdict } = useApi("PersistTradeVerdict");

  // Teams already selected (for filtering dropdowns)
  const selectedTeamIds = useMemo(() => {
    const ids = new Set<number>();
    if (teamAId) ids.add(teamAId);
    if (teamBId) ids.add(teamBId);
    if (teamCId) ids.add(teamCId);
    return ids;
  }, [teamAId, teamBId, teamCId]);

  const handleToggleWildCard = useCallback(() => {
    setWildCardEnabled((prev) => {
      if (prev) {
        // Removing wild card — clear team C state + recipients
        setTeamCId(null);
        setTeamCAssets([]);
        setTeamAAssets((a) => a.map((asset) => ({ ...asset, recipientTeamId: null })));
        setTeamBAssets((a) => a.map((asset) => ({ ...asset, recipientTeamId: null })));
      }
      return !prev;
    });
  }, []);

  const addAsset = useCallback(
    (side: "A" | "B" | "C", type: "player" | "pick", value: string) => {
      const teamId = side === "A" ? teamAId : side === "B" ? teamBId : teamCId;
      if (!teamId) return;

      let asset: Asset;
      if (type === "player") {
        const player = players.find((p) => p.id === Number(value));
        if (!player) return;
        asset = {
          type: "player",
          playerName: player.name,
          playerPosition: player.position,
          pickYear: null,
          pickRound: null,
          pickNumber: null,
          fromTeamId: teamId,
          recipientTeamId: null,
        };
      } else {
        const parts = value.split("-");
        const overallPick = parts.length >= 3 ? Number(parts[2]) : null;
        asset = {
          type: "pick",
          playerName: null,
          playerPosition: null,
          pickYear: Number(parts[0]),
          pickRound: Number(parts[1]),
          pickNumber: overallPick,
          fromTeamId: teamId,
          recipientTeamId: null,
        };
      }

      if (side === "A") setTeamAAssets((prev) => [...prev, asset]);
      else if (side === "B") setTeamBAssets((prev) => [...prev, asset]);
      else setTeamCAssets((prev) => [...prev, asset]);
    },
    [players, teamAId, teamBId, teamCId]
  );

  const removeAsset = useCallback((side: "A" | "B" | "C", index: number) => {
    const setter = side === "A" ? setTeamAAssets : side === "B" ? setTeamBAssets : setTeamCAssets;
    setter((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const setRecipient = useCallback((side: "A" | "B" | "C", index: number, recipientTeamId: number) => {
    const setter = side === "A" ? setTeamAAssets : side === "B" ? setTeamBAssets : setTeamCAssets;
    setter((prev) => prev.map((a, i) => i === index ? { ...a, recipientTeamId } : a));
  }, []);

  // Note: Roster ownership validation happens server-side.
  // The players list from GetTradeData only includes undrafted/keeper players,
  // so we can't validate roster ownership client-side.

  const handleSave = useCallback(async () => {
    if (!teamAId || !teamBId) {
      toast.error("Select both teams");
      return;
    }
    if (wildCardEnabled && !teamCId) {
      toast.error("Select The Wild Card team or remove it");
      return;
    }

    const allAssets = [...teamAAssets, ...teamBAssets, ...(wildCardEnabled ? teamCAssets : [])];

    if (allAssets.length === 0) {
      toast.error("Add at least one asset to trade");
      return;
    }

    // 2-team: both sides need assets
    if (!wildCardEnabled && (teamAAssets.length === 0 || teamBAssets.length === 0)) {
      toast.error("Both sides need at least one asset");
      return;
    }

    // 3-team: validate all assets have recipients
    if (wildCardEnabled) {
      const unassigned = allAssets.filter((a) => !a.recipientTeamId);
      if (unassigned.length > 0) {
        toast.error(`${unassigned.length} asset(s) need a recipient! Use the → dropdown on each asset.`);
        return;
      }
    }

    try {
      const res = await saveTrade({
        teamAId,
        teamBId,
        teamCId: wildCardEnabled ? teamCId : null,
        season,
        period,
        notes: notes.trim() || null,
        assets: allAssets,
        dryRun: false,
      });

      const teamAName = teams.find((t) => t.id === teamAId)?.team_name ?? "";
      const teamBName = teams.find((t) => t.id === teamBId)?.team_name ?? "";
      const teamCName = teamCId ? (teams.find((t) => t.id === teamCId)?.team_name ?? "") : undefined;

      // Evaluate verdict (best-effort — trade is already saved)
      let verdictEmoji: string | undefined;
      let verdictLabel: string | undefined;
      try {
        const teamAGivesEval = teamAAssets.map((a) => ({
          type: a.type,
          playerName: a.playerName,
          playerPosition: a.playerPosition,
          playerAdp: null,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
          pickNumber: a.pickNumber,
        }));
        const teamBGivesEval = teamBAssets.map((a) => ({
          type: a.type,
          playerName: a.playerName,
          playerPosition: a.playerPosition,
          playerAdp: null,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
          pickNumber: a.pickNumber,
        }));
        const evalResult = await evaluateTrade({
          teamAId,
          teamBId,
          teamAGives: teamAGivesEval,
          teamBGives: teamBGivesEval,
          modifiers: null,
        });
        if (evalResult?.verdict) {
          verdictEmoji = evalResult.verdict.emoji;
          verdictLabel = evalResult.verdict.label;
          // Persist verdict to DB (fire-and-forget — don't block UI)
          persistVerdict({
            tradeId: res?.tradeId ?? 0,
            verdictLabel: evalResult.verdict.label,
            verdictEmoji: evalResult.verdict.emoji,
            verdictSeverity: evalResult.verdict.severity,
            winnerTeamId: evalResult.winningTeamId ?? null,
            pctDifference: evalResult.pctDifference ?? 0,
            teamATotal: evalResult.teamASide?.totalValue ?? 0,
            teamBTotal: evalResult.teamBSide?.totalValue ?? 0,
            teamCTotal: null,
          }).catch(() => {
            // Best-effort — verdict is still shown in UI
          });
        }
      } catch {
        // Evaluation is optional — trade is already saved
      }

      toast.success(`🚨 Trade #${res?.tradeNumber ?? 0} logged! ${verdictEmoji ?? "✅"} ${verdictLabel ?? "Saved"}`);

      setRecentSaves((prev) => [
        {
          tradeNumber: res?.tradeNumber ?? 0,
          teamA: teamAName,
          teamB: teamBName,
          teamC: teamCName,
          playersMoved: res?.playersMovedCount ?? 0,
          picksMoved: res?.picksMovedCount ?? 0,
          verdictEmoji,
          verdictLabel,
        },
        ...prev,
      ]);

      // Reset form
      setTeamAAssets([]);
      setTeamBAssets([]);
      setTeamCAssets([]);
      setNotes("");
      setNotesExpanded(false);
      onSaved();
      setSirenActive(true);
    } catch (err) {
      const message = err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
      toast.error("Save failed: " + message);
    }
  }, [teamAId, teamBId, teamCId, wildCardEnabled, season, period, notes, teamAAssets, teamBAssets, teamCAssets, saveTrade, evaluateTrade, persistVerdict, teams, onSaved]);

  const [sirenActive, setSirenActive] = useState(false);

  const teamA = teams.find((t) => t.id === teamAId);
  const teamB = teams.find((t) => t.id === teamBId);
  const teamC = teams.find((t) => t.id === teamCId);

  // Recipient options for 3-team mode (exclude the sending team)
  const getRecipientOptions = useCallback(
    (sendingTeamId: number) => {
      const options: { id: number; label: string }[] = [];
      if (teamAId && teamAId !== sendingTeamId) {
        options.push({ id: teamAId, label: `${getTeamEmoji(teamA?.team_name ?? "")} ${teamA?.team_name ?? "Side A"}` });
      }
      if (teamBId && teamBId !== sendingTeamId) {
        options.push({ id: teamBId, label: `${getTeamEmoji(teamB?.team_name ?? "")} ${teamB?.team_name ?? "Side B"}` });
      }
      if (teamCId && teamCId !== sendingTeamId) {
        options.push({ id: teamCId, label: `${getTeamEmoji(teamC?.team_name ?? "")} ${teamC?.team_name ?? "Wild Card"}` });
      }
      return options;
    },
    [teamAId, teamBId, teamCId, teamA, teamB, teamC]
  );

  const allAssetsCount = teamAAssets.length + teamBAssets.length + (wildCardEnabled ? teamCAssets.length : 0);
  const canSave = wildCardEnabled
    ? teamAId != null && teamBId != null && teamCId != null && allAssetsCount > 0
    : teamAId != null && teamBId != null && teamAAssets.length > 0 && teamBAssets.length > 0;

  return (
    <div className="space-y-4">
      <SirenCelebration active={sirenActive} onComplete={() => setSirenActive(false)} />
      {/* Header */}
      <div className="rounded-xl border border-red-500/30 bg-gradient-to-r from-red-600/10 via-orange-600/5 to-red-600/10 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🚨</span>
            <div>
              <h3 className="text-base font-bold text-red-400">Siren Sale</h3>
              <p className="text-xs text-muted-foreground">Log trades — rosters, draft board & treasury auto-update on save</p>
            </div>
          </div>
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
      </div>

      {/* Config Row */}
      <div className="flex items-center gap-3">
        <Select value={season} onValueChange={setSeason}>
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Season..." />
          </SelectTrigger>
          <SelectContent>
            {SIREN_SEASONS.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
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
      <div className={`grid gap-4 ${wildCardEnabled ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="rounded-xl border border-orange-500/30 bg-gradient-to-b from-orange-600/10 to-transparent p-3">
          <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1.5 uppercase">🏠 Side A</div>
          <Select value={teamAId?.toString() ?? ""} onValueChange={(v) => { setTeamAId(Number(v)); setTeamAAssets([]); }}>
            <SelectTrigger className="w-full h-9 text-sm">
              <SelectValue placeholder="Select team..." />
            </SelectTrigger>
            <SelectContent>
              {teams.filter((t) => !selectedTeamIds.has(t.id) || t.id === teamAId).map((t) => (
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
              {teams.filter((t) => !selectedTeamIds.has(t.id) || t.id === teamBId).map((t) => (
                <SelectItem key={t.id} value={t.id.toString()}>
                  {getTeamEmoji(t.team_name)} {t.team_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {wildCardEnabled && (
          <div className="rounded-xl border border-purple-500/30 bg-gradient-to-b from-purple-600/10 to-transparent p-3">
            <div className="text-[10px] font-bold tracking-widest text-muted-foreground mb-1.5 uppercase">🎰 The Wild Card</div>
            <Select value={teamCId?.toString() ?? ""} onValueChange={(v) => { setTeamCId(Number(v)); setTeamCAssets([]); }}>
              <SelectTrigger className="w-full h-9 text-sm">
                <SelectValue placeholder="Select team..." />
              </SelectTrigger>
              <SelectContent>
                {teams.filter((t) => !selectedTeamIds.has(t.id) || t.id === teamCId).map((t) => (
                  <SelectItem key={t.id} value={t.id.toString()}>
                    {getTeamEmoji(t.team_name)} {t.team_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* Asset Panels */}
      <div className={`grid gap-4 ${wildCardEnabled ? "grid-cols-3" : "grid-cols-2"}`}>
        <AssetPanel
          label={teamA ? `${getTeamEmoji(teamA.team_name)} ${teamA.team_name} sends` : "Side A sends"}
          assets={teamAAssets}
          players={players}
          teamId={teamAId}
          draftCapital={draftCapital}
          draftPicks2026={draftPicks2026}
          teams={teams}
          onAddPlayer={(id) => addAsset("A", "player", id)}
          onAddPick={(key) => addAsset("A", "pick", key)}
          onRemove={(idx) => removeAsset("A", idx)}
          disabled={!teamAId}
          showRecipient={wildCardEnabled}
          recipientOptions={teamAId ? getRecipientOptions(teamAId) : []}
          onSetRecipient={(idx, rid) => setRecipient("A", idx, rid)}
        />
        <AssetPanel
          label={teamB ? `${getTeamEmoji(teamB.team_name)} ${teamB.team_name} sends` : "Side B sends"}
          assets={teamBAssets}
          players={players}
          teamId={teamBId}
          draftCapital={draftCapital}
          draftPicks2026={draftPicks2026}
          teams={teams}
          onAddPlayer={(id) => addAsset("B", "player", id)}
          onAddPick={(key) => addAsset("B", "pick", key)}
          onRemove={(idx) => removeAsset("B", idx)}
          disabled={!teamBId}
          showRecipient={wildCardEnabled}
          recipientOptions={teamBId ? getRecipientOptions(teamBId) : []}
          onSetRecipient={(idx, rid) => setRecipient("B", idx, rid)}
        />
        {wildCardEnabled && (
          <AssetPanel
            label={teamC ? `${getTeamEmoji(teamC.team_name)} ${teamC.team_name} sends` : "Wild Card sends"}
            assets={teamCAssets}
            players={players}
            teamId={teamCId}
            draftCapital={draftCapital}
            draftPicks2026={draftPicks2026}
            teams={teams}
            onAddPlayer={(id) => addAsset("C", "player", id)}
            onAddPick={(key) => addAsset("C", "pick", key)}
            onRemove={(idx) => removeAsset("C", idx)}
            disabled={!teamCId}
            showRecipient={wildCardEnabled}
            recipientOptions={teamCId ? getRecipientOptions(teamCId) : []}
            onSetRecipient={(idx, rid) => setRecipient("C", idx, rid)}
          />
        )}
      </div>

      {/* Notes / Contingencies */}
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setNotesExpanded((prev) => !prev)}
          className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <Icon icon={notesExpanded ? "chevron-down" : "chevron-right"} className="h-3.5 w-3.5" />
          <Icon icon="file-text" className="h-3.5 w-3.5" />
          Add Notes / Contingencies
          {notes.trim() && (
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 ml-auto">
              Has notes
            </Badge>
          )}
        </button>
        {notesExpanded && (
          <div className="px-3 pb-3 pt-0">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional: conditional pick returns, performance clauses, exceptions, side deals…"
              className="min-h-[80px] text-xs resize-y bg-secondary/30"
              rows={3}
            />
            <p className="text-[10px] text-muted-foreground mt-1.5">
              These notes are saved with the trade for reference. They don't affect valuations.
            </p>
          </div>
        )}
      </div>

      {/* Save Button */}
      <Button
        onClick={handleSave}
        disabled={saving || !canSave}
        size="lg"
        className="w-full h-12 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white font-bold text-base shadow-lg"
      >
        {saving ? "⏳ Saving..." : `🚨 Log This Trade${wildCardEnabled ? " (3-Way)" : ""}`}
      </Button>

      {/* Recent Saves */}
      {recentSaves.length > 0 && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
          <h4 className="text-xs font-bold text-emerald-400 mb-2">✅ Recently Logged</h4>
          <div className="space-y-1.5">
            {recentSaves.map((s, i) => (
              <div key={i} className="text-xs space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-muted-foreground">#{s.tradeNumber}</span>
                  <span>{getTeamEmoji(s.teamA)} {s.teamA.split(" ")[0]}</span>
                  <span className="text-muted-foreground">↔</span>
                  <span>{getTeamEmoji(s.teamB)} {s.teamB.split(" ")[0]}</span>
                  {s.teamC && (
                    <>
                      <span className="text-muted-foreground">↔</span>
                      <span>🎰 {s.teamC.split(" ")[0]}</span>
                    </>
                  )}
                  {s.verdictEmoji && s.verdictLabel && (
                    <span className="ml-auto text-[10px] font-semibold text-amber-400/90">
                      {s.verdictEmoji} {s.verdictLabel}
                    </span>
                  )}
                </div>
                {(s.playersMoved > 0 || s.picksMoved > 0) && (
                  <div className="text-[10px] text-muted-foreground ml-8">
                    {s.playersMoved > 0 && <span>{s.playersMoved} player{s.playersMoved > 1 ? "s" : ""} moved</span>}
                    {s.playersMoved > 0 && s.picksMoved > 0 && <span> · </span>}
                    {s.picksMoved > 0 && <span>{s.picksMoved} pick{s.picksMoved > 1 ? "s" : ""} reassigned</span>}
                  </div>
                )}
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
  teamId,
  draftCapital,
  draftPicks2026,
  teams,
  onAddPlayer,
  onAddPick,
  onRemove,
  disabled,
  showRecipient,
  recipientOptions,
  onSetRecipient,
}: {
  label: string;
  assets: Asset[];
  players: PlayerRow[];
  teamId: number | null;
  draftCapital: DraftCapitalRow[];
  draftPicks2026: DraftPick2026[];
  teams: TeamRow[];
  onAddPlayer: (id: string) => void;
  onAddPick: (key: string) => void;
  onRemove: (idx: number) => void;
  disabled: boolean;
  showRecipient: boolean;
  recipientOptions: { id: number; label: string }[];
  onSetRecipient: (idx: number, recipientTeamId: number) => void;
}) {
  const isLocked = !teamId;

  // Filter players to those on the selected team's roster
  const rosterFilteredPlayers = useMemo(() => {
    if (!teamId) return [];
    return players.filter((p) => p.roster_team_id === teamId);
  }, [players, teamId]);

  // Available pool: all non-keeper players NOT on ANY roster, sorted by ADP
  const availablePoolPlayers = useMemo(() => {
    if (!teamId) return [];
    return players.filter((p) => !p.is_keeper && p.roster_team_id == null)
      .sort((a, b) => (a.adp_rank ?? 9999) - (b.adp_rank ?? 9999));
  }, [players, teamId]);

  // 2026 exact picks for this team (undrafted only)
  const team2026Picks = useMemo(() => {
    if (!teamId) return [];
    return draftPicks2026.filter((dp) => dp.team_id === teamId && !dp.is_complete);
  }, [draftPicks2026, teamId]);

  // 2027/2028 picks from draft capital for this team
  const teamFuturePicks = useMemo(() => {
    if (!teamId) return [];
    return draftCapital
      .filter((dc) => dc.current_team_id === teamId && dc.year >= 2027)
      .sort((a, b) => a.year - b.year || a.round - b.round);
  }, [draftCapital, teamId]);
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
              <Badge className={`text-[9px] px-1 py-0 shrink-0 ${POSITION_BG_CLASSES[a.playerPosition ?? ""] ?? "bg-muted"}`}>
                {a.playerPosition}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 bg-amber-500/10 border-amber-500/30 text-amber-400">📋</Badge>
            )}
            <span className="flex-1 truncate">{a.type === "player" ? a.playerName : a.pickNumber ? `${a.pickYear} Rd ${a.pickRound} (#${a.pickNumber})` : `${a.pickYear} Rd ${a.pickRound}`}</span>
            <span className="text-[10px] font-mono text-muted-foreground shrink-0">
              ({Math.round(
                a.type === "player"
                  ? (() => { const p = players.find((p) => p.name === a.playerName); return p?.adp_rank ? calcPlayerValue(p.adp_rank) : 0; })()
                  : calcPickValue(a.pickRound ?? 6, a.pickYear ?? 2026, a.pickNumber ?? undefined)
              ).toLocaleString()})
            </span>

            {/* Recipient dropdown for 3-team mode */}
            {showRecipient && (
              <Select
                value={a.recipientTeamId?.toString() ?? ""}
                onValueChange={(v) => onSetRecipient(i, Number(v))}
              >
                <SelectTrigger className="h-5 w-24 text-[9px] shrink-0 border-dashed">
                  <SelectValue placeholder="→ To..." />
                </SelectTrigger>
                <SelectContent>
                  {recipientOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id.toString()} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <button onClick={() => onRemove(i)} className="text-muted-foreground hover:text-red-400 opacity-0 group-hover:opacity-100 shrink-0">
              <Icon icon="x" className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <Select onValueChange={onAddPlayer} value="" disabled={isLocked}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder={isLocked ? "Select a team first" : "➕ Add player..."} />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {/* Current Roster — highlighted */}
          {rosterFilteredPlayers.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[10px] font-bold text-emerald-400 tracking-wider">🏠 ON ROSTER</SelectLabel>
              {rosterFilteredPlayers.map((p) => (
                <SelectItem key={p.id} value={p.id.toString()} className="border-l-2 border-emerald-500/60 pl-3">
                  {formatDropdownLabel(p.name, p.position, p.adp_rank, p.positional_rank)}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
          {/* Separator between sections */}
          {rosterFilteredPlayers.length > 0 && availablePoolPlayers.length > 0 && (
            <SelectSeparator />
          )}
          {/* Available Pool — all non-keeper, unrostered players */}
          {availablePoolPlayers.length > 0 && (
            <SelectGroup>
              <SelectLabel className="text-[10px] font-bold text-zinc-400 tracking-wider">📋 AVAILABLE PLAYERS</SelectLabel>
              {availablePoolPlayers.map((p) => (
                <SelectItem key={`pool-${p.id}`} value={p.id.toString()}>
                  {formatDropdownLabel(p.name, p.position, p.adp_rank, p.positional_rank)}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>

      <Select onValueChange={onAddPick} value="" disabled={isLocked}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder={isLocked ? "Select a team first" : "➕ Add draft pick..."} />
        </SelectTrigger>
        <SelectContent>
          {/* 2026 exact picks from draft board */}
          {team2026Picks.length > 0 && (
            <>
              {team2026Picks.map((dp) => {
                const originalTeam = teams.find((t) => t.id === dp.pick_in_round);
                const isAcquired = originalTeam && originalTeam.id !== dp.team_id;
                return (
                  <SelectItem key={`2026-${dp.overall_pick}`} value={`2026-${dp.round}-${dp.overall_pick}`}>
                    🎯 2026 Rd {dp.round} Pick {dp.pick_in_round} (#{dp.overall_pick} overall)
                    {isAcquired && <span className="text-amber-400 ml-1"> (from {originalTeam.team_name})</span>}
                  </SelectItem>
                );
              })}
            </>
          )}
          {/* 2027/2028 picks from draft capital — "from" tag only on acquired picks */}
          {teamFuturePicks.map((dc) => {
            const isAcquired = dc.original_team_id !== dc.current_team_id;
            return (
              <SelectItem key={`dc-${dc.id}`} value={`${dc.year}-${dc.round}`}>
                {isAcquired ? "🎯 " : ""}{dc.year} Rd {dc.round}{isAcquired ? ` (from ${dc.original_team_name.split(" ")[0]})` : ""}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
