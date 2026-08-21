import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "DraftPlayer",
  description: "Assigns a player to a draft pick and marks them as drafted.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    playerId: z.number(),
    pickId: z.number(),
  }),

  output: z.object({
    success: z.boolean(),
  }),

  async run(ctx, { playerId, pickId }) {
    requireAdmin(ctx, "draft a player");

    // Get the pick info
    const picks = await ctx.integrations.apps_db.query(
      "SELECT team_id, round, pick_in_round FROM ffwr_draft_picks WHERE id = $1",
      z.object({ team_id: z.coerce.number(), round: z.coerce.number(), pick_in_round: z.coerce.number() }),
      [pickId],
      { label: "Get pick info" }
    );

    if (picks.length === 0) {
      throw new Error("Pick not found");
    }

    const pick = picks[0];

    // Update the draft pick
    await ctx.integrations.apps_db.execute(
      "UPDATE ffwr_draft_picks SET player_id = $1, is_complete = true WHERE id = $2",
      [playerId, pickId],
      { label: "Assign player to pick" }
    );

    // Mark the player as drafted + assign to roster
    await ctx.integrations.apps_db.execute(
      "UPDATE ffwr_players SET is_drafted = true, drafted_team_id = $1, drafted_round = $2, drafted_pick = $3, roster_team_id = $1 WHERE id = $4",
      [pick.team_id, pick.round, pick.pick_in_round, playerId],
      { label: "Mark player as drafted + roster sync" }
    );

    return { success: true };
  },
});
