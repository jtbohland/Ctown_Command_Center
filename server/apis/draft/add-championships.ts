import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

/**
 * One-time migration: adds championships column and seeds counts.
 * Safe to re-run — uses IF NOT EXISTS and UPSERT-style UPDATE.
 */
export default api({
  name: "AddChampionships",
  description: "Adds championships column to ffwr_teams and populates counts.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
    updated: z.number(),
  }),

  async run(ctx) {
    requireAdmin(ctx, "add championship data");

    // 1. Ensure column exists
    await ctx.integrations.apps_db.execute(
      `DO $$ BEGIN
        ALTER TABLE ffwr_teams ADD COLUMN IF NOT EXISTS championships INT NOT NULL DEFAULT 0;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$`,
      undefined,
      { label: "Ensure championships column" },
    );

    // 2. Populate championship counts by manager name
    const champData: [string, number][] = [
      ["JT", 3],
      ["Adam", 3],
      ["Brooke", 3],
      ["AJ", 3],
      ["Jordan", 2],
      ["Chuck", 2],
      ["Drew", 1],
      ["Erik", 1],
      ["Jimmy", 1],
      ["Tyler", 0],
      ["Carson", 0],
    ];

    let totalUpdated = 0;
    for (const [manager, count] of champData) {
      const result = await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_teams SET championships = $1 WHERE manager_name = $2`,
        [count, manager],
        { label: `Set championships for ${manager}` },
      );
      totalUpdated += result.rowCount;
    }

    return {
      message: `Championships column added and ${totalUpdated} teams updated.`,
      updated: totalUpdated,
    };
  },
});
