import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const DraftPickSchema = z.object({
  id: z.coerce.number(),
  round: z.coerce.number(),
  pick_in_round: z.coerce.number(),
  overall_pick: z.coerce.number(),
  team_id: z.coerce.number(),
  team_name: z.string(),
  team_color: z.string(),
  is_my_team: z.coerce.boolean(),
  player_id: z.coerce.number().nullable(),
  player_name: z.string().nullable(),
  player_position: z.string().nullable(),
  player_nfl_team: z.string().nullable(),
  is_complete: z.coerce.boolean(),
});

export default api({
  name: "GetDraftPicks",
  description: "Fetches all draft picks with team and player info.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    picks: z.array(DraftPickSchema),
  }),

  async run(ctx) {
    const picks = await ctx.integrations.apps_db.query(
      `SELECT dp.id, dp.round, dp.pick_in_round, dp.overall_pick, dp.team_id,
              t.team_name, t.color as team_color, CASE WHEN t.is_my_team THEN true ELSE false END as is_my_team,
              dp.player_id, p.name as player_name, p.position as player_position, p.nfl_team as player_nfl_team,
              CASE WHEN dp.is_complete THEN true ELSE false END as is_complete
       FROM ffwr_draft_picks dp
       JOIN ffwr_teams t ON t.id = dp.team_id
       LEFT JOIN ffwr_players p ON p.id = dp.player_id
       ORDER BY dp.overall_pick`,
      DraftPickSchema,
      undefined,
      { label: "Fetch all draft picks" }
    );

    return { picks };
  },
});
