import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "DedupTrades",
  description: "Removes duplicate trades keeping the lowest-id copy",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    duplicateTradesRemoved: z.number(),
    orphanedAssetsRemoved: z.number(),
    finalTradeCount: z.coerce.number(),
    finalAssetCount: z.coerce.number(),
  }),

  async run(ctx) {
    // Step 1: Find duplicate trade IDs (keep the one with the lowest id)
    const dupes = await ctx.integrations.apps_db.query(
      `SELECT id FROM ffwr_trades t
       WHERE EXISTS (
         SELECT 1 FROM ffwr_trades t2
         WHERE t2.season = t.season
           AND t2.trade_number = t.trade_number
           AND t2.id < t.id
       )`,
      z.object({ id: z.coerce.number() }),
      [],
      { label: "Find duplicate trade rows" }
    );

    if (dupes.length === 0) {
      const counts = await ctx.integrations.apps_db.query(
        `SELECT
           (SELECT COUNT(*) FROM ffwr_trades) AS tc,
           (SELECT COUNT(*) FROM ffwr_trade_assets) AS ac`,
        z.object({ tc: z.coerce.number(), ac: z.coerce.number() }),
        [],
        { label: "Count trades/assets (no dupes)" }
      );
      return {
        duplicateTradesRemoved: 0,
        orphanedAssetsRemoved: 0,
        finalTradeCount: counts[0].tc,
        finalAssetCount: counts[0].ac,
      };
    }

    const dupeIds = dupes.map((d) => d.id);

    // Step 2: Delete assets belonging to duplicate trades
    const assetResult = await ctx.integrations.apps_db.execute(
      `DELETE FROM ffwr_trade_assets WHERE trade_id = ANY($1::int[])`,
      [dupeIds],
      { label: "Delete assets for duplicate trades" }
    );

    // Step 3: Delete the duplicate trade rows
    const tradeResult = await ctx.integrations.apps_db.execute(
      `DELETE FROM ffwr_trades WHERE id = ANY($1::int[])`,
      [dupeIds],
      { label: "Delete duplicate trade rows" }
    );

    // Step 4: Verify final counts
    const counts = await ctx.integrations.apps_db.query(
      `SELECT
         (SELECT COUNT(*) FROM ffwr_trades) AS tc,
         (SELECT COUNT(*) FROM ffwr_trade_assets) AS ac`,
      z.object({ tc: z.coerce.number(), ac: z.coerce.number() }),
      [],
      { label: "Final count verification" }
    );

    return {
      duplicateTradesRemoved: tradeResult.rowCount,
      orphanedAssetsRemoved: assetResult.rowCount,
      finalTradeCount: counts[0].tc,
      finalAssetCount: counts[0].ac,
    };
  },
});
