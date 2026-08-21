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
