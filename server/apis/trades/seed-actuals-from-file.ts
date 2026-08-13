import { api, z, postgres, readableFileSchema } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

/**
 * Parse player name and NFL team from FantasyPros PPR leaderboard format.
 * Examples:
 *   "Christian McCaffrey   CAR" → { name: "Christian McCaffrey", team: "CAR" }
 *   "Patrick Mahomes II   KC"  → { name: "Patrick Mahomes II", team: "KC" }
 */
function parsePlayer(raw: string): { name: string; team: string } {
  const parts = raw.split(/\s{2,}/);
  if (parts.length >= 2) {
    return { name: parts[0].trim(), team: parts[parts.length - 1].trim() };
  }
  return { name: raw.trim(), team: "" };
}

/**
 * Convert a year label like "2019" to our season format "2018-19".
 * The label represents the year the season ENDED (Super Bowl year).
 */
function yearToSeason(yearLabel: string): string {
  const endYear = parseInt(yearLabel, 10);
  const startYear = endYear - 1;
  const endSuffix = String(endYear).slice(-2);
  return `${startYear}-${endSuffix}`;
}

/**
 * Parse a weekly score cell. BYE and empty cells become null.
 */
function parseWeekScore(val: string): number | null {
  const trimmed = val.trim();
  if (!trimmed || trimmed.toUpperCase() === "BYE") return null;
  const num = parseFloat(trimmed);
  return isNaN(num) ? null : num;
}

const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const SKIP_POSITIONS = new Set(["K", "DST"]);

const SampleRowSchema = z.object({
  rank: z.number(),
  name: z.string(),
  team: z.string(),
  position: z.string(),
  gp: z.number(),
  avg: z.number(),
  total: z.number(),
});

const ValidationIssueSchema = z.object({
  row: z.number(),
  field: z.string(),
  value: z.string(),
  problem: z.string(),
});

