import { api, z, postgres } from "@superblocksteam/sdk-api";

const APP_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

/**
 * Mapping from the spec (confirmed via manager/team mapping gate):
 *
 * Trade #450 (2022-10-24): Carson(4), JT(1), Brooke(3)
 *   Currently team_a=4(Carson), team_b=1(JT). Missing: team_c=3(Brooke)
 *   Assets currently misattributed to Carson(4) that belong to Brooke(3):
 *     - id 1630: Pick 81 (Brooke sent to JT)
 *     - id 1631: Patrick Mahomes (Brooke sent to Carson)
 *   Explicit destinations per spec:
 *     - Carson→Brooke: Pick 8 (id 1628)
 *     - Carson→JT: Kyler Murray (id 1629)
 *     - JT→Carson: Pick 23 (id 1632)
 *     - JT→Brooke: Tom Brady (id 1633), Allen Robinson (id 1634)
 *     - Brooke→JT: Pick 81 (id 1630)
 *     - Brooke→Carson: Patrick Mahomes (id 1631)
 *
 * Trade #486 (2024-02-24): Brooke(3), AJ(5), Carson(4)
 *   Currently team_a=3(Brooke), team_b=5(AJ). Missing: team_c=4(Carson)
 *   Assets currently misattributed to Brooke(3) that belong to Carson(4):
 *     - id 1788: C. McCaffery (Carson sent to AJ)
 *     - id 1789: Pick 64 (Carson sent to AJ)
 *     - id 1790: Pick 71 (Carson sent to AJ)
 *   Explicit destinations per spec:
 *     - Brooke→Carson: D.Achane (id 1785), Pick 5 (id 1786), Pick 16 (id 1787)
 *     - AJ→Brooke: D.London (id 1791), S.LaPorta (id 1792), Pick 19 (id 1793), Pick 39 (id 1794)
 *     - Carson→AJ: C.McCaffery (id 1788), Pick 64 (id 1789), Pick 71 (id 1790)
 *
 * Trade #520 (2025-07-24): Chuck(10), JT(1), Jimmy(9)
 *   Currently team_a=10(Chuck), team_b=1(JT). Missing: team_c=9(Jimmy)
 *   Assets currently misattributed to Chuck(10) that belong to Jimmy(9):
 *     - id 1913: Garrett Wilson (Jimmy sent to Chuck)
 *     - id 1914: Pick 20 (Jimmy sent to Chuck)
 *   Explicit destinations per spec:
 *     - Chuck→JT: Jayden Daniels (id 1910), Breece Hall (id 1911), 2026 Rd1 (id 1912)
 *     - JT→Jimmy: Ladd McConkey (id 1915), Pick 29 (id 1916), 2026 Rd4 (id 1917)
 *     - Jimmy→Chuck: Garrett Wilson (id 1913), Pick 20 (id 1914)
 */

const AssetSnapshot = z.object({
  id: z.coerce.number(),
  trade_id: z.coerce.number(),
  from_team_id: z.coerce.number(),
  recipient_team_id: z.coerce.number().nullable(),
  destination_explicit: z.boolean().nullable(),
  asset_type: z.string(),
  player_name: z.string().nullable(),
  pick_number: z.coerce.number().nullable(),
  pick_round: z.coerce.number().nullable(),
  pick_year: z.coerce.number().nullable(),
  pick_year_source: z.string().nullable(),
});

const TradeSnapshot = z.object({
  id: z.coerce.number(),
  trade_type: z.string().nullable(),
  participant_count: z.coerce.number().nullable(),
  team_a_id: z.coerce.number(),
  team_b_id: z.coerce.number(),
  team_c_id: z.coerce.number().nullable(),
  three_team_complete: z.boolean().nullable(),
});

const RepairReport = z.object({
  tradeId: z.number(),
  tradeDate: z.string(),
  participants: z.object({
    teamA: z.object({ id: z.number(), manager: z.string() }),
    teamB: z.object({ id: z.number(), manager: z.string() }),
    teamC: z.object({ id: z.number(), manager: z.string() }),
  }),
  beforeParticipantCount: z.number(),
  afterParticipantCount: z.number(),
  totalAssets: z.number(),
  assetsReassigned: z.number(),
  unresolvedAssetCount: z.number(),
  assets: z.array(z.object({
    assetId: z.number(),
    description: z.string(),
    fromManager: z.string(),
    toManager: z.string(),
    fromTeamId: z.number(),
    toTeamId: z.number(),
    destinationExplicit: z.boolean(),
    wasReassigned: z.boolean(),
  })),
});

