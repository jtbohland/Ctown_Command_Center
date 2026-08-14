import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizePlayerName } from "../../lib/normalize-player-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "MergeDuplicatePlayers",
  description: "Merges duplicate players caused by name formatting differences (periods, spaces).",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    dryRun: z.boolean().default(true),
  }),

  output: z.object({
    merged: z.number(),
    details: z.array(z.string()),
  }),

  async run(ctx, { dryRun }) {
    // Find all duplicate pairs by normalized name + position.
    // Normalizing = strip periods + collapse whitespace (same as normalizePlayerName).
    // "orig" = lower id (first created, usually has keeper/dynasty data).
    // "dup"  = higher id (ghost from later upload, usually has fresher ADP).
    const DupSchema = z.object({
      orig_id: z.coerce.number(),
      orig_name: z.string(),
      dup_id: z.coerce.number(),
      dup_name: z.string(),
      position: z.string(),
      // Orig data we want to preserve
      orig_is_keeper: z.boolean(),
      orig_is_drafted: z.boolean(),
      orig_dynasty_rank: z.string().nullable(),
      // Dup data that may be fresher
      dup_adp_rank: z.string().nullable(),
      dup_draft_rank: z.coerce.number().nullable(),
      dup_positional_rank: z.string().nullable(),
      dup_nfl_team: z.string().nullable(),
      dup_bye_week: z.coerce.number().nullable(),
      dup_age: z.coerce.number().nullable(),
    });

    const dups = await ctx.integrations.apps_db.query(
      `SELECT
         a.id AS orig_id, a.name AS orig_name,
         b.id AS dup_id, b.name AS dup_name,
         a.position,
         a.is_keeper AS orig_is_keeper, a.is_drafted AS orig_is_drafted,
         a.dynasty_rank AS orig_dynasty_rank,
         b.adp_rank AS dup_adp_rank, b.draft_rank AS dup_draft_rank,
         b.positional_rank AS dup_positional_rank,
         b.nfl_team AS dup_nfl_team, b.bye_week AS dup_bye_week,
         b.age AS dup_age
       FROM ffwr_players a
       JOIN ffwr_players b
         ON a.position = b.position
         AND a.id < b.id
         AND REPLACE(REPLACE(LOWER(a.name), '.', ''), ' ', '')
           = REPLACE(REPLACE(LOWER(b.name), '.', ''), ' ', '')
       ORDER BY a.id`,
      DupSchema,
      [],
      { label: "Find all duplicate pairs" }
    );

    if (dups.length === 0) {
      return { merged: 0, details: ["No duplicates found."] };
    }

    const details: string[] = [];

    if (dryRun) {
      for (const d of dups) {
        const flags = [
          d.orig_is_keeper ? "KEEPER" : null,
          d.orig_is_drafted ? "DRAFTED" : null,
          d.orig_dynasty_rank ? `dyn#${d.orig_dynasty_rank}` : null,
        ].filter(Boolean).join(", ");
        details.push(
          `Would merge "${d.dup_name}" (id ${d.dup_id}, ADP ${d.dup_adp_rank ?? "null"}) → "${d.orig_name}" (id ${d.orig_id}${flags ? `, ${flags}` : ""})`,
        );
      }
      return { merged: 0, details: [`DRY RUN — ${dups.length} pairs would be merged`, ...details] };
    }

    // Execute merge — order matters! Delete ghost BEFORE renaming original
    // to avoid unique constraint (name, position) conflicts.
    for (const d of dups) {
      const normalizedName = normalizePlayerName(d.orig_name);

      // 1. Move any tags from dup to original (skip if tag already exists)
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_player_tags SET player_id = $1
         WHERE player_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM ffwr_player_tags t2 WHERE t2.player_id = $1 AND t2.tag = ffwr_player_tags.tag
         )`,
        [d.orig_id, d.dup_id],
        { label: `Migrate tags: id ${d.dup_id} → ${d.orig_id}` }
      );

      // 2. Clean up remaining dup tags
      await ctx.integrations.apps_db.execute(
        "DELETE FROM ffwr_player_tags WHERE player_id = $1",
        [d.dup_id],
        { label: `Remove dup tags: id ${d.dup_id}` }
      );

      // 3. Delete the ghost row FIRST (frees up the normalized name)
      await ctx.integrations.apps_db.execute(
        "DELETE FROM ffwr_players WHERE id = $1",
        [d.dup_id],
        { label: `Remove ghost: "${d.dup_name}" (id ${d.dup_id})` }
      );

      // 4. NOW update the original row with normalized name + fresher ADP
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players SET
           name = $2,
           adp_rank = COALESCE($3, adp_rank),
           draft_rank = COALESCE($4, draft_rank),
           positional_rank = COALESCE($5, positional_rank),
           nfl_team = COALESCE($6, nfl_team),
           bye_week = COALESCE($7, bye_week),
           age = COALESCE($8, age)
         WHERE id = $1`,
        [d.orig_id, normalizedName, d.dup_adp_rank, d.dup_draft_rank,
         d.dup_positional_rank, d.dup_nfl_team, d.dup_bye_week, d.dup_age],
        { label: `Merge → ${normalizedName} (id ${d.orig_id})` }
      );

      details.push(`Merged "${d.dup_name}" (id ${d.dup_id}) → "${normalizedName}" (id ${d.orig_id})`);
    }

    return { merged: details.length, details };
  },
});
