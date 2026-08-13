import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "GetLoadedActualSeasons",
  description: "Returns a list of seasons already loaded in ffwr_season_actuals with row counts.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    seasons: z.array(
      z.object({
        season: z.string(),
        playerCount: z.number(),
      })
    ),
  }),

  async run(ctx) {
    const rows = await ctx.integrations.apps_db.query(
      `SELECT season, COUNT(*)::int as player_count
       FROM ffwr_season_actuals
       GROUP BY season
       ORDER BY season
       LIMIT 50`,
      z.object({ season: z.string(), player_count: z.number() }),
      undefined,
      { label: "Get loaded actual seasons" },
    );

    return {
      seasons: rows.map((r) => ({
        season: r.season,
        playerCount: r.player_count,
      })),
    };
  },
});
