import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

/**
 * Parse player name and NFL team from FantasyPros PPR leaderboard format.
 * Examples:
 *   "Christian McCaffrey   CAR" → { name: "Christian McCaffrey", team: "CAR" }
 *   "Patrick Mahomes II   KC"  → { name: "Patrick Mahomes II", team: "KC" }
 *   "Aaron Jones Sr.   GB"     → { name: "Aaron Jones Sr.", team: "GB" }
 */
function parsePlayer(raw: string): { name: string; team: string } {
  // Split on 2+ spaces — the name is everything before, team is the last token
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

export default api({
  name: "SeedSeasonActuals",
  description: "Seeds PPR scoring leader data from a FantasyPros CSV into ffwr_season_actuals for a given season.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvData: z.string().describe("Raw CSV text from FantasyPros PPR leaders"),
    yearLabel: z.string().describe("End-year label, e.g. '2019' for the 2018-19 season"),
    replaceExisting: z.boolean().default(true).describe("If true, clear existing data for this season first"),
    dryRun: z.boolean().default(false).describe("If true, parse only — don't insert"),
  }),

  output: z.object({
    season: z.string(),
    parsed: z.number(),
    inserted: z.number(),
    skippedPositions: z.number(),
    sampleRows: z.array(z.object({
      rank: z.number(),
      name: z.string(),
      team: z.string(),
      position: z.string(),
      gp: z.number(),
      avg: z.number(),
      total: z.number(),
    })),
    message: z.string(),
  }),

  async run(ctx, { csvData, yearLabel, replaceExisting, dryRun }) {
    const season = yearToSeason(yearLabel);
    ctx.log.info(`Parsing PPR leaders for season ${season} (label: ${yearLabel})`);

    const lines = csvData.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) throw new Error("CSV must have at least a header and one data row");

    // Parse header to determine number of weeks
    const header = lines[0].split(",");
    // Format: RK, PLAYER, POS, GP, 1..N, AVG, TTL
    // Find AVG column index — everything between GP and AVG are week columns
    const avgIdx = header.findIndex((h) => h.trim().toUpperCase() === "AVG");
    const ttlIdx = header.findIndex((h) => h.trim().toUpperCase() === "TTL");
    if (avgIdx === -1 || ttlIdx === -1) throw new Error("CSV header must contain AVG and TTL columns");

    const weekStartIdx = 4; // Week columns start at index 4 (after RK, PLAYER, POS, GP)
    const numWeeks = avgIdx - weekStartIdx;
    ctx.log.info(`Detected ${numWeeks} weeks in CSV`);

    const SKIP_POSITIONS = new Set(["K", "DST"]);
    const dataLines = lines.slice(1);

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
    let skippedPositions = 0;

    // Track positional ranks
    const positionCounts: Record<string, number> = {};

    for (const line of dataLines) {
      const fields = line.split(",");
      if (fields.length < avgIdx + 2) continue;

      const rank = parseInt(fields[0], 10);
      if (isNaN(rank)) continue;

      const position = fields[2].trim();
      if (SKIP_POSITIONS.has(position)) {
        skippedPositions++;
        continue;
      }

      const { name, team } = parsePlayer(fields[1]);
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

      // Track positional rank
      positionCounts[position] = (positionCounts[position] || 0) + 1;

      rows.push({
        rank,
        name,
        team,
        position,
        gp,
        avg,
        total,
        weeks,
      });
    }

    ctx.log.info(`Parsed ${rows.length} players (skipped ${skippedPositions} K/DST)`);

    const sampleRows = rows.slice(0, 5).map((r) => ({
      rank: r.rank,
      name: r.name,
      team: r.team,
      position: r.position,
      gp: r.gp,
      avg: r.avg,
      total: r.total,
    }));

    if (dryRun) {
      return {
        season,
        parsed: rows.length,
        inserted: 0,
        skippedPositions,
        sampleRows,
        message: `Dry run: parsed ${rows.length} players for ${season}. No data inserted.`,
      };
    }

    // Clear existing data for this season if requested
    if (replaceExisting) {
      await ctx.integrations.apps_db.execute(
        `DELETE FROM ffwr_season_actuals WHERE season = $1`,
        [season],
        { label: `Clear existing actuals for ${season}` },
      );
    }

    // Recompute positional ranks based on overall_rank order per position
    const posRankTracker: Record<string, number> = {};

    // Insert in batches of 20 (22 params per row × 20 = 440 params)
    const BATCH_SIZE = 20;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const COLS_PER_ROW = 24; // season + rank + name + team + pos + gp + avg + total + posRank + 18 weeks - 3 = 24... let me count

      // 24 columns: season, overall_rank, player_name, nfl_team, position, games_played,
      // avg_points, total_points, positional_rank, week_1..week_18
      const placeholders = batch
        .map((_, idx) => {
          const base = idx * 27 + 1; // 27 params per row
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
      parsed: rows.length,
      inserted: totalInserted,
      skippedPositions,
      sampleRows,
      message: `Seeded ${totalInserted} players for season ${season} (skipped ${skippedPositions} K/DST).`,
    };
  },
});
