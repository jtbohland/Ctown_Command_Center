import { useCallback } from "react";
import { useApiData } from "@/hooks/useApiData";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import TradeBuilder from "./TradeBuilder";
import TradeHistory from "./TradeHistory";
import DraftCapitalView from "./DraftCapitalView";
import GoodBadUgly from "./GoodBadUgly";
import SirenSale from "./SirenSale";

export default function ArmChairDealer() {
  const { data, loading, fetching, isError, error, refetch } = useApiData("GetTradeData", {});

  const handleTradeSaved = useCallback(() => {
    refetch();
  }, [refetch]);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-6 w-48" />
        </div>
        <Skeleton className="h-10 w-96" />
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
          <p className="text-red-400 text-sm font-semibold">
            Failed to load trade data
          </p>
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
      <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-blue-900/20 via-card/50 to-red-900/20">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🛋️</span>
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">Arm Chair Dealer</h2>
            <span className="text-[10px] text-muted-foreground">
              Dynasty trade evaluation powered by ADP • {trades.length} historical trades
            </span>
          </div>
          {fetching && (
            <span className="text-xs text-muted-foreground ml-auto animate-pulse">🔄 Updating…</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="builder" className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 pt-2 border-b border-border/50 bg-card/30">
          <TabsList className="bg-muted/50">
            <TabsTrigger value="builder">⚖️ Trade Builder</TabsTrigger>
            <TabsTrigger value="history">📜 Trade Log</TabsTrigger>
            <TabsTrigger value="gbu">🎭 Good, Bad & Ugly</TabsTrigger>
            <TabsTrigger value="siren">🚨 Siren Sale</TabsTrigger>
            <TabsTrigger value="capital">🗺️ Draft Capital</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="builder" className="flex-1 overflow-auto px-4 py-3">
          <TradeBuilder players={players} teams={teams} draftCapital={draftCapital} />
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-auto px-4 py-3">
          <TradeHistory trades={trades} assets={assets} teams={teams} historicalAdp={historicalAdp} />
        </TabsContent>

        <TabsContent value="gbu" className="flex-1 overflow-auto px-4 py-3">
          <GoodBadUgly trades={trades} assets={assets} teams={teams} historicalAdp={historicalAdp} />
        </TabsContent>

        <TabsContent value="siren" className="flex-1 overflow-auto px-4 py-3">
          <SirenSale teams={teams} players={players} draftCapital={draftCapital} onSaved={handleTradeSaved} />
        </TabsContent>

        <TabsContent value="capital" className="flex-1 overflow-auto px-4 py-3">
          <DraftCapitalView draftCapital={draftCapital} teams={teams} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
