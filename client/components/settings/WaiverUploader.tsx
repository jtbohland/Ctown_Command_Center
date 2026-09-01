import { useCallback, useRef, useState, useMemo } from "react";
import { useApi } from "@/hooks/useApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PositionBadge from "@/components/draft/PositionBadge";
import { toast } from "sonner";
import { queryClient } from "@superblocksteam/library";

// Season options: 2026-27 through 2034-35
const SEASON_OPTIONS = Array.from({ length: 9 }, (_, i) => {
  const start = 2026 + i;
  const end = String(start + 1).slice(-2);
  return `${start}-${end}`;
});

type ParsedTransaction = {
  added_player_name: string | null;
  added_player_position: string | null;
  added_player_nfl_team: string | null;
  added_player_id: number | null;
  added_player_matched: boolean;
  dropped_player_name: string | null;
  dropped_player_position: string | null;
  dropped_player_nfl_team: string | null;
  dropped_player_id: number | null;
  dropped_player_matched: boolean;
  manager_name: string;
  team_id: number | null;
  team_matched: boolean;
  transaction_date: string;
  transaction_time: string | null;
  is_duplicate: boolean;
};

type ApplyResult = {
  applied: number;
  skippedDuplicates: number;
  playersCreated: number;
  rosterChanges: number;
  errors: string[];
};

