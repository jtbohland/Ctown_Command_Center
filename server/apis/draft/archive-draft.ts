import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const CountSchema = z.object({ cnt: z.coerce.number() });

export default api({
  name: "ArchiveDraft",
  description: "Archives a completed draft into ffwr_historical_draft_picks with team/position metadata.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    draftYear: z.number().int().min(2020).max(2040),
  }),

  output: z.object({
    rowsInserted: z.number(),
    message: z.string(),
  }),

  async run(ctx, { draftYear }) {
    // 1. Add new columns if they don't exist (idempotent)
    const newColumns = [
      { name: "team_name", type: "TEXT" },
      { name: "manager_name", type: "TEXT" },
      { name: "position", type: "TEXT" },
      { name: "round", type: "INTEGER" },
      { name: "pick_in_round", type: "INTEGER" },
    ];

    for (const col of newColumns) {
      await ctx.integrations.apps_db.execute(
        `ALTER TABLE ffwr_historical_draft_picks ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`,
        undefined,
        { label: `Add column ${col.name}` },
      );
    }

    // 2. Check if this draft year already has data
    const existing = await ctx.integrations.apps_db.query(
      "SELECT COUNT(*) AS cnt FROM ffwr_historical_draft_picks WHERE draft_year = $1",
      CountSchema,
      [draftYear],
      { label: "Check existing archive" },
    );

    if (existing[0].cnt > 0) {
      return {
        rowsInserted: 0,
        message: `Draft year ${draftYear} already archived (${existing[0].cnt} rows). No changes made.`,
      };
    }

    // 3. Verify draft is complete (all picks filled)
    const incomplete = await ctx.integrations.apps_db.query(
      "SELECT COUNT(*) AS cnt FROM ffwr_draft_picks WHERE is_complete = false OR player_id IS NULL",
      CountSchema,
      undefined,
      { label: "Check incomplete picks" },
    );

    if (incomplete[0].cnt > 0) {
      throw new Error(
        `Cannot archive: ${incomplete[0].cnt} picks are still incomplete. Complete the draft first.`,
      );
    }

    // 4. Insert all completed picks with team/player metadata
    const result = await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_historical_draft_picks (draft_year, pick, player, team_name, manager_name, position, round, pick_in_round)
       SELECT
         $1,
         dp.overall_pick,
         p.name,
         t.team_name,
         t.manager_name,
         p.position,
         dp.round,
         dp.pick_in_round
       FROM ffwr_draft_picks dp
       JOIN ffwr_players p ON dp.player_id = p.id
       JOIN ffwr_teams t ON dp.team_id = t.id
       WHERE dp.is_complete = true AND dp.player_id IS NOT NULL
       ORDER BY dp.overall_pick
       ON CONFLICT (draft_year, pick) DO NOTHING`,
      [draftYear],
      { label: "Archive draft picks" },
    );

    // 5. Mark the draft as no longer active (already should be, but enforce)
    await ctx.integrations.apps_db.execute(
      "UPDATE ffwr_draft_state SET is_active = false WHERE is_active = true",
      undefined,
      { label: "Lock draft state" },
    );

    return {
      rowsInserted: result.rowCount,
      message: `Successfully archived ${result.rowCount} picks for the ${draftYear} draft.`,
    };
  },
});
