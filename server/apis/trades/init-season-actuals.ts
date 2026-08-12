import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitSeasonActuals",
  description: "Creates the ffwr_season_actuals table for storing PPR scoring leader data by season.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
  }),

  async run(ctx) {
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_season_actuals (
        id SERIAL PRIMARY KEY,
        season TEXT NOT NULL,
        overall_rank INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        nfl_team TEXT,
        position TEXT NOT NULL,
        games_played INTEGER NOT NULL DEFAULT 0,
        avg_points NUMERIC(6,2),
        total_points NUMERIC(8,2),
        positional_rank INTEGER,
        week_1 NUMERIC(5,2),
        week_2 NUMERIC(5,2),
        week_3 NUMERIC(5,2),
        week_4 NUMERIC(5,2),
        week_5 NUMERIC(5,2),
        week_6 NUMERIC(5,2),
        week_7 NUMERIC(5,2),
        week_8 NUMERIC(5,2),
        week_9 NUMERIC(5,2),
        week_10 NUMERIC(5,2),
        week_11 NUMERIC(5,2),
        week_12 NUMERIC(5,2),
        week_13 NUMERIC(5,2),
        week_14 NUMERIC(5,2),
        week_15 NUMERIC(5,2),
        week_16 NUMERIC(5,2),
        week_17 NUMERIC(5,2),
        week_18 NUMERIC(5,2),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(season, player_name, position)
      )`,
      undefined,
      { label: "Create ffwr_season_actuals table" },
    );

    return { message: "ffwr_season_actuals table created successfully" };
  },
});
