import { useMemo } from "react";
import { useApiData } from "@/hooks/useApiData";
import { registerTeamEmojis } from "@/lib/draft-constants";

/**
 * Keeps the app-wide team emoji registry (used by getTeamEmoji) in sync with
 * ffwr_teams.emoji. Renders nothing. Must sit inside <AppProvider>, before the
 * page content, so emojis are registered before sibling components render.
 */
export default function TeamEmojiSync() {
  const { data } = useApiData("GetTeams", {});
  useMemo(() => {
    if (data?.teams) registerTeamEmojis(data.teams);
  }, [data?.teams]);
  return null;
}
