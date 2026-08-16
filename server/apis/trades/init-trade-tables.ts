import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitTradeTables",
  description: "Creates trade calculator tables for The C-Town Exchange feature.",

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

    // ── 5. Rookie classes table (dynasty factors) ─────────────────
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_rookie_classes (
        id SERIAL PRIMARY KEY,
        nfl_draft_year INTEGER NOT NULL,
        overall_pick INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        position TEXT NOT NULL,
        age_on_draft_day INTEGER NOT NULL,
        nfl_team TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      undefined,
      { label: "Create ffwr_rookie_classes table" }
    );

    // ── 6. Create indexes ───────────────────────────────────────────
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

    // ── 7. Schema migrations (idempotent) ────────────────────────
    // Add verdict columns to ffwr_trades
    const verdictMigrations = [
      "ALTER TABLE ffwr_trades ADD COLUMN IF NOT EXISTS team_c_total NUMERIC",
      "ALTER TABLE ffwr_trades ADD COLUMN IF NOT EXISTS confidence TEXT",
      "ALTER TABLE ffwr_trades ADD COLUMN IF NOT EXISTS confidence_reasons TEXT[]",
    ];
    for (const sql of verdictMigrations) {
      await ctx.integrations.apps_db.execute(sql, undefined, { label: "Verdict schema migration" });
    }

    // ── 8. Immutable verdict snapshots table ────────────────────
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_verdict_snapshots (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        run_type TEXT NOT NULL,
        snapshot_ts TIMESTAMPTZ NOT NULL DEFAULT now(),
        trade_id INTEGER NOT NULL REFERENCES ffwr_trades(id),
        trade_number INTEGER,
        season TEXT,
        verdict_label TEXT,
        verdict_emoji TEXT,
        verdict_severity TEXT,
        winner_team_id INTEGER,
        pct_difference NUMERIC,
        team_a_total NUMERIC,
        team_b_total NUMERIC,
        team_c_total NUMERIC,
        confidence TEXT,
        valuation_complete BOOLEAN
      )`,
      undefined,
      { label: "Create verdict snapshots table" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE INDEX IF NOT EXISTS idx_ffwr_verdict_snapshots_run_id
       ON ffwr_verdict_snapshots(run_id)`,
      undefined,
      { label: "Create verdict snapshots run_id index" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE INDEX IF NOT EXISTS idx_ffwr_verdict_snapshots_trade_id
       ON ffwr_verdict_snapshots(trade_id)`,
      undefined,
      { label: "Create verdict snapshots trade_id index" }
    );

    return { message: "Trade calculator tables created successfully!" };
  },
});
