import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitExchangeAdp",
  description: "Creates the ffwr_exchange_adp table for Exchange-specific ADP data.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
  }),

  async run(ctx) {
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_exchange_adp (
        id SERIAL PRIMARY KEY,
        player_name TEXT NOT NULL,
        position TEXT NOT NULL,
        adp_rank NUMERIC NOT NULL,
        nfl_team TEXT,
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      undefined,
      { label: "Create ffwr_exchange_adp table" },
    );

    // Add index for fast player lookups
    await ctx.integrations.apps_db.execute(
      `CREATE INDEX IF NOT EXISTS idx_exchange_adp_player
       ON ffwr_exchange_adp (player_name)`,
      undefined,
      { label: "Create player name index" },
    );

    return { message: "Exchange ADP table initialized." };
  },
});
