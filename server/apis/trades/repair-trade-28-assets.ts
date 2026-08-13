import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "RepairTrade28Assets",
  description: "Inserts 3 missing assets for trade #28 (2024-25).",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
    assetsInserted: z.number(),
    verification: z.object({
      totalAssets: z.number(),
      teamsWithAssets: z.number(),
    }),
  }),

  async run(ctx) {
    // Trade #28 (2024-25): Adam (6) ↔ JT (1), trade_id = 521
    // Currently missing: pick 125 from Adam, picks 20 and 94 from JT
    const TRADE_ID = 521;

    // Verify current state
    const before = await ctx.integrations.apps_db.query(
      `SELECT COUNT(*) as cnt, COUNT(DISTINCT from_team_id) as teams
       FROM ffwr_trade_assets WHERE trade_id = $1`,
      z.object({ cnt: z.coerce.number(), teams: z.coerce.number() }),
      [TRADE_ID],
      { label: "Check trade 521 before repair" }
    );

    if (before[0].cnt !== 2 || before[0].teams !== 1) {
      return {
        message: `Trade already has ${before[0].cnt} assets from ${before[0].teams} teams — skipping repair to avoid duplicates.`,
        assetsInserted: 0,
        verification: { totalAssets: before[0].cnt, teamsWithAssets: before[0].teams },
      };
    }

    // Insert missing pick #125 (Rd 12) from Adam (team 6)
    await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, pick_year, pick_round, pick_number, recipient_team_id)
       VALUES ($1, $2, 'pick', $3, $4, $5, $6)`,
      [TRADE_ID, 6, 2025, 12, 125, 1],
      { label: "Insert Adam pick #125" }
    );

    // Insert missing pick #20 (Rd 2) from JT (team 1)
    await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, pick_year, pick_round, pick_number, recipient_team_id)
       VALUES ($1, $2, 'pick', $3, $4, $5, $6)`,
      [TRADE_ID, 1, 2025, 2, 20, 6],
      { label: "Insert JT pick #20" }
    );

    // Insert missing pick #94 (Rd 9) from JT (team 1)
    await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, pick_year, pick_round, pick_number, recipient_team_id)
       VALUES ($1, $2, 'pick', $3, $4, $5, $6)`,
      [TRADE_ID, 1, 2025, 9, 94, 6],
      { label: "Insert JT pick #94" }
    );

    // Verify after repair
    const after = await ctx.integrations.apps_db.query(
      `SELECT COUNT(*) as cnt, COUNT(DISTINCT from_team_id) as teams
       FROM ffwr_trade_assets WHERE trade_id = $1`,
      z.object({ cnt: z.coerce.number(), teams: z.coerce.number() }),
      [TRADE_ID],
      { label: "Verify trade 521 after repair" }
    );

    return {
      message: `Repaired trade #28 (2024-25): inserted 3 missing assets. Now has ${after[0].cnt} assets from ${after[0].teams} teams.`,
      assetsInserted: 3,
      verification: { totalAssets: after[0].cnt, teamsWithAssets: after[0].teams },
    };
  },
});
