import { useState, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NFL_TEAMS, getByeWeek } from "@/lib/nfl-teams";
import { useApi } from "@/hooks/useApi";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";

const POSITIONS = ["QB", "RB", "WR", "TE"] as const;

type WriteInModalProps = {
  open: boolean;
  onClose: () => void;
  onPlayerCreated: (player: {
    id: number;
    name: string;
    position: string;
    nfl_team: string;
    bye_week: number | null;
  }) => void;
};

export default function WriteInModal({
  open,
  onClose,
  onPlayerCreated,
}: WriteInModalProps) {
  const [playerName, setPlayerName] = useState("");
  const [position, setPosition] = useState<string>("");
  const [nflTeam, setNflTeam] = useState<string>("");

  const { run: writeIn, loading } = useApi("WriteInPlayer");

  const byeWeek = useMemo(() => {
    if (!nflTeam) return null;
    return getByeWeek(nflTeam);
  }, [nflTeam]);

  const isValid = playerName.trim().length > 0 && position && nflTeam;

  const handleSubmit = useCallback(async () => {
    if (!isValid) return;
    try {
      const result = await writeIn({
        playerName: playerName.trim(),
        position: position as "QB" | "RB" | "WR" | "TE",
        nflTeam,
        byeWeek,
      });
      if (result) {
        toast.success(result.message);
        onPlayerCreated(result.player);
        // Reset form
        setPlayerName("");
        setPosition("");
        setNflTeam("");
        onClose();
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : String(err);
      toast.error(message);
    }
  }, [isValid, writeIn, playerName, position, nflTeam, byeWeek, onPlayerCreated, onClose]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setPlayerName("");
        setPosition("");
        setNflTeam("");
        onClose();
      }
    },
    [onClose],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-zinc-900 border-zinc-700">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <span className="text-lg">✏️</span>
            Write-In Player
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Add a player not on the ADP board. You can edit ADP and age later.
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Player Name */}
          <div className="space-y-1.5">
            <Label htmlFor="write-in-name" className="text-zinc-300 text-xs">
              Player Name
            </Label>
            <Input
              id="write-in-name"
              placeholder="e.g. Travis Hunter"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="bg-zinc-800 border-zinc-600 text-white"
              autoFocus
            />
          </div>

          {/* Position */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-xs">Position</Label>
            <Select value={position} onValueChange={setPosition}>
              <SelectTrigger className="bg-zinc-800 border-zinc-600 text-white">
                <SelectValue placeholder="Select position" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-600">
                {POSITIONS.map((pos) => (
                  <SelectItem key={pos} value={pos} className="text-white">
                    {pos}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* NFL Team */}
          <div className="space-y-1.5">
            <Label className="text-zinc-300 text-xs">NFL Team</Label>
            <Select value={nflTeam} onValueChange={setNflTeam}>
              <SelectTrigger className="bg-zinc-800 border-zinc-600 text-white">
                <SelectValue placeholder="Select team" />
              </SelectTrigger>
              <SelectContent className="bg-zinc-800 border-zinc-600 max-h-56">
                {NFL_TEAMS.map((t) => (
                  <SelectItem key={t.abbr} value={t.abbr} className="text-white">
                    {t.abbr} — {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bye Week (auto-filled) */}
          {nflTeam && (
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Icon name="Calendar" className="h-3.5 w-3.5" />
              <span>Bye week: {byeWeek ?? "—"}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            className="text-zinc-400"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || loading}
            className="bg-amber-600 hover:bg-amber-500 text-white"
          >
            {loading ? (
              <>
                <Icon name="Loader2" className="h-4 w-4 mr-1.5 animate-spin" />
                Creating…
              </>
            ) : (
              "➕ Draft Player"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
