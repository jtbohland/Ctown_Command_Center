import { api, z, postgres } from "@superblocksteam/sdk-api";

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
    // Ensure table exists
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_league_records (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100) NOT NULL,
        season VARCHAR(20),
        filename VARCHAR(255) NOT NULL,
        file_content TEXT NOT NULL,
        uploaded_at TIMESTAMPTZ DEFAULT NOW(),
        uploaded_by VARCHAR(255),
        notes TEXT
      )`,
      undefined,
      { label: "Ensure ffwr_league_records table exists" }
    );

    const InsertedSchema = z.object({ id: z.coerce.number() });
    const rows = await ctx.integrations.apps_db.query(
      `INSERT INTO ffwr_league_records (category, season, filename, file_content, uploaded_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      InsertedSchema,
      [category, season, filename, fileContent, ctx.user?.email ?? "unknown", notes],
      { label: "Insert league record" }
    );

    return {
      id: rows[0].id,
      message: `Archived "${filename}" under ${category}${season ? ` (${season})` : ""}.`,
    };
  },
});
