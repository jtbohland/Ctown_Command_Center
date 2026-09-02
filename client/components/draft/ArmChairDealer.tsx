import { useCallback, useMemo } from "react";
import { useApiData } from "@/hooks/useApiData";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getCTownDisplaySeason, getAllCTownSeasons } from "@/lib/trade-utils";

import TradeBuilder from "./TradeBuilder";
import TradeHistory from "./TradeHistory";
import DraftCapitalView from "./DraftCapitalView";
import GoodBadUgly from "./GoodBadUgly";
import SirenSale from "./SirenSale";
import Playbook from "./Playbook";
import ReduxRosters from "./ReduxRosters";
import TransactionsTab from "./TransactionsTab";


export default function ArmChairDealer() {
  const { data, loading, fetching, isError, error, refetch } = useApiData("GetTradeData", {});

  // Fetch 2026 draft picks for Treasury (from draft board, not draft_capital)
  const { data: rosterData, refetch: refetchRosters } = useApiData("GetRosterData", {});

  const handleTradeSaved = useCallback(() => {
    refetch();        // Ledger, Verdicts, Treasury capital
    refetchRosters(); // Treasury draft board, Redux Rosters
  }, [refetch, refetchRosters]);

  // Derive display seasons using NFL calendar
  const seasonCount = useMemo(() => {
    if (!data?.trades) return 0;
    const present = new Set(
      data.trades.map((t: { trade_date: string | null; season: string }) =>
        getCTownDisplaySeason(t.trade_date, t.season)
      )
    );
    return getAllCTownSeasons().filter((s) => present.has(s)).length;
  }, [data?.trades]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-10 w-full max-w-2xl" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-[300px] rounded-xl" />
          <Skeleton className="h-[300px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
          <div className="text-2xl mb-2">⚠️</div>
          <p className="text-red-400 text-sm font-semibold">Failed to load trade data</p>
          <p className="text-xs text-muted-foreground mt-1">
            Make sure to run InitTradeTables, then seed the data.
          </p>
          <p className="text-xs text-muted-foreground mt-1 font-mono">{String(error)}</p>
        </div>
      </div>
    );
  }

  const { trades, assets, draftCapital, players, teams, historicalAdp } = data!;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-border bg-gradient-to-r from-blue-950/30 via-card/60 to-red-950/30">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🫱🏻‍🫲🏽</span>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">The C-Town Exchange</h2>
            <span className="text-[10px] text-muted-foreground">
              Dynasty trade evaluation powered by ADP + Actuals • {trades.length} historical trades across {seasonCount} seasons
            </span>
          </div>
          {fetching && (
            <span className="text-xs text-muted-foreground ml-auto animate-pulse">🔄 Updating…</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="rosters" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 pt-2 border-b border-border/50 bg-card/30">
          <TabsList className="bg-muted/50 h-9">
            <TabsTrigger value="rosters" className="text-xs gap-1">🏟️ Redux Rosters</TabsTrigger>
            <TabsTrigger value="builder" className="text-xs gap-1">⚖️ Deal Desk</TabsTrigger>
            <TabsTrigger value="siren" className="text-xs gap-1">🚨 Sound The Alarm</TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1">📚 The Ledger</TabsTrigger>
            <TabsTrigger value="gbu" className="text-xs gap-1">🏛️ The Verdicts</TabsTrigger>
            <TabsTrigger value="transactions" className="text-xs gap-1">📇 Transactions</TabsTrigger>
            <TabsTrigger value="capital" className="text-xs gap-1">💰 The Treasury</TabsTrigger>
            <TabsTrigger value="playbook" className="text-xs gap-1">📖 The Playbook</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="builder" className="flex-1 overflow-auto px-5 py-4">
          <TradeBuilder players={players} teams={teams} draftCapital={draftCapital} draftPicks2026={rosterData?.draftPicks2026 ?? []} />
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-auto px-5 py-4">
          <TradeHistory trades={trades} assets={assets} teams={teams} historicalAdp={historicalAdp} />
        </TabsContent>

        <TabsContent value="gbu" className="flex-1 overflow-auto px-5 py-4">
          <GoodBadUgly trades={trades} assets={assets} teams={teams} historicalAdp={historicalAdp} />
        </TabsContent>

        <TabsContent value="siren" className="flex-1 overflow-auto px-5 py-4">
          <SirenSale teams={teams} players={players} draftCapital={draftCapital} draftPicks2026={rosterData?.draftPicks2026 ?? []} onSaved={handleTradeSaved} />
        </TabsContent>

        <TabsContent value="capital" className="flex-1 overflow-auto px-5 py-4">
          <DraftCapitalView draftCapital={draftCapital} teams={teams} draftPicks2026={rosterData?.draftPicks2026} />
        </TabsContent>

        <TabsContent value="playbook" className="flex-1 overflow-auto px-5 py-4">
          <Playbook />
        </TabsContent>

        <TabsContent value="rosters" className="flex-1 overflow-auto px-5 py-4">
          <ReduxRosters teams={teams} />
        </TabsContent>

        <TabsContent value="transactions" className="flex-1 overflow-auto px-5 py-4">
          <TransactionsTab teams={teams} />
        </TabsContent>

      </Tabs>
    </div>
  );
}
