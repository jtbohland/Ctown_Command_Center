import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "GetLoadedActualSeasons",
  description: "Returns seasons loaded in ffwr_season_actuals with row counts and highest week with data.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    seasons: z.array(
      z.object({
        season: z.string(),
        playerCount: z.number(),
        throughWeek: z.number().nullable(),
      })
    ),
  }),

  async run(ctx) {
    const rows = await ctx.integrations.apps_db.query(
      `SELECT
         season,
         COUNT(*)::int AS player_count,
         GREATEST(
           CASE WHEN COUNT(*) FILTER (WHERE week_18 IS NOT NULL) > 0 THEN 18 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_17 IS NOT NULL) > 0 THEN 17 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_16 IS NOT NULL) > 0 THEN 16 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_15 IS NOT NULL) > 0 THEN 15 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_14 IS NOT NULL) > 0 THEN 14 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_13 IS NOT NULL) > 0 THEN 13 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_12 IS NOT NULL) > 0 THEN 12 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_11 IS NOT NULL) > 0 THEN 11 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_10 IS NOT NULL) > 0 THEN 10 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_9 IS NOT NULL) > 0 THEN 9 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_8 IS NOT NULL) > 0 THEN 8 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_7 IS NOT NULL) > 0 THEN 7 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_6 IS NOT NULL) > 0 THEN 6 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_5 IS NOT NULL) > 0 THEN 5 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_4 IS NOT NULL) > 0 THEN 4 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_3 IS NOT NULL) > 0 THEN 3 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_2 IS NOT NULL) > 0 THEN 2 ELSE 0 END,
           CASE WHEN COUNT(*) FILTER (WHERE week_1 IS NOT NULL) > 0 THEN 1 ELSE 0 END
         )::int AS through_week
       FROM ffwr_season_actuals
       GROUP BY season
       ORDER BY season
       LIMIT 50`,
      z.object({
        season: z.string(),
        player_count: z.number(),
        through_week: z.number(),
      }),
      undefined,
      { label: "Get loaded actual seasons with week freshness" },
    );

    return {
      seasons: rows.map((r) => ({
        season: r.season,
        playerCount: r.player_count,
        throughWeek: r.through_week > 0 ? r.through_week : null,
      })),
    };
  },
});
