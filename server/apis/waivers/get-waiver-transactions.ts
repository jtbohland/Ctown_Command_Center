import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const TransactionRowSchema = z.object({
  id: z.coerce.number(),
  season: z.string(),
  transaction_date: z.string(),
  transaction_time: z.string().nullable(),
  manager_name: z.string(),
  team_id: z.coerce.number().nullable(),
  team_name: z.string().nullable(),
  team_color: z.string().nullable(),
  added_player_name: z.string().nullable(),
  added_player_position: z.string().nullable(),
  added_player_nfl_team: z.string().nullable(),
  added_player_id: z.coerce.number().nullable(),
  added_player_adp_rank: z.coerce.number().nullable(),
  dropped_player_name: z.string().nullable(),
  dropped_player_position: z.string().nullable(),
  dropped_player_nfl_team: z.string().nullable(),
  dropped_player_id: z.coerce.number().nullable(),
  dropped_player_adp_rank: z.coerce.number().nullable(),
  processed_at: z.string(),
});

export default api({
  name: "GetWaiverTransactions",
  description: "Fetches waiver transactions with player values for the ledger view.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    season: z.string(),
    managerId: z.number().nullable(),
  }),

  output: z.object({
    transactions: z.array(TransactionRowSchema),
    totalPlayers: z.coerce.number(),
  }),

  async run(ctx, { season, managerId }) {
    // Build query with optional manager filter
    let query = `
      SELECT
        wt.id,
        wt.season,
        wt.transaction_date::text as transaction_date,
        wt.transaction_time,
        wt.manager_name,
        wt.team_id,
        t.team_name,
        t.color as team_color,
        wt.added_player_name,
        wt.added_player_position,
        wt.added_player_nfl_team,
        wt.added_player_id,
        ap.adp_rank as added_player_adp_rank,
        wt.dropped_player_name,
        wt.dropped_player_position,
        wt.dropped_player_nfl_team,
        wt.dropped_player_id,
        dp.adp_rank as dropped_player_adp_rank,
        wt.processed_at::text as processed_at
      FROM ffwr_waiver_transactions wt
      LEFT JOIN ffwr_teams t ON t.id = wt.team_id
      LEFT JOIN ffwr_players ap ON ap.id = wt.added_player_id
      LEFT JOIN ffwr_players dp ON dp.id = wt.dropped_player_id
      WHERE wt.season = $1
    `;

    const params: unknown[] = [season];

    if (managerId) {
      query += ` AND wt.team_id = $2`;
      params.push(managerId);
    }

    query += ` ORDER BY wt.transaction_date DESC, wt.transaction_time DESC NULLS LAST, wt.id DESC LIMIT 500`;

    const transactions = await ctx.integrations.apps_db.query(
      query,
      TransactionRowSchema,
      params,
      { label: `Fetch waiver transactions for ${season}` },
    );

    // Get player count for context
    const CountSchema = z.object({ cnt: z.coerce.number() });
    const countRows = await ctx.integrations.apps_db.query(
      "SELECT COUNT(*)::int as cnt FROM ffwr_players WHERE is_drafted = true",
      CountSchema,
      undefined,
      { label: "Count rostered players" },
    );

    return {
      transactions,
      totalPlayers: countRows[0]?.cnt ?? 0,
    };
  },
});
