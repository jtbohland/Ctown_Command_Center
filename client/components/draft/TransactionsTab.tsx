import { useState, useMemo, useCallback } from "react";
import { useApiData } from "@/hooks/useApiData";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import PositionBadge from "@/components/draft/PositionBadge";
import WaiverUploader from "@/components/settings/WaiverUploader";

// Season options: 2026-27 through 2034-35
const SEASON_OPTIONS = Array.from({ length: 9 }, (_, i) => {
  const start = 2026 + i;
  const end = String(start + 1).slice(-2);
  return `${start}-${end}`;
});

type Team = {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
};

type Props = {
  teams: Team[];
};

type Transaction = {
  id: number;
  season: string;
  transaction_date: string;
  transaction_time: string | null;
  manager_name: string;
  team_id: number | null;
  team_name: string | null;
  team_color: string | null;
  added_player_name: string | null;
  added_player_position: string | null;
  added_player_nfl_team: string | null;
  added_player_id: number | null;
  added_player_adp_rank: number | null;
  dropped_player_name: string | null;
  dropped_player_position: string | null;
  dropped_player_nfl_team: string | null;
  dropped_player_id: number | null;
  dropped_player_adp_rank: number | null;
  processed_at: string;
};

/** ADP rank → 0-100 value scale (same formula used across the app) */
function adpValue(adpRank: number | null): number | null {
  if (adpRank == null) return null;
  return Math.max(0, Math.round(100 - adpRank));
}

/** Format date for display */
function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function TransactionsTab({ teams }: Props) {
  const [season, setSeason] = useState("2026-27");
  const [managerId, setManagerId] = useState<number | null>(null);

  const { data, loading, fetching, isError, error } = useApiData(
    "GetWaiverTransactions",
    { season, managerId },
  );

  const transactions: Transaction[] = useMemo(
    () => (data?.transactions as Transaction[]) ?? [],
    [data],
  );

  // Group transactions by date for visual sections
  const groupedByDate = useMemo(() => {
    const groups: Record<string, Transaction[]> = {};
    for (const txn of transactions) {
      const key = txn.transaction_date;
      if (!groups[key]) groups[key] = [];
      groups[key].push(txn);
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [transactions]);

  const handleManagerChange = useCallback((val: string) => {
    setManagerId(val === "all" ? null : Number(val));
  }, []);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
        <p className="text-red-400 text-sm font-semibold">Failed to load transactions</p>
        <p className="text-xs text-muted-foreground mt-1 font-mono">{String(error)}</p>
        <p className="text-xs text-muted-foreground mt-2">
          If this is the first time, run InitWaiverTransactions from Settings first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Upload Section */}
      <WaiverUploadSection />

      {/* Header + Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-lg">📇</span>
          <h3 className="text-sm font-bold">Waiver Transactions</h3>
          {fetching && (
            <span className="text-xs text-muted-foreground animate-pulse">🔄</span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {/* Season filter */}
          <Select value={season} onValueChange={setSeason}>
            <SelectTrigger className="w-[120px] h-7 text-xs">
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

          {/* Manager filter */}
          <Select value={managerId?.toString() ?? "all"} onValueChange={handleManagerChange}>
            <SelectTrigger className="w-[140px] h-7 text-xs">
              <SelectValue placeholder="All managers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-xs">All Managers</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id.toString()} className="text-xs">
                  {t.manager_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="text-[10px]">
          {transactions.length} transaction{transactions.length !== 1 ? "s" : ""}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {data?.totalPlayers ?? 0} players rostered
        </span>
      </div>

      {/* Transaction list */}
      {transactions.length === 0 ? (
        <div className="text-center py-12">
          <span className="text-4xl mb-3 block">📇</span>
          <p className="text-sm text-muted-foreground">No transactions for {season}</p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload Sleeper screenshots using the upload button above
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-340px)] min-h-[300px]">
          <div className="space-y-4">
            {groupedByDate.map(([dateKey, txns]) => (
              <div key={dateKey}>
                {/* Date header */}
                <div className="sticky top-0 bg-card/80 backdrop-blur-sm z-10 px-2 py-1.5 border-b border-border/50 mb-1">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {formatDate(dateKey)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 ml-2">
                    {txns.length} move{txns.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Transactions for this date */}
                <div className="space-y-0.5">
                  {txns.map((txn) => (
                    <TransactionRow key={txn.id} txn={txn} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

/** Collapsible waiver upload section */
function WaiverUploadSection() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/40 transition-colors"
      >
        <Icon icon="upload" className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold">Upload Waiver Wire Screenshots</span>
        <Icon icon={open ? "chevron-up" : "chevron-down"} className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
      </button>
      {open && (
        <div className="border-t border-border">
          <WaiverUploader />
        </div>
      )}
    </div>
  );
}
/** Single transaction row — Sleeper-style layout */
function TransactionRow({ txn }: { txn: Transaction }) {
  const addedVal = adpValue(txn.added_player_adp_rank);
  const droppedVal = adpValue(txn.dropped_player_adp_rank);

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/40 transition-colors group">
      {/* Team color dot + manager */}
      <div className="flex items-center gap-1.5 w-20 shrink-0">
        <span
          className="w-2.5 h-2.5 rounded-full ring-1 ring-white/10 shrink-0"
          style={{ backgroundColor: txn.team_color ?? "#666" }}
        />
        <span className="text-xs font-semibold truncate">{txn.manager_name}</span>
      </div>

      {/* Added player */}
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {txn.added_player_name ? (
          <>
            <span className="text-green-500 font-black text-xs leading-none">+</span>
            {txn.added_player_position && (
              <PositionBadge position={txn.added_player_position} className="text-[8px] px-1" />
            )}
            <span className="text-xs truncate font-medium">{txn.added_player_name}</span>
            <span className="text-[9px] text-muted-foreground shrink-0">{txn.added_player_nfl_team}</span>
            {addedVal != null && addedVal > 0 && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-green-400 border-green-500/20 shrink-0 ml-auto">
                {addedVal}
              </Badge>
            )}
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground/40 italic">no add</span>
        )}
      </div>

      {/* Dropped player */}
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {txn.dropped_player_name ? (
          <>
            <span className="text-red-500 font-black text-xs leading-none">−</span>
            {txn.dropped_player_position && (
              <PositionBadge position={txn.dropped_player_position} className="text-[8px] px-1" />
            )}
            <span className="text-xs truncate font-medium text-muted-foreground">{txn.dropped_player_name}</span>
            <span className="text-[9px] text-muted-foreground shrink-0">{txn.dropped_player_nfl_team}</span>
            {droppedVal != null && droppedVal > 0 && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 text-red-400 border-red-500/20 shrink-0 ml-auto">
                {droppedVal}
              </Badge>
            )}
          </>
        ) : (
          <span className="text-[10px] text-muted-foreground/40 italic">no drop</span>
        )}
      </div>

      {/* Time */}
      <span className="text-[9px] text-muted-foreground/60 w-14 shrink-0 text-right">
        {txn.transaction_time ?? ""}
      </span>
    </div>
  );
}
