import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const AssetInputSchema = z.object({
  type: z.enum(["player", "pick"]),
  playerName: z.string().nullable(),
  playerPosition: z.string().nullable(),
  pickYear: z.number().nullable(),
  pickRound: z.number().nullable(),
  pickNumber: z.number().nullable(),
  fromTeamId: z.number(),
});

export default api({
  name: "SaveTrade",
  description: "Saves a new trade to the historical trade database.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    teamAId: z.number(),
    teamBId: z.number(),
    season: z.string(),
    period: z.string(),
    assets: z.array(AssetInputSchema),
  }),

  output: z.object({
    message: z.string(),
    tradeId: z.number(),
    tradeNumber: z.number(),
  }),

  async run(ctx, { teamAId, teamBId, season, period, assets }) {
    // Get next trade number for this season
    const MaxSchema = z.object({ max_num: z.coerce.number().nullable() });
    const [maxRow] = await ctx.integrations.apps_db.query(
      `SELECT MAX(trade_number) as max_num FROM ffwr_trades WHERE season = $1 LIMIT 1`,
      MaxSchema,
      [season],
      { label: "Get max trade number" }
    );
    const nextTradeNumber = (maxRow?.max_num ?? 0) + 1;

    // Insert trade
    const InsertSchema = z.object({ id: z.coerce.number() });
    const [inserted] = await ctx.integrations.apps_db.query(
      `INSERT INTO ffwr_trades (trade_number, season, trade_date, team_a_id, team_b_id, status, period)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, 'completed', $5)
       RETURNING id`,
      InsertSchema,
      [nextTradeNumber, season, teamAId, teamBId, period],
      { label: "Insert trade record" }
    );

    const tradeId = inserted.id;

    // Insert assets + auto-move picks on the draft board
    const pickMoves: Array<{ year: number; round: number; fromTeamId: number; toTeamId: number }> = [];

    for (const asset of assets) {
      if (asset.type === "player") {
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, player_name, player_position)
           VALUES ($1, $2, 'player', $3, $4)`,
          [tradeId, asset.fromTeamId, asset.playerName, asset.playerPosition],
          { label: `Insert player asset: ${asset.playerName}` }
        );
      } else {
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_trade_assets (trade_id, from_team_id, asset_type, pick_year, pick_round, pick_number)
           VALUES ($1, $2, 'pick', $3, $4, $5)`,
          [tradeId, asset.fromTeamId, asset.pickYear, asset.pickRound, asset.pickNumber],
          { label: `Insert pick asset: ${asset.pickYear} Rd ${asset.pickRound}` }
        );

        // Track pick moves: fromTeamId is giving the pick, the other team receives it
        if (asset.pickYear && asset.pickRound) {
          const toTeamId = asset.fromTeamId === teamAId ? teamBId : teamAId;
          pickMoves.push({
            year: asset.pickYear,
            round: asset.pickRound,
            fromTeamId: asset.fromTeamId,
            toTeamId,
          });
        }
      }
    }

    // Auto-move picks on the draft board (The Treasury / Draft Tracker)
    // Update current_team_id for each traded pick in ffwr_draft_capital
    for (const move of pickMoves) {
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_draft_capital
         SET current_team_id = $1
         WHERE year = $2 AND round = $3 AND current_team_id = $4`,
        [move.toTeamId, move.year, move.round, move.fromTeamId],
        { label: `Move pick: ${move.year} Rd ${move.round} → team ${move.toTeamId}` }
      );
    }

    return {
      message: `Trade #${nextTradeNumber} saved successfully!`,
      tradeId,
      tradeNumber: nextTradeNumber,
    };
  },
});
