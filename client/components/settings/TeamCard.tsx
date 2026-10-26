import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { getTeamEmoji } from "@/lib/draft-constants";

export type SettingsTeam = {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
  is_my_team: boolean;
  championships: number;
  emoji: string | null;
};

type Props = {
  team: SettingsTeam;
  saving: boolean;
  onSave: (teamId: number, teamName: string, emoji: string) => Promise<boolean>;
};

function TeamCard({ team, saving, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.team_name);
  const [emoji, setEmoji] = useState(team.emoji ?? getTeamEmoji(team.team_name));
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset draft values whenever the saved team changes or editing opens
  useEffect(() => {
    if (!editing) {
      setName(team.team_name);
      setEmoji(team.emoji ?? getTeamEmoji(team.team_name));
    }
  }, [team.team_name, team.emoji, editing]);

  useEffect(() => {
    if (editing) nameRef.current?.focus();
  }, [editing]);

  const trimmedName = name.trim();
  const trimmedEmoji = emoji.trim();
  const dirty =
    trimmedName !== team.team_name ||
    trimmedEmoji !== (team.emoji ?? getTeamEmoji(team.team_name));
  const canSave = trimmedName.length > 0 && dirty && !saving;

  const handleCancel = useCallback(() => setEditing(false), []);

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    const ok = await onSave(team.id, trimmedName, trimmedEmoji);
    if (ok) setEditing(false);
  }, [canSave, onSave, team.id, trimmedName, trimmedEmoji]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleSave();
      if (e.key === "Escape") handleCancel();
    },
    [handleSave, handleCancel],
  );

  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2 min-h-[58px]">
      <span
        className="w-4 h-4 rounded-full ring-1 ring-white/20 shrink-0"
        style={{ backgroundColor: team.color }}
      />

      {editing ? (
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <Input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Team emoji"
            maxLength={16}
            className="h-8 w-12 px-1 text-center text-base shrink-0"
          />
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Team name"
            maxLength={60}
            placeholder="Team name"
            className="h-8 text-sm flex-1 min-w-0"
          />
          <Button
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSave}
            disabled={!canSave}
            title="Save"
          >
            <Icon icon={saving ? "loader-circle" : "check"} className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0"
            onClick={handleCancel}
            disabled={saving}
            title="Cancel"
          >
            <Icon icon="x" className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">
              {team.emoji ?? getTeamEmoji(team.team_name)} {team.team_name}
              {team.is_my_team && (
                <span className="ml-1.5 text-[10px] text-primary font-bold">(YOU)</span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {team.manager_name}
              {team.championships > 0 && (
                <span className="ml-1.5">{"🏆".repeat(team.championships)}</span>
              )}
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
            title={`Edit ${team.team_name}`}
          >
            <Icon icon="pencil" className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </div>
  );
}

export default memo(TeamCard);
