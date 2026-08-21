import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitPlayerScores",
  description: "Creates the ffwr_player_scores table for actuals-based season scoring.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),
  output: z.object({ message: z.string() }),

  async run(ctx) {
    requireAdmin(ctx, "initialize the player scores table");

    await ctx.integrations.apps_db.execute(`
      CREATE TABLE IF NOT EXISTS ffwr_player_scores (
        id SERIAL PRIMARY KEY,
        canonical_player_id INTEGER REFERENCES ffwr_canonical_players(id),
        season TEXT NOT NULL,

        -- Raw actuals data
        overall_rank INTEGER,
        positional_rank INTEGER,
        games_played INTEGER,
        avg_points NUMERIC,
        total_points NUMERIC,
        position TEXT,

        -- Computed scores
        ppg_percentile NUMERIC,          -- Position-normalized PPG percentile (0-100)
        availability_score NUMERIC,       -- Games played / 17
        season_actual_score NUMERIC,      -- Composite: weighted PPG + availability
        
        -- ADP comparison
        adp_rank_that_season INTEGER,     -- ADP rank in the same season (if available)
        expectation_delta NUMERIC,        -- ADP rank - actual rank (positive = exceeded expectations)

        created_at TIMESTAMPTZ DEFAULT NOW(),

        UNIQUE(canonical_player_id, season)
      )
    `, undefined, { label: "Create ffwr_player_scores table" });

    await ctx.integrations.apps_db.execute(`
      CREATE INDEX IF NOT EXISTS idx_player_scores_season
      ON ffwr_player_scores(season)
    `, undefined, { label: "Create season index" });

    await ctx.integrations.apps_db.execute(`
      CREATE INDEX IF NOT EXISTS idx_player_scores_canonical
      ON ffwr_player_scores(canonical_player_id)
    `, undefined, { label: "Create canonical player index" });

    await ctx.integrations.apps_db.execute(`
      CREATE INDEX IF NOT EXISTS idx_player_scores_position_season
      ON ffwr_player_scores(position, season)
    `, undefined, { label: "Create position+season index" });

    return { message: "ffwr_player_scores table created successfully" };
  },
});
