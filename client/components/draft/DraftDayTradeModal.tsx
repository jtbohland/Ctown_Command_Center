import { memo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiData } from "@/hooks/useApiData";
import { queryClient } from "@superblocksteam/library";
import SirenSale from "./SirenSale";

type DraftDayTradeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Draft-day "Sound the Alarm" modal.
 * Wraps SirenSale inside a Dialog, lazy-loading trade data only when open.
 * On save, invalidates draft board / roster / trade caches.
 */
const DraftDayTradeModal = memo(function DraftDayTradeModal({
  open,
  onOpenChange,
}: DraftDayTradeModalProps) {
  // Lazy-load trade data only when dialog is open
  const { data: tradeData, loading: tradeLoading } = useApiData(
    "GetTradeData",
    {},
    { enabled: open },
  );
  const { data: rosterData, loading: rosterLoading } = useApiData(
    "GetRosterData",
    {},
    { enabled: open },
  );

  const handleSaved = useCallback(() => {
    // Invalidate all relevant caches so board/tracker/rosters refresh
    queryClient.invalidateQueries("GetDraftPicks");
    queryClient.invalidateQueries("GetPlayers");
    queryClient.invalidateQueries("GetTradeData");
    queryClient.invalidateQueries("GetRosterData");
  }, []);

  const loading = tradeLoading || rosterLoading;
  const ready = tradeData && rosterData;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-5 pt-4 pb-2 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-xl">🚨</span>
            <span>Sound the Alarm — Draft Day Trade</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading && (
            <div className="space-y-4">
              <Skeleton className="h-20 w-full rounded-xl" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-40 rounded-lg" />
                <Skeleton className="h-40 rounded-lg" />
              </div>
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          )}

          {ready && (
            <SirenSale
              teams={tradeData.teams}
              players={tradeData.players}
              draftCapital={tradeData.draftCapital}
              draftPicks2026={rosterData.draftPicks2026 ?? []}
              onSaved={handleSaved}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default DraftDayTradeModal;
