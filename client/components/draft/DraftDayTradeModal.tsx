import { useState, useCallback, useMemo, memo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useApi } from "@/hooks/useApi";
import { queryClient } from "@superblocksteam/library";
import { toast } from "sonner";
import { getTeamEmoji, type Team, type DraftPick } from "@/lib/draft-constants";

type DraftDayTradeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teams: Team[];
  picks: DraftPick[];
};

type AssetEntry = {
  id: string;
  type: "pick" | "player";
  fromTeamId: number;
  // Pick fields
  pickYear: number | null;
  pickRound: number | null;
  pickNumber: number | null;
  pickLabel: string;
  // Player fields
  playerName: string;
  playerPosition: string;
};

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;
const CURRENT_YEAR = 2026;
const CURRENT_SEASON = "2026-27";
const ROUNDS = Array.from({ length: 11 }, (_, i) => i + 1);
const FUTURE_YEARS = [2027, 2028, 2029, 2030];

function makeId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Resolve a pick_number from draft board for current-year picks */
function resolvePickNumber(
  teamId: number,
  round: number,
  picks: DraftPick[],
): number | null {
  const pick = picks.find(
    (p) => p.team_id === teamId && p.round === round && !p.is_complete,
  );
  return pick?.overall_pick ?? null;
}

function pickLabel(round: number, year: number, teamName: string): string {
  if (year === CURRENT_YEAR) return `${year} Rd ${round}`;
  return `${year} Rd ${round} (${teamName})`;
}

type SubmitResult = {
  verdict: string;
  emoji: string;
  tradeNumber: number;
};

const AssetCard = memo(function AssetCard({
  asset,
  teamName,
  onRemove,
}: {
  asset: AssetEntry;
  teamName: string;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-card/60 text-xs">
      {asset.type === "pick" ? (
        <>
          <Icon icon="ticket" className="h-3 w-3 text-blue-400 shrink-0" />
          <span className="font-semibold">
            {asset.pickYear} Rd {asset.pickRound}
          </span>
          {asset.pickNumber && (
            <span className="text-muted-foreground">#{asset.pickNumber}</span>
          )}
        </>
      ) : (
        <>
          <Icon icon="user" className="h-3 w-3 text-amber-400 shrink-0" />
          <span className="font-semibold">{asset.playerName}</span>
          <span className="text-muted-foreground">{asset.playerPosition}</span>
        </>
      )}
      <span className="text-muted-foreground/50 ml-auto text-[10px]">
        from {getTeamEmoji(teamName)} {teamName.split(" ")[0]}
      </span>
      <button
        onClick={() => onRemove(asset.id)}
        className="text-muted-foreground/40 hover:text-red-400 transition-colors"
      >
        <Icon icon="x" className="h-3 w-3" />
      </button>
    </div>
  );
});

