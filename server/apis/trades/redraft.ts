import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const ColCheckSchema = z.object({ exists: z.coerce.boolean() });
const CountSchema = z.object({ count: z.coerce.number() });

export default api({
  name: "Redraft",
  description: "Clears non-keeper roster assignments to reset between seasons.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    cleared: z.number(),
    keepersRetained: z.number(),
    message: z.string(),
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

    if (!colExists) {
      return {
        cleared: 0,
        keepersRetained: 0,
        message: "No roster data found. Run SeedRosters first to create the roster_team_id column.",
      };
    }

    // Count keepers that will be retained
    const [{ count: keepersRetained }] = await ctx.integrations.apps_db.query(
      `SELECT COUNT(*)::int AS count FROM ffwr_players
       WHERE is_keeper = true AND keeper_team_id IS NOT NULL AND roster_team_id IS NOT NULL`,
      CountSchema,
      undefined,
      { label: "Count keepers to retain" }
    );

    // Count non-keeper rostered players that will be cleared
    const [{ count: toClear }] = await ctx.integrations.apps_db.query(
      `SELECT COUNT(*)::int AS count FROM ffwr_players
       WHERE roster_team_id IS NOT NULL AND (is_keeper = false OR is_keeper IS NULL)`,
      CountSchema,
      undefined,
      { label: "Count non-keepers to clear" }
    );

    // Clear non-keeper roster assignments
    await ctx.integrations.apps_db.execute(
      `UPDATE ffwr_players SET roster_team_id = NULL
       WHERE roster_team_id IS NOT NULL AND (is_keeper = false OR is_keeper IS NULL)`,
      undefined,
      { label: "Clear non-keeper roster assignments" }
    );

    return {
      cleared: toClear,
      keepersRetained,
      message: `Redraft complete: cleared ${toClear} roster spots. ${keepersRetained} keepers retained.`,
    };
  },
});