export default function WaiverUploader() {
  const [season, setSeason] = useState<string>("2026-27");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [step, setStep] = useState<"upload" | "preview" | "done">("upload");
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { run: parseScreenshot, loading: parsing } = useApi("ParseWaiverScreenshot");
  const { run: applyTransactions, loading: applying } = useApi("ApplyWaiverTransactions");
  const { run: initTable } = useApi("InitWaiverTransactions");

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setSelectedFiles(files);
    setParsedTransactions([]);
    setParseWarnings([]);
    setStep("upload");
    setApplyResult(null);
  }, []);

  const handleParse = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    // Ensure table exists
    try {
      await initTable({});
    } catch {
      // Table probably already exists, continue
    }

    const allTransactions: ParsedTransaction[] = [];
    const allWarnings: string[] = [];

    for (const file of selectedFiles) {
      try {
        const result = await parseScreenshot({
          screenshot: { files: [file] } as any,
          season,
        });
        if (result) {
          allTransactions.push(...(result.transactions as ParsedTransaction[]));
          allWarnings.push(...(result.parseWarnings as string[]));
        }
      } catch (error) {
        const message =
          error && typeof error === "object" && "message" in error
            ? String((error as { message: unknown }).message)
            : String(error);
        toast.error(`Failed to parse ${file.name}: ${message}`);
      }
    }

    setParsedTransactions(allTransactions);
    setParseWarnings(allWarnings);
    setStep("preview");

    if (allTransactions.length === 0) {
      toast.warning("No transactions found in screenshot(s).");
    } else {
      toast.success(`Extracted ${allTransactions.length} transaction(s)`);
    }
  }, [selectedFiles, season, parseScreenshot, initTable]);

  const newTransactions = useMemo(
    () => parsedTransactions.filter((t) => !t.is_duplicate),
    [parsedTransactions],
  );
  const duplicateCount = parsedTransactions.length - newTransactions.length;

  const handleApply = useCallback(async () => {
    if (newTransactions.length === 0) return;

    try {
      const result = await applyTransactions({
        transactions: newTransactions,
        season,
      });

      if (result) {
        setApplyResult(result as ApplyResult);
        setStep("done");

        // Invalidate all roster-related caches
        await Promise.all([
          queryClient.invalidateQueries("GetPlayers"),
          queryClient.invalidateQueries("GetRosterData"),
          queryClient.invalidateQueries("GetTradeData"),
          queryClient.invalidateQueries("GetWaiverTransactions"),
        ]);

        toast.success(
          `Applied ${result.applied} transaction(s). ${result.rosterChanges} roster change(s).`,
        );
      }
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      toast.error("Apply failed: " + message);
    }
  }, [newTransactions, season, applyTransactions]);

  const handleReset = useCallback(() => {
    setSelectedFiles([]);
    setParsedTransactions([]);
    setParseWarnings([]);
    setStep("upload");
    setApplyResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <span>📇</span> Waiver Wire Transactions
        </CardTitle>
        <CardDescription>
          Upload Sleeper screenshots to auto-process waiver claims and update rosters
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Season selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-muted-foreground">Season:</label>
          <Select value={season} onValueChange={setSeason}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEASON_OPTIONS.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* File upload */}
        {step === "upload" && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFileChange}
              className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer"
            />
            {selectedFiles.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {selectedFiles.length} screenshot(s) selected
                {selectedFiles.map((f) => (
                  <span key={f.name} className="block ml-2">
                    • {f.name} ({(f.size / 1024).toFixed(1)} KB)
                  </span>
                ))}
              </div>
            )}
            <Button
              onClick={handleParse}
              disabled={selectedFiles.length === 0 || parsing}
              className="w-full"
            >
              <Icon icon="scan-eye" className="h-4 w-4 mr-2" />
              {parsing ? "Analyzing screenshot(s)..." : "Parse Screenshot(s)"}
            </Button>
          </div>
        )}

        {/* Preview step — empty result */}
        {step === "preview" && parsedTransactions.length === 0 && (
          <div className="space-y-3">
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md px-3 py-3 text-center">
              <p className="text-sm font-semibold text-yellow-500 mb-1">⚠️ No transactions found</p>
              <p className="text-xs text-muted-foreground">
                Gemini couldn't extract any transactions from the screenshot(s). Try a clearer image or crop to just the transaction list.
              </p>
            </div>
            <Button variant="outline" onClick={handleReset} className="w-full">
              <Icon icon="upload" className="h-4 w-4 mr-2" />
              Try Again
            </Button>
          </div>
        )}

        {/* Preview step */}
        {step === "preview" && parsedTransactions.length > 0 && (
          <div className="flex flex-col gap-3 max-h-[480px]">
            {/* Stats bar */}
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Badge variant="secondary" className="text-[10px]">
                {parsedTransactions.length} found
              </Badge>
              {duplicateCount > 0 && (
                <Badge variant="outline" className="text-[10px] text-yellow-500 border-yellow-500/30">
                  {duplicateCount} duplicate(s)
                </Badge>
              )}
              <Badge variant="default" className="text-[10px]">
                {newTransactions.length} new
              </Badge>
            </div>

            {/* Warnings */}
            {parseWarnings.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-md px-3 py-2 shrink-0">
                <p className="text-[10px] font-semibold text-yellow-500 mb-1">⚠️ Warnings:</p>
                {parseWarnings.slice(0, 5).map((w, i) => (
                  <p key={i} className="text-[10px] text-yellow-400/80">• {w}</p>
                ))}
                {parseWarnings.length > 5 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    +{parseWarnings.length - 5} more
                  </p>
                )}
              </div>
            )}

            {/* Transaction list — scrollable, fills available space */}
            <ScrollArea className="min-h-0 flex-1 rounded-md border">
              <div className="p-2 space-y-1">
                {parsedTransactions.map((txn, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs ${txn.is_duplicate ? "opacity-40 line-through" : "hover:bg-accent/50"}`}
                  >
                    {/* Manager */}
                    <span className={`font-semibold w-14 shrink-0 truncate ${txn.team_matched ? "" : "text-yellow-500"}`}>
                      {txn.manager_name}
                    </span>

                    {/* Add */}
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      {txn.added_player_name ? (
                        <>
                          <span className="text-green-500 font-bold text-[10px]">+</span>
                          {txn.added_player_position && <PositionBadge position={txn.added_player_position} />}
                          <span className={`truncate ${txn.added_player_matched ? "" : "text-yellow-400"}`}>
                            {txn.added_player_name}
                          </span>
                          <span className="text-[9px] text-muted-foreground shrink-0">{txn.added_player_nfl_team}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground/50 text-[10px]">—</span>
                      )}
                    </div>

                    {/* Drop */}
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      {txn.dropped_player_name ? (
                        <>
                          <span className="text-red-500 font-bold text-[10px]">−</span>
                          {txn.dropped_player_position && <PositionBadge position={txn.dropped_player_position} />}
                          <span className={`truncate ${txn.dropped_player_matched ? "" : "text-yellow-400"}`}>
                            {txn.dropped_player_name}
                          </span>
                          <span className="text-[9px] text-muted-foreground shrink-0">{txn.dropped_player_nfl_team}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground/50 text-[10px]">—</span>
                      )}
                    </div>

                    {/* Date */}
                    <span className="text-[9px] text-muted-foreground shrink-0 w-16 text-right">
                      {txn.transaction_date.slice(5)}
                    </span>

                    {/* Duplicate badge */}
                    {txn.is_duplicate && (
                      <Badge variant="outline" className="text-[8px] px-1 py-0 text-yellow-500 border-yellow-500/30">
                        DUP
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Actions — pinned at bottom */}
            <div className="flex items-center gap-2 shrink-0">
              <Button
                onClick={handleApply}
                disabled={newTransactions.length === 0 || applying}
                className="flex-1"
              >
                <Icon icon="check" className="h-4 w-4 mr-2" />
                {applying
                  ? "Applying..."
                  : `Apply ${newTransactions.length} Transaction(s)`}
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={applying}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Done step */}
        {step === "done" && applyResult && (
          <div className="space-y-3">
            <div className="bg-green-500/10 border border-green-500/20 rounded-md px-3 py-3">
              <p className="text-sm font-semibold text-green-500 mb-2">✅ Transactions Applied</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Applied:</span>{" "}
                  <span className="font-bold">{applyResult.applied}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Skipped (dup):</span>{" "}
                  <span className="font-bold">{applyResult.skippedDuplicates}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Roster changes:</span>{" "}
                  <span className="font-bold">{applyResult.rosterChanges}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">New players:</span>{" "}
                  <span className="font-bold">{applyResult.playersCreated}</span>
                </div>
              </div>
              {applyResult.errors.length > 0 && (
                <div className="mt-2 pt-2 border-t border-yellow-500/20">
                  <p className="text-[10px] text-yellow-500 font-semibold">Errors:</p>
                  {applyResult.errors.map((e, i) => (
                    <p key={i} className="text-[10px] text-yellow-400/80">• {e}</p>
                  ))}
                </div>
              )}
            </div>
            <Button variant="outline" onClick={handleReset} className="w-full">
              <Icon icon="upload" className="h-4 w-4 mr-2" />
              Upload More Screenshots
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
