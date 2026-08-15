import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const RecordSchema = z.object({
  id: z.coerce.number(),
  category: z.string(),
  season: z.string().nullable(),
  filename: z.string(),
  uploaded_at: z.string(),
  uploaded_by: z.string().nullable(),
  notes: z.string().nullable(),
  size_bytes: z.coerce.number(),
});

export type LeagueRecord = z.infer<typeof RecordSchema>;

export default api({
  name: "GetLeagueRecords",
  description: "Lists all archived league records with metadata (no file content).",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    records: z.array(RecordSchema),
  }),

  async run(ctx) {
    // Ensure table exists first
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

    const records = await ctx.integrations.apps_db.query(
      `SELECT id, category, season, filename, uploaded_at, uploaded_by, notes,
              LENGTH(file_content) as size_bytes
       FROM ffwr_league_records
       ORDER BY uploaded_at DESC
       LIMIT 200`,
      RecordSchema,
      undefined,
      { label: "List league records" }
    );

    return { records };
  },
});
