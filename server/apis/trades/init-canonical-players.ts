import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitCanonicalPlayers",
  description: "Creates the ffwr_canonical_players table for player identity matching.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),
  output: z.object({ message: z.string() }),

  async run(ctx) {
    await ctx.integrations.apps_db.execute(`
      CREATE TABLE IF NOT EXISTS ffwr_canonical_players (
        id SERIAL PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        position TEXT,
        nfl_draft_year INTEGER,

        -- Source presence flags
        in_adp BOOLEAN DEFAULT FALSE,
        in_actuals BOOLEAN DEFAULT FALSE,
        in_rookies BOOLEAN DEFAULT FALSE,
        in_trades BOOLEAN DEFAULT FALSE,

        -- Aliases (JSON array of original source names)
        aliases JSONB DEFAULT '[]'::jsonb,

        -- Match quality
        match_status TEXT NOT NULL DEFAULT 'exact',

        -- Source counts (how many seasons/records in each source)
        adp_seasons INTEGER DEFAULT 0,
        actuals_seasons INTEGER DEFAULT 0,

        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),

        UNIQUE(normalized_name, position)
      )
    `, undefined, { label: "Create ffwr_canonical_players table" });

    // Index for fast lookups
    await ctx.integrations.apps_db.execute(`
      CREATE INDEX IF NOT EXISTS idx_canonical_players_normalized
      ON ffwr_canonical_players(normalized_name)
    `, undefined, { label: "Create normalized name index" });

    await ctx.integrations.apps_db.execute(`
      CREATE INDEX IF NOT EXISTS idx_canonical_players_position
      ON ffwr_canonical_players(position)
    `, undefined, { label: "Create position index" });

    return { message: "ffwr_canonical_players table created successfully" };
  },
});
