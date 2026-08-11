import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "UndoDraftPick",
  description: "Undoes a draft pick, marking the player as available again.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    pickId: z.number(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { pickId }) {
    // Get the current player on this pick
    const picks = await ctx.integrations.apps_db.query(
      "SELECT player_id FROM ffwr_draft_picks WHERE id = $1",
      z.object({ player_id: z.coerce.number().nullable() }),
      [pickId],
      { label: "Get pick player" }
    );

    if (picks.length === 0) throw new Error("Pick not found");

    const playerId = picks[0].player_id;
    if (playerId) {
      // Un-draft the player
      await ctx.integrations.apps_db.execute(
        "UPDATE ffwr_players SET is_drafted = false, drafted_team_id = NULL, drafted_round = NULL, drafted_pick = NULL WHERE id = $1",
        [playerId],
        { label: "Un-draft player" }
      );
    }

    // Clear the pick
    await ctx.integrations.apps_db.execute(
      "UPDATE ffwr_draft_picks SET player_id = NULL, is_complete = false WHERE id = $1",
      [pickId],
      { label: "Clear draft pick" }
    );

    return { success: true };
  },
});
