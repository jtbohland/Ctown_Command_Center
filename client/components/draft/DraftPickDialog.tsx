import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PositionBadge from "./PositionBadge";
import { getTeamEmoji, type Player, type DraftPick, type Team } from "@/lib/draft-constants";

type DraftPickDialogProps = {
  player: Player | null;
  picks: DraftPick[];
  teams: Team[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (playerId: number, pickId: number) => void;
  loading: boolean;
};

export default function DraftPickDialog({
  player,
  picks,
  teams,
  open,
  onOpenChange,
  onConfirm,
  loading,
}: DraftPickDialogProps) {
  const [selectedPickId, setSelectedPickId] = useState<string>("");

  // Get the next incomplete pick as default
  const availablePicks = useMemo(() => {
    return picks.filter((p) => !p.is_complete);
  }, [picks]);

  // Auto-select the next pick on open
  const nextPick = availablePicks[0];

  const handleConfirm = () => {
    if (!player) return;
    const pickId = selectedPickId ? Number(selectedPickId) : nextPick?.id;
    if (!pickId) return;
    onConfirm(player.id, pickId);
    setSelectedPickId("");
  };

  if (!player) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PositionBadge position={player.position} />
            {player.name}
          </DialogTitle>
          <DialogDescription>
            {player.nfl_team} • ADP #{player.adp_rank} • Dynasty #{player.dynasty_rank}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <label className="text-sm font-medium text-foreground">Assign to pick:</label>
          <Select
            value={selectedPickId || String(nextPick?.id ?? "")}
            onValueChange={setSelectedPickId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a pick..." />
            </SelectTrigger>
            <SelectContent>
              {availablePicks.map((pick) => {
                const team = teams.find((t) => t.id === pick.team_id);
                return (
                  <SelectItem key={pick.id} value={String(pick.id)}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs">
                        R{pick.round}.{String(pick.pick_in_round).padStart(2, "0")}
                      </span>
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: pick.team_color }}
                      />
                      <span>{getTeamEmoji(pick.team_name)} {pick.team_name}</span>
                      {pick.is_my_team && (
                        <span className="text-[10px] text-primary font-bold">(YOU)</span>
                      )}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? "Drafting..." : "Confirm Draft Pick"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
