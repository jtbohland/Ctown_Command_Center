import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "MergeDuplicatePlayers",
  description: "Merges duplicate players caused by period differences in names (A.J. vs AJ).",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    merged: z.number(),
    details: z.array(z.string()),
  }),

  async run(ctx) {
    // Find duplicates where names differ only by periods
    const DupSchema = z.object({
      dup_id: z.coerce.number(),
      dup_name: z.string(),
      orig_id: z.coerce.number(),
      orig_name: z.string(),
      position: z.string(),
      dup_draft_rank: z.coerce.number().nullable(),
      dup_adp: z.string().nullable(),
      dup_pos_rank: z.string().nullable(),
      dup_nfl_team: z.string().nullable(),
      dup_bye: z.coerce.number().nullable(),
    });

    const dups = await ctx.integrations.apps_db.query(
      `SELECT a.id AS dup_id, a.name AS dup_name, a.position,
              b.id AS orig_id, b.name AS orig_name,
              a.draft_rank AS dup_draft_rank, a.adp_rank AS dup_adp,
              a.positional_rank AS dup_pos_rank, a.nfl_team AS dup_nfl_team,
              a.bye_week AS dup_bye
       FROM ffwr_players a
       JOIN ffwr_players b
         ON REPLACE(REPLACE(a.name, '.', ''), ' ', '') = REPLACE(REPLACE(b.name, '.', ''), ' ', '')
         AND a.position = b.position
         AND a.id <> b.id
       WHERE a.name LIKE '%.%' OR a.name LIKE '%Jr.%'
       LIMIT 20`,
      DupSchema,
      [],
      { label: "Find period-name duplicates" }
    );

    const details: string[] = [];
    const processedDupIds = new Set<number>();

    for (const dup of dups) {
      if (processedDupIds.has(dup.dup_id)) continue;
      processedDupIds.add(dup.dup_id);

      // Update the original record with ranking data from the duplicate
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players SET
           draft_rank = COALESCE($2, draft_rank),
           adp_rank = COALESCE($3, adp_rank),
           positional_rank = COALESCE($4, positional_rank),
           nfl_team = COALESCE($5, nfl_team),
           bye_week = COALESCE($6, bye_week)
         WHERE id = $1`,
        [dup.orig_id, dup.dup_draft_rank, dup.dup_adp, dup.dup_pos_rank, dup.dup_nfl_team, dup.dup_bye],
        { label: `Update orig: ${dup.orig_name} (id ${dup.orig_id})` }
      );

      // Move any tags from the duplicate to the original
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_player_tags SET player_id = $1 WHERE player_id = $2 AND NOT EXISTS (
           SELECT 1 FROM ffwr_player_tags WHERE player_id = $1 AND tag = ffwr_player_tags.tag
         )`,
        [dup.orig_id, dup.dup_id],
        { label: `Migrate tags: ${dup.dup_name} → ${dup.orig_name}` }
      );

      // Remove the duplicate
      await ctx.integrations.apps_db.execute(
        "DELETE FROM ffwr_player_tags WHERE player_id = $1",
        [dup.dup_id],
        { label: `Remove dup tags: ${dup.dup_name}` }
      );
      await ctx.integrations.apps_db.execute(
        "DELETE FROM ffwr_players WHERE id = $1",
        [dup.dup_id],
        { label: `Remove dup: ${dup.dup_name} (id ${dup.dup_id})` }
      );

      details.push(`Merged "${dup.dup_name}" (id ${dup.dup_id}) → "${dup.orig_name}" (id ${dup.orig_id})`);
    }

    return { merged: details.length, details };
  },
});
