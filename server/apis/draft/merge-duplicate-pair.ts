import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "MergeDuplicatePair",
  description: "Merges a specific duplicate player pair: keeps one, absorbs data from the other, deletes the duplicate.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    keepId: z.number(),
    removeId: z.number(),
    overrides: z.object({
      name: z.string().optional(),
      nfl_team: z.string().optional(),
      upside: z.string().nullable().optional(),
      bust: z.string().nullable().optional(),
      positional_rank: z.number().nullable().optional(),
      bye_week: z.number().nullable().optional(),
    }).optional(),
  }),

  output: z.object({
    message: z.string(),
  }),

  async run(ctx, { keepId, removeId, overrides }) {
    // 1. Absorb non-null data from remove → keep (COALESCE keeps existing if already set)
    await ctx.integrations.apps_db.execute(
      `UPDATE ffwr_players AS keep SET
         upside = COALESCE(keep.upside, src.upside),
         bust = COALESCE(keep.bust, src.bust),
         sos = COALESCE(keep.sos, src.sos),
         age = COALESCE(keep.age, src.age),
         positional_rank = COALESCE(keep.positional_rank, src.positional_rank),
         bye_week = COALESCE(keep.bye_week, src.bye_week),
         dynasty_tier = COALESCE(keep.dynasty_tier, src.dynasty_tier),
         draft_tier = COALESCE(keep.draft_tier, src.draft_tier),
         implied_team_points = COALESCE(keep.implied_team_points, src.implied_team_points)
       FROM ffwr_players src
       WHERE keep.id = $1 AND src.id = $2`,
      [keepId, removeId],
      { label: `Absorb data from id:${removeId} → id:${keepId}` },
    );

    // 2. Apply explicit overrides if provided
    if (overrides) {
      const sets: string[] = [];
      const params: unknown[] = [keepId];
      let idx = 2;

      if (overrides.name !== undefined) {
        sets.push(`name = $${idx++}`);
        params.push(overrides.name);
      }
      if (overrides.nfl_team !== undefined) {
        sets.push(`nfl_team = $${idx++}`);
        params.push(overrides.nfl_team);
      }
      if (overrides.upside !== undefined) {
        sets.push(`upside = $${idx++}`);
        params.push(overrides.upside);
      }
      if (overrides.bust !== undefined) {
        sets.push(`bust = $${idx++}`);
        params.push(overrides.bust);
      }
      if (overrides.positional_rank !== undefined) {
        sets.push(`positional_rank = $${idx++}`);
        params.push(overrides.positional_rank);
      }
      if (overrides.bye_week !== undefined) {
        sets.push(`bye_week = $${idx++}`);
        params.push(overrides.bye_week);
      }

      if (sets.length > 0) {
        await ctx.integrations.apps_db.execute(
          `UPDATE ffwr_players SET ${sets.join(", ")} WHERE id = $1`,
          params,
          { label: `Apply overrides to id:${keepId}` },
        );
      }
    }

    // 3. Migrate tags from remove → keep (skip if tag already exists)
    await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_player_tags (player_id, tag)
       SELECT $1, tag FROM ffwr_player_tags WHERE player_id = $2
       ON CONFLICT DO NOTHING`,
      [keepId, removeId],
      { label: `Migrate tags from id:${removeId} → id:${keepId}` },
    );

    // 4. Delete duplicate's tags and the duplicate itself
    await ctx.integrations.apps_db.execute(
      "DELETE FROM ffwr_player_tags WHERE player_id = $1",
      [removeId],
      { label: `Remove tags for dup id:${removeId}` },
    );
    await ctx.integrations.apps_db.execute(
      "DELETE FROM ffwr_players WHERE id = $1",
      [removeId],
      { label: `Remove duplicate id:${removeId}` },
    );

    return { message: `Merged id:${removeId} → id:${keepId}` };
  },
});
