import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const ContentSchema = z.object({
  filename: z.string(),
  file_content: z.string(),
});

export default api({
  name: "DownloadLeagueRecord",
  description: "Retrieves a single league record's file content by ID.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    recordId: z.number(),
  }),

  output: z.object({
    filename: z.string(),
    fileContent: z.string(),
  }),

  async run(ctx, { recordId }) {
    const rows = await ctx.integrations.apps_db.query(
      `SELECT filename, file_content
       FROM ffwr_league_records
       WHERE id = $1
       LIMIT 1`,
      ContentSchema,
      [recordId],
      { label: "Fetch league record content" }
    );

    if (rows.length === 0) {
      throw new Error(`Record #${recordId} not found.`);
    }

    return {
      filename: rows[0].filename,
      fileContent: rows[0].file_content,
    };
  },
});
