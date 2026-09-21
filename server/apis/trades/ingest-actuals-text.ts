import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const VALID_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);
const SKIP_POSITIONS = new Set(["K", "DST"]);

function parsePlayer(raw: string): { name: string; team: string } {
  const parts = raw.split(/\s{2,}/);
  if (parts.length >= 2) return { name: parts[0].trim(), team: parts[parts.length - 1].trim() };
  return { name: raw.trim(), team: "" };
}

function parseWeekScore(val: string): number | null {
  const t = val.trim();
  if (!t || t.toUpperCase() === "BYE") return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

export default api({
  name: "IngestActualsText",
  description: "One-off: ingest actuals from CSV text (no file upload needed).",
  integrations: { apps_db: postgres(APPS_DB) },
  input: z.object({
    csvText: z.string(),
    season: z.string(),
  }),
  output: z.object({
    inserted: z.number(),
    weeksDetected: z.number(),
    skippedKDst: z.number(),
    message: z.string(),
  }),
  async run(ctx, { csvText, season }) {
    const lines = csvText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) throw new Error("Need header + data");

    const header = lines[0].split(",");
    const avgIdx = header.findIndex(h => h.trim().toUpperCase() === "AVG");
    const ttlIdx = header.findIndex(h => h.trim().toUpperCase() === "TTL");
    if (avgIdx === -1 || ttlIdx === -1) throw new Error("Missing AVG/TTL columns");

    const weekStartIdx = 4;
    const numWeeks = avgIdx - weekStartIdx;
    ctx.log.info(`Detected ${numWeeks} weeks, ${lines.length - 1} data rows`);

    interface Row { rank: number; name: string; team: string; position: string; gp: number; avg: number; total: number; weeks: (number | null)[] }
    const rows: Row[] = [];
    let skippedKDst = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields = lines[i].split(",");
      if (fields.length < avgIdx + 2) continue;
      const rank = parseInt(fields[0], 10);
      if (isNaN(rank)) continue;
      const position = fields[2].trim();
      if (SKIP_POSITIONS.has(position)) { skippedKDst++; continue; }
      if (!VALID_POSITIONS.has(position)) continue;
      const { name, team } = parsePlayer(fields[1]);
      if (!name) continue;
      const gp = parseInt(fields[3], 10) || 0;
      const avg = parseFloat(fields[avgIdx]) || 0;
      const total = parseFloat(fields[ttlIdx]) || 0;
      const weeks: (number | null)[] = [];
      for (let w = 0; w < 18; w++) {
        weeks.push(w < numWeeks ? parseWeekScore(fields[weekStartIdx + w] || "") : null);
      }
      rows.push({ rank, name, team, position, gp, avg, total, weeks });
    }

    ctx.log.info(`Parsed ${rows.length} valid rows, ${skippedKDst} K/DST skipped`);

    const posRankTracker: Record<string, number> = {};
    const BATCH_SIZE = 20;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const placeholders = batch.map((_, idx) => {
        const base = idx * 27 + 1;
        return `(${Array.from({ length: 27 }, (_, p) => `$${base + p}`).join(", ")})`;
      }).join(", ");

      const params: (string | number | null)[] = [];
      for (const row of batch) {
        posRankTracker[row.position] = (posRankTracker[row.position] || 0) + 1;
        params.push(season, row.rank, row.name, row.team, row.position, row.gp, row.avg, row.total, posRankTracker[row.position], ...row.weeks);
      }

      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_season_actuals (
          season, overall_rank, player_name, nfl_team, position, games_played,
          avg_points, total_points, positional_rank,
          week_1, week_2, week_3, week_4, week_5, week_6, week_7, week_8, week_9,
          week_10, week_11, week_12, week_13, week_14, week_15, week_16, week_17, week_18
        ) VALUES ${placeholders}
        ON CONFLICT (season, player_name, position) DO UPDATE SET
          overall_rank = EXCLUDED.overall_rank, nfl_team = EXCLUDED.nfl_team,
          games_played = EXCLUDED.games_played, avg_points = EXCLUDED.avg_points,
          total_points = EXCLUDED.total_points, positional_rank = EXCLUDED.positional_rank,
          week_1 = EXCLUDED.week_1, week_2 = EXCLUDED.week_2, week_3 = EXCLUDED.week_3,
          week_4 = EXCLUDED.week_4, week_5 = EXCLUDED.week_5, week_6 = EXCLUDED.week_6,
          week_7 = EXCLUDED.week_7, week_8 = EXCLUDED.week_8, week_9 = EXCLUDED.week_9,
          week_10 = EXCLUDED.week_10, week_11 = EXCLUDED.week_11, week_12 = EXCLUDED.week_12,
          week_13 = EXCLUDED.week_13, week_14 = EXCLUDED.week_14, week_15 = EXCLUDED.week_15,
          week_16 = EXCLUDED.week_16, week_17 = EXCLUDED.week_17, week_18 = EXCLUDED.week_18`,
        params,
        { label: `Insert actuals batch ${Math.floor(i / BATCH_SIZE) + 1}` },
      );
      totalInserted += batch.length;
    }

    return { inserted: totalInserted, weeksDetected: numWeeks, skippedKDst, message: `Seeded ${totalInserted} players for ${season} with ${numWeeks} weeks.` };
  },
});
