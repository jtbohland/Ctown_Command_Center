import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitWaiverTransactions",
  description: "Creates the ffwr_waiver_transactions table for tracking waiver wire moves.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
  }),

  async run(ctx) {
    requireAdmin(ctx, "initialize the waiver transactions table");

    await ctx.integrations.apps_db.execute(`
      CREATE TABLE IF NOT EXISTS ffwr_waiver_transactions (
        id SERIAL PRIMARY KEY,
        season TEXT NOT NULL,
        transaction_date DATE NOT NULL,
        transaction_time TEXT,
        transaction_ts TIMESTAMPTZ,
        manager_name TEXT NOT NULL,
        team_id INT,
        added_player_name TEXT,
        added_player_position TEXT,
        added_player_nfl_team TEXT,
        added_player_id INT,
        dropped_player_name TEXT,
        dropped_player_position TEXT,
        dropped_player_nfl_team TEXT,
        dropped_player_id INT,
        dedup_hash TEXT NOT NULL,
        processed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, undefined, { label: "Create ffwr_waiver_transactions table" });

    // Add unique constraint on dedup_hash for idempotent inserts
    await ctx.integrations.apps_db.execute(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'ffwr_waiver_transactions_dedup_hash_key'
        ) THEN
          ALTER TABLE ffwr_waiver_transactions
            ADD CONSTRAINT ffwr_waiver_transactions_dedup_hash_key UNIQUE (dedup_hash);
        END IF;
      END $$
    `, undefined, { label: "Add unique constraint on dedup_hash" });

    // Index on season + team_id for efficient filtering
    await ctx.integrations.apps_db.execute(`
      CREATE INDEX IF NOT EXISTS idx_ffwr_waiver_season_team
        ON ffwr_waiver_transactions (season, team_id)
    `, undefined, { label: "Create season+team index" });

    ctx.log.info("ffwr_waiver_transactions table initialized");
    return { message: "Waiver transactions table created successfully." };
  },
});
