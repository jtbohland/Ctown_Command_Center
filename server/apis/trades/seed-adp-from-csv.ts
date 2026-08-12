import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

/**
 * Parse a player name from the CSV format, stripping team/bye annotations.
 * Examples:
 *   "Alvin Kamara   NO (6)" → "Alvin Kamara"
 *   "Todd Gurley II" → "Todd Gurley II"
 *   "Saquon Barkley   PHI (9)" → "Saquon Barkley"
 *   "Geno Smith   NYJ (11)" → "Geno Smith"
 */
function cleanPlayerName(raw: string): string {
  // Strip team/bye annotation: 2-3 spaces followed by 2-3 uppercase letters, optional space + (digit(s))
  return raw.replace(/\s{2,}[A-Z]{2,3}\s*\(\d+\)/, "").trim();
}

/**
 * Extract base position from POS column (e.g. "RB5" → "RB", "WR14" → "WR", "DST1" → "DST")
 */
function extractPosition(posRank: string): string {
  return posRank.replace(/\d+$/, "");
}

export default api({
  name: "SeedAdpFromCsv",
  description: "Seeds ADP data from a FantasyPros-format CSV into ffwr_historical_adp for a given season.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvData: z.string().describe("Raw CSV string with headers: Rank,Player (Bye),POS,..."),
    season: z.string().describe("Season label, e.g. '2018-19'"),
    dryRun: z.boolean().default(false).describe("If true, parse only — do not insert"),
    replaceExisting: z.boolean().default(true).describe("If true, delete existing ADP for this season before inserting"),
  }),

  output: z.object({
    parsed: z.number(),
    inserted: z.number(),
    skippedPositions: z.number(),
    sampleRows: z.array(z.object({
      rank: z.number(),
      name: z.string(),
      position: z.string(),
    })),
    message: z.string(),
  }),

  async run(ctx, { csvData, season, dryRun, replaceExisting }) {
    // Parse CSV
    const lines = csvData.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) throw new Error("CSV must have at least a header and one data row");

    // Skip header row
    const dataLines = lines.slice(1);
    const SKIP_POSITIONS = new Set(["DST", "K"]); // Not fantasy-relevant for this league

    const rows: Array<{ rank: number; name: string; position: string }> = [];
    let skippedPositions = 0;

    for (const line of dataLines) {
      // CSV fields: Rank, Player (Bye), POS, ESPN, Sleeper, CBS, NFL, RTSports, Fantrax, AVG
      const fields = line.split(",");
      if (fields.length < 3) continue;

      const rank = parseInt(fields[0], 10);
      if (isNaN(rank)) continue;

      const rawName = fields[1];
      const posRank = fields[2];
      const position = extractPosition(posRank);

      if (SKIP_POSITIONS.has(position)) {
        skippedPositions++;
        continue;
      }

      const name = cleanPlayerName(rawName);
      rows.push({ rank, name, position });
    }

    ctx.log.info(`Parsed ${rows.length} players from CSV (skipped ${skippedPositions} DST/K)`);

    const sampleRows = rows.slice(0, 5);

    if (dryRun) {
      return {
        parsed: rows.length,
        inserted: 0,
        skippedPositions,
        sampleRows,
        message: `Dry run: parsed ${rows.length} players for season ${season}. No data inserted.`,
      };
    }

    // Delete existing data for this season if requested
    if (replaceExisting) {
      await ctx.integrations.apps_db.execute(
        `DELETE FROM ffwr_historical_adp WHERE season = $1`,
        [season],
        { label: `Clear existing ADP for ${season}` },
      );
    }

    // Insert in batches of 30
    const BATCH_SIZE = 30;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const placeholders = batch
        .map((_, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`)
        .join(", ");
      const params = batch.flatMap((r) => [season, r.name, r.position, r.rank]);

      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_historical_adp (season, player_name, position, adp_rank)
         VALUES ${placeholders}
         ON CONFLICT DO NOTHING`,
        params,
        { label: `Insert ADP batch ${Math.floor(i / BATCH_SIZE) + 1} for ${season}` },
      );

      totalInserted += batch.length;
    }

    return {
      parsed: rows.length,
      inserted: totalInserted,
      skippedPositions,
      sampleRows,
      message: `Seeded ${totalInserted} players for season ${season} (skipped ${skippedPositions} DST/K).`,
    };
  },
});
