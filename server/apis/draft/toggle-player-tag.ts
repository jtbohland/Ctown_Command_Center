import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "TogglePlayerTag",
  description: "Adds or removes an emoji tag on a player.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    playerId: z.number(),
    tag: z.string(),
  }),

  output: z.object({
    action: z.enum(["added", "removed"]),
  }),

  async run(ctx, { playerId, tag }) {
    // Check if tag exists
    const existing = await ctx.integrations.apps_db.query(
      "SELECT id FROM ffwr_player_tags WHERE player_id = $1 AND tag = $2",
      z.object({ id: z.coerce.number() }),
      [playerId, tag],
      { label: "Check existing tag" }
    );

    if (existing.length > 0) {
      await ctx.integrations.apps_db.execute(
        "DELETE FROM ffwr_player_tags WHERE player_id = $1 AND tag = $2",
        [playerId, tag],
        { label: "Remove tag" }
      );
      return { action: "removed" as const };
    } else {
      await ctx.integrations.apps_db.execute(
        "INSERT INTO ffwr_player_tags (player_id, tag) VALUES ($1, $2)",
        [playerId, tag],
        { label: "Add tag" }
      );
      return { action: "added" as const };
    }
  },
});
