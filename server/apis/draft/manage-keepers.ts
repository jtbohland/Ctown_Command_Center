import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "ManageKeepers",
  description: "Adds, removes, or swaps a keeper assignment for a team.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    action: z.enum(["add", "remove", "swap"]),
    playerId: z.number(),
    teamId: z.number(),
    newPlayerId: z.number().optional(),
  }),

  output: z.object({
    success: z.boolean(),
    message: z.string(),
  }),

  async run(ctx, { action, playerId, teamId, newPlayerId }) {
    if (action === "add") {
      const countResult = await ctx.integrations.apps_db.query(
        "SELECT COUNT(*) as cnt FROM ffwr_players WHERE is_keeper = true AND keeper_team_id = $1",
        z.object({ cnt: z.coerce.number() }),
        [teamId],
        { label: "Check keeper count" },
      );
      if (countResult[0].cnt >= 4) {
        throw new Error("Team already has 4 keepers. Remove one first.");
      }

      const playerResult = await ctx.integrations.apps_db.query(
        "SELECT is_keeper, name FROM ffwr_players WHERE id = $1",
        z.object({
          is_keeper: z.union([z.boolean(), z.literal("t"), z.literal("f")]).transform((v) => v === true || v === "t"),
          name: z.string(),
        }),
        [playerId],
        { label: "Check player keeper status" },
      );
      if (playerResult.length === 0) throw new Error("Player not found.");
      if (playerResult[0].is_keeper) throw new Error(`${playerResult[0].name} is already a keeper.`);

      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players
         SET is_keeper = true, keeper_team_id = $1, is_drafted = true, drafted_team_id = $1
         WHERE id = $2`,
        [teamId, playerId],
        { label: `Add keeper: player ${playerId} → team ${teamId}` },
      );

      return { success: true, message: `${playerResult[0].name} added as keeper.` };
    }

    if (action === "remove") {
      const playerResult = await ctx.integrations.apps_db.query(
        "SELECT name FROM ffwr_players WHERE id = $1",
        z.object({ name: z.string() }),
        [playerId],
        { label: "Get player name" },
      );
      if (playerResult.length === 0) throw new Error("Player not found.");

      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players
         SET is_keeper = false, keeper_team_id = NULL, is_drafted = false, drafted_team_id = NULL
         WHERE id = $1`,
        [playerId],
        { label: `Remove keeper: player ${playerId}` },
      );

      return { success: true, message: `${playerResult[0].name} removed as keeper.` };
    }

    if (action === "swap") {
      if (!newPlayerId) throw new Error("newPlayerId required for swap action.");

      const oldPlayer = await ctx.integrations.apps_db.query(
        "SELECT name FROM ffwr_players WHERE id = $1",
        z.object({ name: z.string() }),
        [playerId],
        { label: "Get old keeper name" },
      );
      if (oldPlayer.length === 0) throw new Error("Old player not found.");

      const newPlayer = await ctx.integrations.apps_db.query(
        "SELECT name, is_keeper FROM ffwr_players WHERE id = $1",
        z.object({
          name: z.string(),
          is_keeper: z.union([z.boolean(), z.literal("t"), z.literal("f")]).transform((v) => v === true || v === "t"),
        }),
        [newPlayerId],
        { label: "Get new keeper info" },
      );
      if (newPlayer.length === 0) throw new Error("New player not found.");
      if (newPlayer[0].is_keeper) throw new Error(`${newPlayer[0].name} is already a keeper on another team.`);

      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players
         SET is_keeper = false, keeper_team_id = NULL, is_drafted = false, drafted_team_id = NULL
         WHERE id = $1`,
        [playerId],
        { label: `Remove old keeper: ${oldPlayer[0].name}` },
      );

      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players
         SET is_keeper = true, keeper_team_id = $1, is_drafted = true, drafted_team_id = $1
         WHERE id = $2`,
        [teamId, newPlayerId],
        { label: `Add new keeper: ${newPlayer[0].name}` },
      );

      return { success: true, message: `Swapped ${oldPlayer[0].name} → ${newPlayer[0].name} as keeper.` };
    }

    throw new Error("Invalid action.");
  },
});
