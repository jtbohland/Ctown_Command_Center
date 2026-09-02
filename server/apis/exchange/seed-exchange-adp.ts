import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

/**
 * Parse a player name from FantasyPros CSV format, stripping team/bye annotations.
 * "Alvin Kamara   NO (6)" → "Alvin Kamara"
 */
function cleanPlayerName(raw: string): string {
  return raw.replace(/\s{2,}[A-Z]{2,3}\s*\(\d+\)/, "").trim();
}

/**
 * Extract NFL team code from FantasyPros format.
 * "Alvin Kamara   NO (6)" → "NO"
 */
function extractNflTeam(raw: string): string | null {
  const match = raw.match(/\s{2,}([A-Z]{2,3})\s*\(\d+\)/);
  return match ? match[1] : null;
}

/** Extract base position from POS column ("RB5" → "RB", "WR14" → "WR") */
function extractPosition(posRank: string): string {
  return posRank.replace(/\d+$/, "");
}

export default api({
  name: "SeedExchangeAdp",
  description: "Parses a FantasyPros-format ADP CSV and seeds ffwr_exchange_adp for Exchange grades.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvData: z.string().describe("Raw CSV string with headers: Rank,Player (Bye),POS,..."),
    dryRun: z.boolean().default(false).describe("If true, parse only — do not insert"),
  }),

  output: z.object({
    parsed: z.number(),
    inserted: z.number(),
    skippedPositions: z.number(),
    previousCount: z.number(),
    sampleRows: z.array(z.object({
      rank: z.number(),
      name: z.string(),
      position: z.string(),
      nflTeam: z.string().nullable(),
    })),
    message: z.string(),
  }),

  async run(ctx, { csvData, dryRun }) {
    requireAdmin(ctx, "seed exchange ADP");

    // Parse CSV
    const lines = csvData.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length < 2) throw new Error("CSV must have at least a header and one data row");

    const dataLines = lines.slice(1);
    const SKIP_POSITIONS = new Set(["DST", "K"]);

    const rows: Array<{ rank: number; name: string; position: string; nflTeam: string | null }> = [];
    let skippedPositions = 0;

    for (const line of dataLines) {
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
      const nflTeam = extractNflTeam(rawName);
      rows.push({ rank, name, position, nflTeam });
    }

    ctx.log.info(`Parsed ${rows.length} players from CSV (skipped ${skippedPositions} DST/K)`);

    const sampleRows = rows.slice(0, 5);

    // Check existing count
    const CountSchema = z.object({ cnt: z.coerce.number() });
    const [{ cnt: previousCount }] = await ctx.integrations.apps_db.query(
      `SELECT COUNT(*) as cnt FROM ffwr_exchange_adp`,
      CountSchema,
      undefined,
      { label: "Count existing exchange ADP rows" },
    );

    if (dryRun) {
      return {
        parsed: rows.length,
        inserted: 0,
        skippedPositions,
        previousCount,
        sampleRows,
        message: `Dry run: parsed ${rows.length} players. ${previousCount} existing rows would be replaced.`,
      };
    }

    // Clear existing data — full replace on each upload
    await ctx.integrations.apps_db.execute(
      `DELETE FROM ffwr_exchange_adp WHERE 1=1`,
      undefined,
      { label: "Clear existing exchange ADP" },
    );

    // Insert in batches of 30
    const BATCH_SIZE = 30;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const placeholders = batch
        .map((_, idx) => `($${idx * 4 + 1}, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4})`)
        .join(", ");
      const params = batch.flatMap((r) => [r.name, r.position, r.rank, r.nflTeam]);

      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_exchange_adp (player_name, position, adp_rank, nfl_team)
         VALUES ${placeholders}`,
        params,
        { label: `Insert exchange ADP batch ${Math.floor(i / BATCH_SIZE) + 1}` },
      );

      totalInserted += batch.length;
    }

    return {
      parsed: rows.length,
      inserted: totalInserted,
      skippedPositions,
      previousCount,
      sampleRows,
      message: `Replaced ${previousCount} → ${totalInserted} players in Exchange ADP (skipped ${skippedPositions} DST/K).`,
    };
  },
});