export default api({
  name: "SeedActualsFromFile",
  description: "Seeds PPR scoring data from an uploaded FantasyPros CSV file into ffwr_season_actuals.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvFile: z.object({
      files: z.array(readableFileSchema).min(1).max(1),
    }),
    yearLabel: z.string().describe("End-year label, e.g. '2019' for the 2018-19 season"),
    dryRun: z.boolean().default(true).describe("If true, validate only — don't insert"),
    forceReplace: z.boolean().default(false).describe("If true, replace existing data for this season"),
  }),

  output: z.object({
    season: z.string(),
    filename: z.string(),
    columnNames: z.array(z.string()),
    totalRows: z.number(),
    validRows: z.number(),
    skippedKDst: z.number(),
    duplicateCount: z.number(),
    duplicateNames: z.array(z.string()),
    validationIssues: z.array(ValidationIssueSchema),
    sampleRows: z.array(SampleRowSchema),
    inserted: z.number(),
    seasonAlreadyLoaded: z.boolean(),
    existingRowCount: z.number(),
    message: z.string(),
  }),

  async run(ctx, { csvFile, yearLabel, dryRun, forceReplace }) {
    const season = yearToSeason(yearLabel);
    const file = csvFile.files[0];
    const filename = file.name;

    ctx.log.info(`Processing file "${filename}" for season ${season} (dryRun=${dryRun})`);

    // Read file contents server-side
    const raw = await file.readContentsAsync();
    const csvText = typeof raw === "string" ? raw : String(raw);

    const lines = csvText.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    if (lines.length < 2) {
      throw new Error("CSV must have at least a header and one data row");
    }

    // Parse header
    const header = lines[0].split(",");
    const columnNames = header.map((h: string) => h.trim());
    const avgIdx = header.findIndex((h: string) => h.trim().toUpperCase() === "AVG");
    const ttlIdx = header.findIndex((h: string) => h.trim().toUpperCase() === "TTL");
    if (avgIdx === -1 || ttlIdx === -1) {
      throw new Error("CSV header must contain AVG and TTL columns");
    }

    const weekStartIdx = 4; // After RK, PLAYER, POS, GP
    const numWeeks = avgIdx - weekStartIdx;
    ctx.log.info(`Detected ${numWeeks} weeks, ${lines.length - 1} data rows`);

    // Check if season already has data
    const existingCheck = await ctx.integrations.apps_db.query(
      `SELECT COUNT(*)::int as cnt FROM ffwr_season_actuals WHERE season = $1`,
      z.object({ cnt: z.number() }),
      [season],
      { label: `Check existing rows for ${season}` },
    );
    const existingRowCount = existingCheck[0]?.cnt ?? 0;
    const seasonAlreadyLoaded = existingRowCount > 0;

    if (seasonAlreadyLoaded && !forceReplace && !dryRun) {
      throw new Error(
        `Season ${season} already has ${existingRowCount} rows. Set forceReplace=true to overwrite.`
      );
    }

    // Parse all data rows
    interface ParsedRow {
      rank: number;
      name: string;
      team: string;
      position: string;
      gp: number;
      avg: number;
      total: number;
      weeks: (number | null)[];
    }

    const rows: ParsedRow[] = [];
    let skippedKDst = 0;
    const validationIssues: { row: number; field: string; value: string; problem: string }[] = [];
    const dataLines = lines.slice(1);

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      const fields = line.split(",");
      if (fields.length < avgIdx + 2) continue;

      const lineNum = i + 2; // 1-indexed, accounting for header
      const rank = parseInt(fields[0], 10);
      if (isNaN(rank)) {
        validationIssues.push({ row: lineNum, field: "RK", value: fields[0], problem: "Non-numeric rank" });
        continue;
      }

      const position = fields[2].trim();
      if (SKIP_POSITIONS.has(position)) {
        skippedKDst++;
        continue;
      }

      if (!VALID_POSITIONS.has(position)) {
        validationIssues.push({ row: lineNum, field: "POS", value: position, problem: "Invalid position" });
        continue;
      }

      const { name, team } = parsePlayer(fields[1]);
      if (!name) {
        validationIssues.push({ row: lineNum, field: "PLAYER", value: fields[1], problem: "Empty player name" });
        continue;
      }

      const gp = parseInt(fields[3], 10) || 0;
      const avg = parseFloat(fields[avgIdx]) || 0;
      const total = parseFloat(fields[ttlIdx]) || 0;

      // Parse weekly scores (pad to 18 with null)
      const weeks: (number | null)[] = [];
      for (let w = 0; w < 18; w++) {
        if (w < numWeeks) {
          weeks.push(parseWeekScore(fields[weekStartIdx + w] || ""));
        } else {
          weeks.push(null);
        }
      }

      rows.push({ rank, name, team, position, gp, avg, total, weeks });
    }

    // Check for duplicates (same name+position)
    const seen = new Map<string, number>();
    const duplicateNames: string[] = [];
    for (const row of rows) {
      const key = `${row.name}::${row.position}`;
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    for (const [key, count] of seen) {
      if (count > 1) {
        duplicateNames.push(`${key.split("::")[0]} (${key.split("::")[1]}) x${count}`);
      }
    }

    const sampleRows = rows.slice(0, 5).map((r) => ({
      rank: r.rank,
      name: r.name,
      team: r.team,
      position: r.position,
      gp: r.gp,
      avg: r.avg,
      total: r.total,
    }));

    ctx.log.info(`Parsed ${rows.length} valid rows, skipped ${skippedKDst} K/DST, ${validationIssues.length} issues, ${duplicateNames.length} duplicates`);

    // If dry run, return preview
    if (dryRun) {
      return {
        season,
        filename,
        columnNames,
        totalRows: dataLines.length,
        validRows: rows.length,
        skippedKDst,
        duplicateCount: duplicateNames.length,
        duplicateNames,
        validationIssues,
        sampleRows,
        inserted: 0,
        seasonAlreadyLoaded,
        existingRowCount,
        message: `Preview: ${rows.length} players parsed for ${season}. ${skippedKDst} K/DST skipped. ${validationIssues.length} issues. Ready to seed.`,
      };
    }

    // --- Commit mode ---

    // Clear existing data if replacing
    if (seasonAlreadyLoaded && forceReplace) {
      await ctx.integrations.apps_db.execute(
        `DELETE FROM ffwr_season_actuals WHERE season = $1`,
        [season],
        { label: `Clear existing actuals for ${season}` },
      );
      ctx.log.info(`Cleared ${existingRowCount} existing rows for ${season}`);
    }

    // Compute positional ranks and insert in batches of 20
    const posRankTracker: Record<string, number> = {};
    const BATCH_SIZE = 20;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);

      const placeholders = batch
        .map((_, idx) => {
          const base = idx * 27 + 1;
          const params = [];
          for (let p = 0; p < 27; p++) {
            params.push(`$${base + p}`);
          }
          return `(${params.join(", ")})`;
        })
        .join(", ");

      const params: (string | number | null)[] = [];
      for (const row of batch) {
        posRankTracker[row.position] = (posRankTracker[row.position] || 0) + 1;
        const posRank = posRankTracker[row.position];

        params.push(
          season,
          row.rank,
          row.name,
          row.team,
          row.position,
          row.gp,
          row.avg,
          row.total,
          posRank,
          ...row.weeks,
        );
      }

      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_season_actuals (
          season, overall_rank, player_name, nfl_team, position, games_played,
          avg_points, total_points, positional_rank,
          week_1, week_2, week_3, week_4, week_5, week_6, week_7, week_8, week_9,
          week_10, week_11, week_12, week_13, week_14, week_15, week_16, week_17, week_18
        ) VALUES ${placeholders}
        ON CONFLICT (season, player_name, position) DO UPDATE SET
          overall_rank = EXCLUDED.overall_rank,
          nfl_team = EXCLUDED.nfl_team,
          games_played = EXCLUDED.games_played,
          avg_points = EXCLUDED.avg_points,
          total_points = EXCLUDED.total_points,
          positional_rank = EXCLUDED.positional_rank,
          week_1 = EXCLUDED.week_1, week_2 = EXCLUDED.week_2, week_3 = EXCLUDED.week_3,
          week_4 = EXCLUDED.week_4, week_5 = EXCLUDED.week_5, week_6 = EXCLUDED.week_6,
          week_7 = EXCLUDED.week_7, week_8 = EXCLUDED.week_8, week_9 = EXCLUDED.week_9,
          week_10 = EXCLUDED.week_10, week_11 = EXCLUDED.week_11, week_12 = EXCLUDED.week_12,
          week_13 = EXCLUDED.week_13, week_14 = EXCLUDED.week_14, week_15 = EXCLUDED.week_15,
          week_16 = EXCLUDED.week_16, week_17 = EXCLUDED.week_17, week_18 = EXCLUDED.week_18`,
        params,
        { label: `Insert actuals batch ${Math.floor(i / BATCH_SIZE) + 1} for ${season}` },
      );

      totalInserted += batch.length;
    }

    return {
      season,
      filename,
      columnNames,
      totalRows: dataLines.length,
      validRows: rows.length,
      skippedKDst,
      duplicateCount: duplicateNames.length,
      duplicateNames,
      validationIssues,
      sampleRows,
      inserted: totalInserted,
      seasonAlreadyLoaded,
      existingRowCount,
      message: `Seeded ${totalInserted} players for season ${season} (skipped ${skippedKDst} K/DST).`,
    };
  },
});
