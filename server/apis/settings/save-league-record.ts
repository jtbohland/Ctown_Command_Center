import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "SaveLeagueRecord",
  description: "Stores a CSV file in the league records archive.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    category: z.string(),
    season: z.string().nullable(),
    filename: z.string(),
    fileContent: z.string(),
    notes: z.string().nullable(),
  }),

  output: z.object({
    id: z.coerce.number(),
    message: z.string(),
  }),

  async run(ctx, { category, season, filename, fileContent, notes }) {
    // Verified server-side from the signed JWT — also used for attribution below.
    const admin = requireAdmin(ctx, "archive a league record");

    // [Phase 4] Explicit error state instead of silently archiving an empty file.
    if (fileContent.trim().length === 0) {
      throw new Error(`Refusing to archive "${filename}": the file is empty.`);
    }

    const InsertedSchema = z.object({ id: z.coerce.number() });
    const rows = await ctx.integrations.apps_db.query(
      `INSERT INTO ffwr_league_records (category, season, filename, file_content, uploaded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      InsertedSchema,
      [category, season, filename, fileContent, admin, notes],
      { label: "Insert league record" }
    );

    return {
      id: rows[0].id,
      message: `Archived "${filename}" under ${category}${season ? ` (${season})` : ""}.`,
    };
  },
});
