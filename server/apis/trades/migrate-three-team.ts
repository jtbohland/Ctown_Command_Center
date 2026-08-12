import { api, z, postgres } from "@superblocksteam/sdk-api";

const APP_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "MigrateThreeTeam",
  description: "Adds three-team trade schema columns to ffwr_trades and ffwr_trade_assets.",

  integrations: {
    app_db: postgres(APP_DB),
  },

  input: z.object({}),

  output: z.object({
    success: z.boolean(),
    tradesColumnsAdded: z.array(z.string()),
    assetsColumnsAdded: z.array(z.string()),
  }),

  async run(ctx) {
    ctx.log.info("Starting three-team schema migration");

    // Add columns to ffwr_trades
    await ctx.integrations.app_db.execute(
      `ALTER TABLE ffwr_trades
       ADD COLUMN IF NOT EXISTS trade_type text,
       ADD COLUMN IF NOT EXISTS participant_count integer,
       ADD COLUMN IF NOT EXISTS team_c_id integer REFERENCES ffwr_teams(id),
       ADD COLUMN IF NOT EXISTS three_team_complete boolean,
       ADD COLUMN IF NOT EXISTS valuation_complete boolean`,
      undefined,
      { label: "Add three-team columns to ffwr_trades" }
    );

    // Add columns to ffwr_trade_assets
    await ctx.integrations.app_db.execute(
      `ALTER TABLE ffwr_trade_assets
       ADD COLUMN IF NOT EXISTS recipient_team_id integer REFERENCES ffwr_teams(id),
       ADD COLUMN IF NOT EXISTS destination_explicit boolean`,
      undefined,
      { label: "Add recipient columns to ffwr_trade_assets" }
    );

    ctx.log.info("Schema migration complete");

    return {
      success: true,
      tradesColumnsAdded: ["trade_type", "participant_count", "team_c_id", "three_team_complete", "valuation_complete"],
      assetsColumnsAdded: ["recipient_team_id", "destination_explicit"],
    };
  },
});
