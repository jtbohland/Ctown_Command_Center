import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitTradeTables",
  description: "Creates trade calculator tables for the Arm Chair Dealer feature.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    message: z.string(),
  }),

  async run(ctx) {
    // ── 1. Historical ADP table ─────────────────────────────────────
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_historical_adp (
        id SERIAL PRIMARY KEY,
        season TEXT NOT NULL,
        player_name TEXT NOT NULL,
        position TEXT NOT NULL,
        nfl_team TEXT,
        adp_rank NUMERIC NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      undefined,
      { label: "Create ffwr_historical_adp table" }
    );

    // ── 2. Trades table ─────────────────────────────────────────────
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_trades (
        id SERIAL PRIMARY KEY,
        trade_number INT NOT NULL,
        season TEXT NOT NULL,
        trade_date DATE,
        team_a_id INT NOT NULL REFERENCES ffwr_teams(id),
        team_b_id INT NOT NULL REFERENCES ffwr_teams(id),
        status TEXT NOT NULL DEFAULT 'accepted',
        period TEXT NOT NULL DEFAULT 'in-season',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      undefined,
      { label: "Create ffwr_trades table" }
    );

    // ── 3. Trade assets table ───────────────────────────────────────
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_trade_assets (
        id SERIAL PRIMARY KEY,
        trade_id INT NOT NULL REFERENCES ffwr_trades(id) ON DELETE CASCADE,
        from_team_id INT NOT NULL REFERENCES ffwr_teams(id),
        asset_type TEXT NOT NULL CHECK (asset_type IN ('player', 'pick')),
        player_name TEXT,
        player_position TEXT,
        player_adp_at_trade NUMERIC,
        pick_year INT,
        pick_round INT,
        pick_number INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      undefined,
      { label: "Create ffwr_trade_assets table" }
    );

    // ── 4. Draft capital table ──────────────────────────────────────
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_draft_capital (
        id SERIAL PRIMARY KEY,
        year INT NOT NULL,
        round INT NOT NULL,
        original_team_id INT NOT NULL REFERENCES ffwr_teams(id),
        current_team_id INT NOT NULL REFERENCES ffwr_teams(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(year, round, original_team_id)
      )`,
      undefined,
      { label: "Create ffwr_draft_capital table" }
    );

    // ── 5. Create indexes ───────────────────────────────────────────
    await ctx.integrations.apps_db.execute(
      `CREATE INDEX IF NOT EXISTS idx_ffwr_historical_adp_season 
       ON ffwr_historical_adp(season)`,
      undefined,
      { label: "Create ADP season index" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE INDEX IF NOT EXISTS idx_ffwr_historical_adp_name 
       ON ffwr_historical_adp(player_name)`,
      undefined,
      { label: "Create ADP player name index" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE INDEX IF NOT EXISTS idx_ffwr_trades_season 
       ON ffwr_trades(season)`,
      undefined,
      { label: "Create trades season index" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE INDEX IF NOT EXISTS idx_ffwr_trade_assets_trade_id 
       ON ffwr_trade_assets(trade_id)`,
      undefined,
      { label: "Create trade assets trade_id index" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE INDEX IF NOT EXISTS idx_ffwr_draft_capital_year_team 
       ON ffwr_draft_capital(year, current_team_id)`,
      undefined,
      { label: "Create draft capital index" }
    );

    return { message: "Trade calculator tables created successfully!" };
  },
});
