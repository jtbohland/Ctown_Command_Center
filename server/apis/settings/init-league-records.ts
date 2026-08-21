import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitLeagueRecords",
  description: "Creates the ffwr_league_records table for CSV archive storage.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
  }),

  async run(ctx) {
    requireAdmin(ctx, "initialize the league records table");

    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_league_records (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        season VARCHAR(20),
        filename VARCHAR(255) NOT NULL,
        file_content TEXT NOT NULL,
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        uploaded_by VARCHAR(255),
        notes TEXT
      )`,
      undefined,
      { label: "Create ffwr_league_records table" }
    );

    return { message: "League records table ready." };
  },
});
