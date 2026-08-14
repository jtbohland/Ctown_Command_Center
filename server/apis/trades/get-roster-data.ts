import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const RosterPlayerSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  nfl_team: z.string(),
  adp_rank: z.coerce.number().nullable(),
  positional_rank: z.coerce.number().nullable(),
  roster_team_id: z.coerce.number().nullable(),
  is_keeper: z.coerce.boolean(),
  team_name: z.string().nullable(),
  manager_name: z.string().nullable(),
});

const DraftPickCapitalSchema = z.object({
  round: z.coerce.number(),
  pick_in_round: z.coerce.number(),
  overall_pick: z.coerce.number(),
  team_id: z.coerce.number(),
  team_name: z.string(),
  manager_name: z.string(),
  player_id: z.coerce.number().nullable(),
  is_complete: z.coerce.boolean(),
});

const ColCheckSchema = z.object({ exists: z.coerce.boolean() });

export default api({
  name: "GetRosterData",
  description: "Fetches all rostered players with team assignments, plus 2026 draft picks for Treasury.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    rosterPlayers: z.array(RosterPlayerSchema),
    draftPicks2026: z.array(DraftPickCapitalSchema),
  }),

  async run(ctx) {
    // Check if roster_team_id column exists (it gets created by SeedRosters)
    const [{ exists: colExists }] = await ctx.integrations.apps_db.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'ffwr_players' AND column_name = 'roster_team_id'
       ) AS exists`,
      ColCheckSchema,
      undefined,
      { label: "Check if roster_team_id column exists" }
    );

    let rosterPlayers: z.infer<typeof RosterPlayerSchema>[] = [];

    if (colExists) {
      // Fetch all players with roster assignments
      rosterPlayers = await ctx.integrations.apps_db.query(
        `SELECT p.id, p.name, p.position, p.nfl_team, p.adp_rank,
                p.positional_rank, p.roster_team_id, p.is_keeper,
                t.team_name, t.manager_name
         FROM ffwr_players p
         LEFT JOIN ffwr_teams t ON t.id = p.roster_team_id
         WHERE p.roster_team_id IS NOT NULL
         ORDER BY t.manager_name, 
           CASE p.position WHEN 'QB' THEN 1 WHEN 'RB' THEN 2 WHEN 'WR' THEN 3 WHEN 'TE' THEN 4 ELSE 5 END,
           p.adp_rank ASC NULLS LAST
         LIMIT 500`,
        RosterPlayerSchema,
        undefined,
        { label: "Fetch all rostered players" }
      );
    }

    // Fetch 2026 draft picks for Treasury (from draft board)
    const draftPicks2026 = await ctx.integrations.apps_db.query(
      `SELECT dp.round, dp.pick_in_round, dp.overall_pick,
              dp.team_id, t.team_name, t.manager_name,
              dp.player_id, dp.is_complete
       FROM ffwr_draft_picks dp
       JOIN ffwr_teams t ON t.id = dp.team_id
       ORDER BY dp.round, dp.pick_in_round
       LIMIT 200`,
      DraftPickCapitalSchema,
      undefined,
      { label: "Fetch 2026 draft picks for Treasury" }
    );

    return { rosterPlayers, draftPicks2026 };
  },
});
