import { api, z, postgres } from "@superblocksteam/sdk-api";

const APP_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "BackfillTwoTeamDefaults",
  description: "Backfills all existing trades with two-team default values for new columns.",

  integrations: {
    app_db: postgres(APP_DB),
  },

  input: z.object({}),

  output: z.object({
    tradesUpdated: z.coerce.number(),
    assetsUpdated: z.coerce.number(),
    beforeSample: z.array(z.object({
      id: z.coerce.number(),
      trade_type: z.string().nullable(),
      participant_count: z.coerce.number().nullable(),
    })),
    afterSample: z.array(z.object({
      id: z.coerce.number(),
      trade_type: z.string().nullable(),
      participant_count: z.coerce.number().nullable(),
    })),
  }),

  async run(ctx) {
    ctx.log.info("Starting two-team defaults backfill");

    // Sample before state
    const beforeSample = await ctx.integrations.app_db.query(
      `SELECT id, trade_type, participant_count FROM ffwr_trades ORDER BY id LIMIT 5`,
      z.object({
        id: z.coerce.number(),
        trade_type: z.string().nullable(),
        participant_count: z.coerce.number().nullable(),
      }),
      undefined,
      { label: "Sample trades before backfill" }
    );

    // Backfill ffwr_trades: set all NULL trade_type to 'two_team', participant_count to 2
    const tradesResult = await ctx.integrations.app_db.execute(
      `UPDATE ffwr_trades
       SET trade_type = 'two_team',
           participant_count = 2,
           three_team_complete = NULL,
           valuation_complete = NULL
       WHERE trade_type IS NULL`,
      undefined,
      { label: "Backfill trades with two-team defaults" }
    );

    // Backfill ffwr_trade_assets: for two-team trades, recipient is the OTHER team
    // In a 2-team trade (team_a vs team_b), assets from team_a go to team_b and vice versa
    const assetsResult = await ctx.integrations.app_db.execute(
      `UPDATE ffwr_trade_assets a
       SET recipient_team_id = CASE
             WHEN a.from_team_id = t.team_a_id THEN t.team_b_id
             WHEN a.from_team_id = t.team_b_id THEN t.team_a_id
             ELSE NULL
           END,
           destination_explicit = false
       FROM ffwr_trades t
       WHERE a.trade_id = t.id
         AND a.recipient_team_id IS NULL
         AND t.trade_type = 'two_team'`,
      undefined,
      { label: "Backfill asset recipients for two-team trades" }
    );

    // Sample after state
    const afterSample = await ctx.integrations.app_db.query(
      `SELECT id, trade_type, participant_count FROM ffwr_trades ORDER BY id LIMIT 5`,
      z.object({
        id: z.coerce.number(),
        trade_type: z.string().nullable(),
        participant_count: z.coerce.number().nullable(),
      }),
      undefined,
      { label: "Sample trades after backfill" }
    );

    ctx.log.info("Backfill complete", {
      tradesUpdated: tradesResult.rowCount,
      assetsUpdated: assetsResult.rowCount,
    });

    return {
      tradesUpdated: tradesResult.rowCount,
      assetsUpdated: assetsResult.rowCount,
      beforeSample,
      afterSample,
    };
  },
});
