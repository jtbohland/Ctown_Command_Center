import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const TradeSchema = z.object({
  id: z.coerce.number(),
  trade_number: z.coerce.number(),
  season: z.string(),
  trade_date: z.string().nullable(),
  team_a_id: z.coerce.number(),
  team_b_id: z.coerce.number(),
  team_c_id: z.coerce.number().nullable(),
  team_a_name: z.string(),
  team_b_name: z.string(),
  team_c_name: z.string().nullable(),
  status: z.string(),
  period: z.string(),
  notes: z.string().nullable(),
  trade_type: z.string().nullable(),
  participant_count: z.coerce.number().nullable(),
  three_team_complete: z.boolean().nullable(),
});

const TradeAssetSchema = z.object({
  id: z.coerce.number(),
  trade_id: z.coerce.number(),
  from_team_id: z.coerce.number(),
  recipient_team_id: z.coerce.number().nullable(),
  destination_explicit: z.boolean().nullable(),
  asset_type: z.string(),
  player_name: z.string().nullable(),
  player_position: z.string().nullable(),
  player_adp_at_trade: z.string().nullable(),
  pick_year: z.coerce.number().nullable(),
  pick_round: z.coerce.number().nullable(),
  pick_number: z.coerce.number().nullable(),
});

const DraftCapitalSchema = z.object({
  id: z.coerce.number(),
  year: z.coerce.number(),
  round: z.coerce.number(),
  original_team_id: z.coerce.number(),
  current_team_id: z.coerce.number(),
  original_team_name: z.string(),
  current_team_name: z.string(),
});

const PlayerSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  nfl_team: z.string(),
  adp_rank: z.coerce.number().nullable(),
});

const TeamSchema = z.object({
  id: z.coerce.number(),
  team_name: z.string(),
  manager_name: z.string(),
  color: z.string(),
});

const HistoricalAdpSchema = z.object({
  player_name: z.string(),
  adp_rank: z.coerce.number(),
  season: z.string(),
  position: z.string(),
});

const RookieClassSchema = z.object({
  nfl_draft_year: z.coerce.number(),
  overall_pick: z.coerce.number(),
  player_name: z.string(),
  position: z.string(),
  age_on_draft_day: z.coerce.number(),
});

export default api({
  name: "GetTradeData",
  description: "Fetches all trade data, draft capital, players, teams, ADP, and rookie classes.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    trades: z.array(TradeSchema),
    assets: z.array(TradeAssetSchema),
    draftCapital: z.array(DraftCapitalSchema),
    players: z.array(PlayerSchema),
    teams: z.array(TeamSchema),
    historicalAdp: z.array(HistoricalAdpSchema),
    rookieClasses: z.array(RookieClassSchema),
  }),

  async run(ctx) {
    const trades = await ctx.integrations.apps_db.query(
      `SELECT t.id, t.trade_number, t.season, t.trade_date,
        t.team_a_id, t.team_b_id, t.team_c_id,
        ta.team_name as team_a_name, 
        tb.team_name as team_b_name,
        tc.team_name as team_c_name,
        t.status, t.period, t.notes,
        t.trade_type, t.participant_count, t.three_team_complete
      FROM ffwr_trades t
      JOIN ffwr_teams ta ON ta.id = t.team_a_id
      JOIN ffwr_teams tb ON tb.id = t.team_b_id
      LEFT JOIN ffwr_teams tc ON tc.id = t.team_c_id
      ORDER BY t.season DESC, t.trade_number DESC
      LIMIT 500`,
      TradeSchema,
      undefined,
      { label: "Fetch all trades" }
    );

    const assets = await ctx.integrations.apps_db.query(
      `SELECT id, trade_id, from_team_id, recipient_team_id, destination_explicit,
        asset_type, player_name, player_position, player_adp_at_trade,
        pick_year, pick_round, pick_number
      FROM ffwr_trade_assets ORDER BY trade_id, id LIMIT 2000`,
      TradeAssetSchema,
      undefined,
      { label: "Fetch all trade assets" }
    );

    const draftCapital = await ctx.integrations.apps_db.query(
      `SELECT dc.*, 
        ot.team_name as original_team_name,
        ct.team_name as current_team_name
      FROM ffwr_draft_capital dc
      JOIN ffwr_teams ot ON ot.id = dc.original_team_id
      JOIN ffwr_teams ct ON ct.id = dc.current_team_id
      ORDER BY dc.year, dc.round, dc.original_team_id
      LIMIT 500`,
      DraftCapitalSchema,
      undefined,
      { label: "Fetch draft capital" }
    );

    const players = await ctx.integrations.apps_db.query(
      `SELECT id, name, position, nfl_team, adp_rank 
      FROM ffwr_players 
      WHERE is_drafted = false OR is_keeper = true
      ORDER BY adp_rank ASC NULLS LAST
      LIMIT 500`,
      PlayerSchema,
      undefined,
      { label: "Fetch available players" }
    );

    const teams = await ctx.integrations.apps_db.query(
      `SELECT id, team_name, manager_name, color FROM ffwr_teams ORDER BY id LIMIT 11`,
      TeamSchema,
      undefined,
      { label: "Fetch teams" }
    );

    const historicalAdp = await ctx.integrations.apps_db.query(
      `SELECT player_name, adp_rank, season, position FROM ffwr_historical_adp ORDER BY season, adp_rank LIMIT 6000`,
      HistoricalAdpSchema,
      undefined,
      { label: "Fetch historical ADP with positions" }
    );

    // Fetch rookie classes for dynasty factors (safe if table doesn't exist yet)
    let rookieClasses: z.infer<typeof RookieClassSchema>[] = [];
    try {
      rookieClasses = await ctx.integrations.apps_db.query(
        `SELECT nfl_draft_year, overall_pick, player_name, position, age_on_draft_day
         FROM ffwr_rookie_classes ORDER BY nfl_draft_year, overall_pick LIMIT 1000`,
        RookieClassSchema,
        undefined,
        { label: "Fetch rookie classes" }
      );
    } catch {
      ctx.log.warn("ffwr_rookie_classes table not found — run SeedRookieClasses first");
    }

    return { trades, assets, draftCapital, players, teams, historicalAdp, rookieClasses };
  },
});
