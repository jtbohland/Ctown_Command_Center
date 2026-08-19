import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const TeamSchema = z.object({
  id: z.coerce.number(),
  team_name: z.string(),
  manager_name: z.string(),
  color: z.string(),
  secondary_color: z.string().nullable(),
  logo_url: z.string().nullable(),
  draft_position: z.coerce.number().nullable(),
  is_my_team: z.coerce.boolean(),
  championships: z.coerce.number(),
});

export default api({
  name: "GetTeams",
  description: "Fetches all teams in the league.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    teams: z.array(TeamSchema),
  }),

  async run(ctx) {
    const teams = await ctx.integrations.apps_db.query(
      "SELECT id, team_name, manager_name, color, secondary_color, logo_url, draft_position, CASE WHEN is_my_team THEN true ELSE false END as is_my_team, COALESCE(championships, 0) as championships FROM ffwr_teams ORDER BY draft_position",
      TeamSchema,
      undefined,
      { label: "Fetch all teams" }
    );

    return { teams };
  },
});