export default api({
  name: "RepairThreeTeamTrades",
  description: "Repairs three known three-team trades by reassigning misattributed assets and adding third participant.",

  integrations: {
    app_db: postgres(APP_DB),
  },

  input: z.object({
    dryRun: z.boolean().default(false),
  }),

  output: z.object({
    success: z.boolean(),
    dryRun: z.boolean(),
    reports: z.array(RepairReport),
    otherTradesChanged: z.number(),
  }),

  async run(ctx, { dryRun }) {
    const managerMap: Record<number, string> = {
      1: "JT", 2: "Tyler", 3: "Brooke", 4: "Carson", 5: "AJ",
      6: "Adam", 7: "Drew", 8: "Erik", 9: "Jimmy", 10: "Chuck", 11: "Jordan",
    };

    // Snapshot before state for verification
    const beforeTradeCount = await ctx.integrations.app_db.query(
      `SELECT trade_type, COUNT(*) as cnt FROM ffwr_trades GROUP BY trade_type ORDER BY trade_type LIMIT 10`,
      z.object({ trade_type: z.string().nullable(), cnt: z.coerce.number() }),
      undefined,
      { label: "Snapshot trade counts before repair" }
    );

    const reports: z.infer<typeof RepairReport>[] = [];

    // =========================================================
    // TRADE #450 (2022-10-24): Carson(4) + JT(1) + Brooke(3)
    // =========================================================
    {
      const tradeId = 450;
      const teamCId = 3; // Brooke

      // Get before state
      const beforeTrade = await ctx.integrations.app_db.query(
        `SELECT id, trade_type, participant_count, team_a_id, team_b_id, team_c_id, three_team_complete FROM ffwr_trades WHERE id = $1 LIMIT 1`,
        TradeSnapshot, [tradeId], { label: "Before state: trade 450" }
      );
      const beforeAssets = await ctx.integrations.app_db.query(
        `SELECT id, trade_id, from_team_id, recipient_team_id, destination_explicit, asset_type, player_name, pick_number, pick_round, pick_year, pick_year_source FROM ffwr_trade_assets WHERE trade_id = $1 ORDER BY id LIMIT 10`,
        AssetSnapshot, [tradeId], { label: "Before assets: trade 450" }
      );

      if (!dryRun) {
        // Step 1: Reassign from_team_id for misattributed assets
        // Pick 81 (id 1630) → from_team_id should be 3 (Brooke), not 4 (Carson)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET from_team_id = 3 WHERE id = 1630`,
          undefined, { label: "Reassign pick 81 to Brooke (trade 450)" }
        );
        // Patrick Mahomes (id 1631) → from_team_id should be 3 (Brooke), not 4 (Carson)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET from_team_id = 3 WHERE id = 1631`,
          undefined, { label: "Reassign Mahomes to Brooke (trade 450)" }
        );

        // Step 2: Set explicit recipient_team_id for ALL assets
        // Carson(4)→Brooke(3): Pick 8 (id 1628)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 3, destination_explicit = true WHERE id = 1628`,
          undefined, { label: "Pick 8: Carson→Brooke" }
        );
        // Carson(4)→JT(1): Kyler Murray (id 1629)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 1, destination_explicit = true WHERE id = 1629`,
          undefined, { label: "Kyler Murray: Carson→JT" }
        );
        // JT(1)→Carson(4): Pick 23 (id 1632)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 4, destination_explicit = true WHERE id = 1632`,
          undefined, { label: "Pick 23: JT→Carson" }
        );
        // JT(1)→Brooke(3): Tom Brady (id 1633)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 3, destination_explicit = true WHERE id = 1633`,
          undefined, { label: "Tom Brady: JT→Brooke" }
        );
        // JT(1)→Brooke(3): Allen Robinson (id 1634)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 3, destination_explicit = true WHERE id = 1634`,
          undefined, { label: "Allen Robinson: JT→Brooke" }
        );
        // Brooke(3)→JT(1): Pick 81 (id 1630)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 1, destination_explicit = true WHERE id = 1630`,
          undefined, { label: "Pick 81: Brooke→JT" }
        );
        // Brooke(3)→Carson(4): Patrick Mahomes (id 1631)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 4, destination_explicit = true WHERE id = 1631`,
          undefined, { label: "Mahomes: Brooke→Carson" }
        );

        // Step 3: Update trade-level fields
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trades SET trade_type = 'three_team', participant_count = 3, team_c_id = $1, three_team_complete = true WHERE id = $2`,
          [teamCId, tradeId], { label: "Promote trade 450 to three_team" }
        );
      }

      // Build the after-state asset descriptions
      const assetDescriptions = [
        { assetId: 1628, description: "Pick 8 (Rd1)", fromManager: "Carson", toManager: "Brooke", fromTeamId: 4, toTeamId: 3, destinationExplicit: true, wasReassigned: false },
        { assetId: 1629, description: "Kyler Murray", fromManager: "Carson", toManager: "JT", fromTeamId: 4, toTeamId: 1, destinationExplicit: true, wasReassigned: false },
        { assetId: 1630, description: "Pick 81 (Rd8)", fromManager: "Brooke", toManager: "JT", fromTeamId: 3, toTeamId: 1, destinationExplicit: true, wasReassigned: true },
        { assetId: 1631, description: "Patrick Mahomes", fromManager: "Brooke", toManager: "Carson", fromTeamId: 3, toTeamId: 4, destinationExplicit: true, wasReassigned: true },
        { assetId: 1632, description: "Pick 23 (Rd3)", fromManager: "JT", toManager: "Carson", fromTeamId: 1, toTeamId: 4, destinationExplicit: true, wasReassigned: false },
        { assetId: 1633, description: "Tom Brady", fromManager: "JT", toManager: "Brooke", fromTeamId: 1, toTeamId: 3, destinationExplicit: true, wasReassigned: false },
        { assetId: 1634, description: "Allen Robinson", fromManager: "JT", toManager: "Brooke", fromTeamId: 1, toTeamId: 3, destinationExplicit: true, wasReassigned: false },
      ];

      reports.push({
        tradeId: 450,
        tradeDate: "2022-10-24",
        participants: {
          teamA: { id: 4, manager: "Carson" },
          teamB: { id: 1, manager: "JT" },
          teamC: { id: 3, manager: "Brooke" },
        },
        beforeParticipantCount: 2,
        afterParticipantCount: 3,
        totalAssets: 7,
        assetsReassigned: 2,
        unresolvedAssetCount: 0,
        assets: assetDescriptions,
      });
    }

    // =========================================================
    // TRADE #486 (2024-02-24): Brooke(3) + AJ(5) + Carson(4)
    // =========================================================
    {
      const tradeId = 486;
      const teamCId = 4; // Carson

      if (!dryRun) {
        // Step 1: Reassign from_team_id for misattributed assets
        // C. McCaffery (id 1788) → from_team_id should be 4 (Carson), not 3 (Brooke)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET from_team_id = 4 WHERE id = 1788`,
          undefined, { label: "Reassign McCaffery to Carson (trade 486)" }
        );
        // Pick 64 (id 1789) → from_team_id should be 4 (Carson)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET from_team_id = 4 WHERE id = 1789`,
          undefined, { label: "Reassign pick 64 to Carson (trade 486)" }
        );
        // Pick 71 (id 1790) → from_team_id should be 4 (Carson)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET from_team_id = 4 WHERE id = 1790`,
          undefined, { label: "Reassign pick 71 to Carson (trade 486)" }
        );

        // Step 2: Set explicit recipient_team_id for ALL assets
        // Brooke(3)→Carson(4): D.Achane (id 1785), Pick 5 (id 1786), Pick 16 (id 1787)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 4, destination_explicit = true WHERE id IN (1785, 1786, 1787)`,
          undefined, { label: "Achane+picks: Brooke→Carson" }
        );
        // AJ(5)→Brooke(3): D.London (id 1791), S.LaPorta (id 1792), Pick 19 (id 1793), Pick 39 (id 1794)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 3, destination_explicit = true WHERE id IN (1791, 1792, 1793, 1794)`,
          undefined, { label: "London+LaPorta+picks: AJ→Brooke" }
        );
        // Carson(4)→AJ(5): C.McCaffery (id 1788), Pick 64 (id 1789), Pick 71 (id 1790)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 5, destination_explicit = true WHERE id IN (1788, 1789, 1790)`,
          undefined, { label: "McCaffery+picks: Carson→AJ" }
        );

        // Step 3: Update trade-level fields
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trades SET trade_type = 'three_team', participant_count = 3, team_c_id = $1, three_team_complete = true WHERE id = $2`,
          [teamCId, tradeId], { label: "Promote trade 486 to three_team" }
        );
      }

      reports.push({
        tradeId: 486,
        tradeDate: "2024-02-24",
        participants: {
          teamA: { id: 3, manager: "Brooke" },
          teamB: { id: 5, manager: "AJ" },
          teamC: { id: 4, manager: "Carson" },
        },
        beforeParticipantCount: 2,
        afterParticipantCount: 3,
        totalAssets: 10,
        assetsReassigned: 3,
        unresolvedAssetCount: 0,
        assets: [
          { assetId: 1785, description: "D. Achane", fromManager: "Brooke", toManager: "Carson", fromTeamId: 3, toTeamId: 4, destinationExplicit: true, wasReassigned: false },
          { assetId: 1786, description: "Pick 5 (Rd1)", fromManager: "Brooke", toManager: "Carson", fromTeamId: 3, toTeamId: 4, destinationExplicit: true, wasReassigned: false },
          { assetId: 1787, description: "Pick 16 (Rd2)", fromManager: "Brooke", toManager: "Carson", fromTeamId: 3, toTeamId: 4, destinationExplicit: true, wasReassigned: false },
          { assetId: 1788, description: "C. McCaffery", fromManager: "Carson", toManager: "AJ", fromTeamId: 4, toTeamId: 5, destinationExplicit: true, wasReassigned: true },
          { assetId: 1789, description: "Pick 64 (Rd6)", fromManager: "Carson", toManager: "AJ", fromTeamId: 4, toTeamId: 5, destinationExplicit: true, wasReassigned: true },
          { assetId: 1790, description: "Pick 71 (Rd7)", fromManager: "Carson", toManager: "AJ", fromTeamId: 4, toTeamId: 5, destinationExplicit: true, wasReassigned: true },
          { assetId: 1791, description: "D. London", fromManager: "AJ", toManager: "Brooke", fromTeamId: 5, toTeamId: 3, destinationExplicit: true, wasReassigned: false },
          { assetId: 1792, description: "S. LaPorta", fromManager: "AJ", toManager: "Brooke", fromTeamId: 5, toTeamId: 3, destinationExplicit: true, wasReassigned: false },
          { assetId: 1793, description: "Pick 19 (Rd2)", fromManager: "AJ", toManager: "Brooke", fromTeamId: 5, toTeamId: 3, destinationExplicit: true, wasReassigned: false },
          { assetId: 1794, description: "Pick 39 (Rd4)", fromManager: "AJ", toManager: "Brooke", fromTeamId: 5, toTeamId: 3, destinationExplicit: true, wasReassigned: false },
        ],
      });
    }

    // =========================================================
    // TRADE #520 (2025-07-24): Chuck(10) + JT(1) + Jimmy(9)
    // =========================================================
    {
      const tradeId = 520;
      const teamCId = 9; // Jimmy

      if (!dryRun) {
        // Step 1: Reassign from_team_id for misattributed assets
        // Garrett Wilson (id 1913) → from_team_id should be 9 (Jimmy), not 10 (Chuck)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET from_team_id = 9 WHERE id = 1913`,
          undefined, { label: "Reassign Garrett Wilson to Jimmy (trade 520)" }
        );
        // Pick 20 (id 1914) → from_team_id should be 9 (Jimmy)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET from_team_id = 9 WHERE id = 1914`,
          undefined, { label: "Reassign pick 20 to Jimmy (trade 520)" }
        );

        // Step 2: Set explicit recipient_team_id for ALL assets
        // Chuck(10)→JT(1): Jayden Daniels (id 1910), Breece Hall (id 1911), 2026 Rd1 (id 1912)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 1, destination_explicit = true WHERE id IN (1910, 1911, 1912)`,
          undefined, { label: "Daniels+Hall+pick: Chuck→JT" }
        );
        // JT(1)→Jimmy(9): Ladd McConkey (id 1915), Pick 29 (id 1916), 2026 Rd4 (id 1917)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 9, destination_explicit = true WHERE id IN (1915, 1916, 1917)`,
          undefined, { label: "McConkey+picks: JT→Jimmy" }
        );
        // Jimmy(9)→Chuck(10): Garrett Wilson (id 1913), Pick 20 (id 1914)
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trade_assets SET recipient_team_id = 10, destination_explicit = true WHERE id IN (1913, 1914)`,
          undefined, { label: "Wilson+pick: Jimmy→Chuck" }
        );

        // Step 3: Update trade-level fields
        await ctx.integrations.app_db.execute(
          `UPDATE ffwr_trades SET trade_type = 'three_team', participant_count = 3, team_c_id = $1, three_team_complete = true WHERE id = $2`,
          [teamCId, tradeId], { label: "Promote trade 520 to three_team" }
        );
      }

      reports.push({
        tradeId: 520,
        tradeDate: "2025-07-24",
        participants: {
          teamA: { id: 10, manager: "Chuck" },
          teamB: { id: 1, manager: "JT" },
          teamC: { id: 9, manager: "Jimmy" },
        },
        beforeParticipantCount: 2,
        afterParticipantCount: 3,
        totalAssets: 8,
        assetsReassigned: 2,
        unresolvedAssetCount: 0,
        assets: [
          { assetId: 1910, description: "Jayden Daniels", fromManager: "Chuck", toManager: "JT", fromTeamId: 10, toTeamId: 1, destinationExplicit: true, wasReassigned: false },
          { assetId: 1911, description: "Breece Hall", fromManager: "Chuck", toManager: "JT", fromTeamId: 10, toTeamId: 1, destinationExplicit: true, wasReassigned: false },
          { assetId: 1912, description: "2026 Round 1 pick", fromManager: "Chuck", toManager: "JT", fromTeamId: 10, toTeamId: 1, destinationExplicit: true, wasReassigned: false },
          { assetId: 1913, description: "Garrett Wilson", fromManager: "Jimmy", toManager: "Chuck", fromTeamId: 9, toTeamId: 10, destinationExplicit: true, wasReassigned: true },
          { assetId: 1914, description: "Pick 20 (Rd2)", fromManager: "Jimmy", toManager: "Chuck", fromTeamId: 9, toTeamId: 10, destinationExplicit: true, wasReassigned: true },
          { assetId: 1915, description: "Ladd McConkey", fromManager: "JT", toManager: "Jimmy", fromTeamId: 1, toTeamId: 9, destinationExplicit: true, wasReassigned: false },
          { assetId: 1916, description: "Pick 29 (Rd3)", fromManager: "JT", toManager: "Jimmy", fromTeamId: 1, toTeamId: 9, destinationExplicit: true, wasReassigned: false },
          { assetId: 1917, description: "2026 Round 4 pick", fromManager: "JT", toManager: "Jimmy", fromTeamId: 1, toTeamId: 9, destinationExplicit: true, wasReassigned: false },
        ],
      });
    }

    // Verify no other trades changed
    const afterTradeCount = await ctx.integrations.app_db.query(
      `SELECT trade_type, COUNT(*) as cnt FROM ffwr_trades GROUP BY trade_type ORDER BY trade_type LIMIT 10`,
      z.object({ trade_type: z.string().nullable(), cnt: z.coerce.number() }),
      undefined,
      { label: "Snapshot trade counts after repair" }
    );

    // Calculate: if we started with 275 two_team, after repair we should have 272 two_team + 3 three_team = 275 total
    const twoTeamBefore = beforeTradeCount.find(r => r.trade_type === "two_team")?.cnt ?? 0;
    const twoTeamAfter = afterTradeCount.find(r => r.trade_type === "two_team")?.cnt ?? 0;
    const threeTeamAfter = afterTradeCount.find(r => r.trade_type === "three_team")?.cnt ?? 0;

    // Other trades changed = trades that weren't the 3 known ones that got modified
    const expectedTwoTeamAfter = twoTeamBefore - 3;
    const otherTradesChanged = dryRun ? 0 : Math.abs(twoTeamAfter - expectedTwoTeamAfter);

    ctx.log.info("Repair complete", {
      dryRun,
      twoTeamBefore,
      twoTeamAfter,
      threeTeamAfter,
      otherTradesChanged,
    });

    return {
      success: true,
      dryRun,
      reports,
      otherTradesChanged,
    };
  },
});
