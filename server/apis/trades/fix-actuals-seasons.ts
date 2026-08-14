import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

/**
 * One-time migration: shift all season labels in ffwr_season_actuals forward
 * by one year. The original labels used the FantasyPros year as "end year"
 * but FantasyPros uses the START year (e.g. "2025" = the 2025-26 NFL season).
 *
 * Before: 2018-19 through 2024-25
 * After:  2019-20 through 2025-26
 */
export default api({
  name: "FixActualsSeasons",
  description: "Shifts actuals season labels forward one year to fix off-by-one.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    dryRun: z.boolean(),
  }),

  output: z.object({
    before: z.array(z.object({ season: z.string(), count: z.coerce.number() })),
    after: z.array(z.object({ season: z.string(), count: z.coerce.number() })),
    message: z.string(),
  }),

  async run(ctx, { dryRun }) {
    const RowSchema = z.object({ season: z.string(), count: z.coerce.number() });

    // Snapshot before
    const before = await ctx.integrations.apps_db.query(
      `SELECT season, COUNT(*)::int as count FROM ffwr_season_actuals GROUP BY season ORDER BY season LIMIT 20`,
      RowSchema,
      undefined,
      { label: "Snapshot seasons before migration" },
    );

    if (dryRun) {
      const shifted = before.map((r) => {
        const parts = r.season.split("-");
        const startYear = parseInt(parts[0], 10) + 1;
        const endSuffix = String(startYear + 1).slice(-2);
        return { season: `${startYear}-${endSuffix}`, count: r.count };
      });
      return {
        before,
        after: shifted,
        message: `Dry run: would shift ${before.length} seasons forward by 1 year.`,
      };
    }

    // Two-pass approach to avoid unique constraint conflicts:
    // Pass 1: rename to temporary labels (prefix with "TMP_")
    await ctx.integrations.apps_db.execute(
      `UPDATE ffwr_season_actuals SET season = 'TMP_' || season
       WHERE season IN ('2018-19','2019-20','2020-21','2021-22','2022-23','2023-24','2024-25')`,
      undefined,
      { label: "Pass 1: prefix all seasons with TMP_" },
    );

    // Pass 2: rename from temporary to final shifted labels
    await ctx.integrations.apps_db.execute(
      `UPDATE ffwr_season_actuals SET season = CASE season
        WHEN 'TMP_2024-25' THEN '2025-26'
        WHEN 'TMP_2023-24' THEN '2024-25'
        WHEN 'TMP_2022-23' THEN '2023-24'
        WHEN 'TMP_2021-22' THEN '2022-23'
        WHEN 'TMP_2020-21' THEN '2021-22'
        WHEN 'TMP_2019-20' THEN '2020-21'
        WHEN 'TMP_2018-19' THEN '2019-20'
      END
      WHERE season LIKE 'TMP_%'`,
      undefined,
      { label: "Pass 2: shift TMP_ seasons to final labels" },
    );

    // Snapshot after
    const after = await ctx.integrations.apps_db.query(
      `SELECT season, COUNT(*)::int as count FROM ffwr_season_actuals GROUP BY season ORDER BY season LIMIT 20`,
      RowSchema,
      undefined,
      { label: "Snapshot seasons after migration" },
    );

    return {
      before,
      after,
      message: `Shifted ${before.length} seasons forward by 1 year. Actuals now align with historical ADP.`,
    };
  },
});