const DraftDayTradeModal = memo(function DraftDayTradeModal({
  open,
  onOpenChange,
  teams,
  picks,
}: DraftDayTradeModalProps) {
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [assets, setAssets] = useState<AssetEntry[]>([]);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Add-asset form state
  const [addingFor, setAddingFor] = useState<"A" | "B" | null>(null);
  const [assetType, setAssetType] = useState<"pick" | "player">("pick");
  const [pickYear, setPickYear] = useState(CURRENT_YEAR);
  const [pickRound, setPickRound] = useState(1);
  const [playerName, setPlayerName] = useState("");
  const [playerPos, setPlayerPos] = useState<string>("RB");

  const { run: saveTrade, loading: saving } = useApi("SaveTrade");
  const { run: evaluateTrade, loading: evaluating } = useApi("EvaluateTrade");

  const teamA = useMemo(() => teams.find((t) => t.id === teamAId), [teams, teamAId]);
  const teamB = useMemo(() => teams.find((t) => t.id === teamBId), [teams, teamBId]);

  const teamAAssets = useMemo(() => assets.filter((a) => a.fromTeamId === teamAId), [assets, teamAId]);
  const teamBAssets = useMemo(() => assets.filter((a) => a.fromTeamId === teamBId), [assets, teamBId]);

  const canSubmit = teamAId != null && teamBId != null && teamAId !== teamBId && assets.length >= 2 &&
    teamAAssets.length > 0 && teamBAssets.length > 0;

  const handleAddAsset = useCallback(() => {
    if (!addingFor || (!teamAId && !teamBId)) return;
    const fromTeamId = addingFor === "A" ? teamAId! : teamBId!;
    const fromTeam = teams.find((t) => t.id === fromTeamId);

    if (assetType === "pick") {
      const pickNum = pickYear === CURRENT_YEAR
        ? resolvePickNumber(fromTeamId, pickRound, picks)
        : null;

      setAssets((prev) => [
        ...prev,
        {
          id: makeId(),
          type: "pick",
          fromTeamId,
          pickYear,
          pickRound,
          pickNumber: pickNum,
          pickLabel: pickLabel(pickRound, pickYear, fromTeam?.team_name ?? ""),
          playerName: "",
          playerPosition: "",
        },
      ]);
    } else {
      if (!playerName.trim()) return;
      setAssets((prev) => [
        ...prev,
        {
          id: makeId(),
          type: "player",
          fromTeamId,
          pickYear: null,
          pickRound: null,
          pickNumber: null,
          pickLabel: "",
          playerName: playerName.trim(),
          playerPosition: playerPos,
        },
      ]);
      setPlayerName("");
    }
    setAddingFor(null);
  }, [addingFor, teamAId, teamBId, assetType, pickYear, pickRound, playerName, playerPos, teams, picks]);

  const handleRemoveAsset = useCallback((id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !teamAId || !teamBId) return;

    try {
      // 1. Save the trade (atomic — writes to DB + cascades)
      const saveResult = await saveTrade({
        teamAId,
        teamBId,
        teamCId: null,
        season: CURRENT_SEASON,
        period: "draft_day",
        notes: notes || null,
        assets: assets.map((a) => ({
          type: a.type,
          playerName: a.type === "player" ? a.playerName : null,
          playerPosition: a.type === "player" ? a.playerPosition : null,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
          pickNumber: a.pickNumber,
          fromTeamId: a.fromTeamId,
          recipientTeamId: null, // 2-team trade — inferred
        })),
        dryRun: false,
      });

      // 2. Evaluate for instant verdict
      const teamAGives = assets
        .filter((a) => a.fromTeamId === teamAId)
        .map((a) => ({
          type: a.type,
          playerName: a.type === "player" ? a.playerName : null,
          playerPosition: a.type === "player" ? a.playerPosition : null,
          playerAdp: null,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
          pickNumber: a.pickNumber,
        }));

      const teamBGives = assets
        .filter((a) => a.fromTeamId === teamBId)
        .map((a) => ({
          type: a.type,
          playerName: a.type === "player" ? a.playerName : null,
          playerPosition: a.type === "player" ? a.playerPosition : null,
          playerAdp: null,
          pickYear: a.pickYear,
          pickRound: a.pickRound,
          pickNumber: a.pickNumber,
        }));

      let verdict = { emoji: "✅", label: "Saved" };
      try {
        const evalResult = await evaluateTrade({
          teamAId,
          teamBId,
          teamAGives,
          teamBGives,
          modifiers: null,
        });
        if (evalResult?.verdict) {
          verdict = evalResult.verdict;
        }
      } catch {
        // Evaluation is best-effort — trade is already saved
      }

      // 3. Invalidate all caches — board, picks, rosters all update
      await Promise.all([
        queryClient.invalidateQueries("GetDraftPicks"),
        queryClient.invalidateQueries("GetPlayers"),
        queryClient.invalidateQueries("GetTradeData"),
        queryClient.invalidateQueries("GetRosterData"),
      ]);

      setResult({
        verdict: verdict.label,
        emoji: verdict.emoji,
        tradeNumber: saveResult?.tradeNumber ?? 0,
      });

      toast.success(`🚨 Trade #${saveResult?.tradeNumber} logged! ${verdict.emoji} ${verdict.label}`);
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      toast.error("Trade failed: " + message);
    }
  }, [canSubmit, teamAId, teamBId, assets, notes, saveTrade, evaluateTrade]);

  const handleClose = useCallback(() => {
    // Reset everything on close
    setTeamAId(null);
    setTeamBId(null);
    setAssets([]);
    setNotes("");
    setResult(null);
    setAddingFor(null);
    setPlayerName("");
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">🚨</span>
            <span>Sound the Alarm — Draft Day Trade</span>
          </DialogTitle>
        </DialogHeader>

        {result ? (
          /* ── Success screen ── */
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="text-5xl">{result.emoji}</div>
            <h3 className="text-lg font-bold">Trade #{result.tradeNumber} Logged!</h3>
            <p className="text-sm text-muted-foreground">
              Verdict: <span className="font-semibold text-foreground">{result.verdict}</span>
            </p>
            <p className="text-xs text-muted-foreground/60">
              Draft board, pick tracker, and treasury are updated.
            </p>
            <Button onClick={handleClose} className="mt-2">
              <Icon icon="check" className="h-4 w-4 mr-1.5" />
              Done
            </Button>
          </div>
        ) : (
          /* ── Trade entry form ── */
          <ScrollArea className="flex-1 min-h-0 pr-2">
            <div className="space-y-4 pb-2">
              {/* Team Selection */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                    Team A
                  </label>
                  <Select
                    value={teamAId?.toString() ?? ""}
                    onValueChange={(v) => setTeamAId(Number(v))}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select team..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id.toString()} disabled={t.id === teamBId}>
                          {getTeamEmoji(t.team_name)} {t.team_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                    Team B
                  </label>
                  <Select
                    value={teamBId?.toString() ?? ""}
                    onValueChange={(v) => setTeamBId(Number(v))}
                  >
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select team..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id.toString()} disabled={t.id === teamAId}>
                          {getTeamEmoji(t.team_name)} {t.team_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Assets for each team */}
              {teamAId != null && teamBId != null && (
                <div className="grid grid-cols-2 gap-3">
                  {/* Team A gives */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {getTeamEmoji(teamA?.team_name ?? "")} {teamA?.team_name?.split(" ")[0]} gives
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 text-[10px] px-1.5"
                        onClick={() => setAddingFor("A")}
                      >
                        <Icon icon="plus" className="h-3 w-3" />
                      </Button>
                    </div>
                    {teamAAssets.length === 0 && (
                      <div className="text-[10px] text-muted-foreground/40 py-2 text-center border border-dashed border-border/50 rounded-md">
                        No assets yet
                      </div>
                    )}
                    {teamAAssets.map((a) => (
                      <AssetCard key={a.id} asset={a} teamName={teamA?.team_name ?? ""} onRemove={handleRemoveAsset} />
                    ))}
                  </div>

                  {/* Team B gives */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {getTeamEmoji(teamB?.team_name ?? "")} {teamB?.team_name?.split(" ")[0]} gives
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 text-[10px] px-1.5"
                        onClick={() => setAddingFor("B")}
                      >
                        <Icon icon="plus" className="h-3 w-3" />
                      </Button>
                    </div>
                    {teamBAssets.length === 0 && (
                      <div className="text-[10px] text-muted-foreground/40 py-2 text-center border border-dashed border-border/50 rounded-md">
                        No assets yet
                      </div>
                    )}
                    {teamBAssets.map((a) => (
                      <AssetCard key={a.id} asset={a} teamName={teamB?.team_name ?? ""} onRemove={handleRemoveAsset} />
                    ))}
                  </div>
                </div>
              )}

              {/* Add asset inline form */}
              {addingFor && (
                <div className="border border-primary/30 rounded-lg bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold">
                      Add asset for {addingFor === "A" ? teamA?.team_name : teamB?.team_name}
                    </span>
                    <button onClick={() => setAddingFor(null)} className="ml-auto text-muted-foreground hover:text-foreground">
                      <Icon icon="x" className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* Type toggle */}
                  <div className="flex gap-1">
                    <Button
                      variant={assetType === "pick" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() => setAssetType("pick")}
                    >
                      <Icon icon="ticket" className="h-3 w-3 mr-1" />
                      Draft Pick
                    </Button>
                    <Button
                      variant={assetType === "player" ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 text-xs flex-1"
                      onClick={() => setAssetType("player")}
                    >
                      <Icon icon="user" className="h-3 w-3 mr-1" />
                      Player
                    </Button>
                  </div>

                  {assetType === "pick" ? (
                    <div className="flex gap-2">
                      <Select value={pickYear.toString()} onValueChange={(v) => setPickYear(Number(v))}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={CURRENT_YEAR.toString()}>{CURRENT_YEAR} (this draft)</SelectItem>
                          {FUTURE_YEARS.map((y) => (
                            <SelectItem key={y} value={y.toString()}>{y} (future)</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={pickRound.toString()} onValueChange={(v) => setPickRound(Number(v))}>
                        <SelectTrigger className="h-8 text-xs w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROUNDS.map((r) => (
                            <SelectItem key={r} value={r.toString()}>Rd {r}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-8" onClick={handleAddAsset}>
                        <Icon icon="plus" className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        placeholder="Player name..."
                        className="h-8 text-xs flex-1"
                        onKeyDown={(e) => e.key === "Enter" && handleAddAsset()}
                      />
                      <Select value={playerPos} onValueChange={setPlayerPos}>
                        <SelectTrigger className="h-8 text-xs w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {POSITIONS.map((p) => (
                            <SelectItem key={p} value={p}>{p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="sm" className="h-8" onClick={handleAddAsset} disabled={!playerName.trim()}>
                        <Icon icon="plus" className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Notes (optional)
                </label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Draft day pick swap..."
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </ScrollArea>
        )}

        {/* Submit button */}
        {!result && (
          <div className="border-t border-border pt-3 mt-2 flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs">
              Cancel
            </Button>
            <Button
              className="flex-1 text-xs font-bold"
              size="sm"
              disabled={!canSubmit || saving || evaluating}
              onClick={handleSubmit}
            >
              {saving || evaluating ? (
                <>
                  <Icon icon="loader-circle" className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  {saving ? "Saving trade..." : "Getting verdict..."}
                </>
              ) : (
                <>
                  🚨 Sound the Alarm
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
});

export default DraftDayTradeModal;
