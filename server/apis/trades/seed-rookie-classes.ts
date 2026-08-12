import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "SeedRookieClasses",
  description: "Seeds ffwr_rookie_classes from CSV data (NFL Draft 2018-2026).",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvData: z.string(),
    appendMode: z.boolean().optional(),
    dryRun: z.boolean().optional(),
  }),

  output: z.object({
    parsed: z.number(),
    inserted: z.number(),
    skipped: z.number(),
    errors: z.array(z.string()),
    sample: z.array(z.object({
      nfl_draft_year: z.number(),
      overall_pick: z.number(),
      player_name: z.string(),
      position: z.string(),
      age_on_draft_day: z.number(),
    })),
  }),

  async run(ctx, { csvData, appendMode, dryRun }) {
    // ── 0. Ensure table exists ──────────────────────────────────
    await ctx.integrations.apps_db.execute(`
      CREATE TABLE IF NOT EXISTS ffwr_rookie_classes (
        id SERIAL PRIMARY KEY,
        nfl_draft_year INTEGER NOT NULL,
        overall_pick INTEGER NOT NULL,
        player_name TEXT NOT NULL,
        position TEXT,
        age_on_draft_day INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `, undefined, { label: "Ensure ffwr_rookie_classes table" });

    // ── 1. Parse CSV ────────────────────────────────────────────
    const lines = csvData.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      return { parsed: 0, inserted: 0, skipped: 0, errors: ["No data rows found"], sample: [] };
    }

    // Detect header
    const header = lines[0].toLowerCase();
    const startIdx = header.includes("year") || header.includes("rank") ? 1 : 0;

    interface RookieRow {
      nfl_draft_year: number;
      overall_pick: number;
      player_name: string;
      position: string;
      age_on_draft_day: number;
    }

    const rows: RookieRow[] = [];
    const errors: string[] = [];

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      // CSV parse: split by comma, handle quoted fields
      const cols = parseCSVLine(line);
      if (cols.length < 5) {
        errors.push(`Line ${i + 1}: not enough columns (${cols.length})`);
        continue;
      }

      const year = parseInt(cols[0], 10);
      const pick = parseInt(cols[1], 10);
      const name = cols[2].trim();
      const position = cols[3].trim();
      const age = parseInt(cols[4], 10);

      if (isNaN(year) || isNaN(pick) || isNaN(age) || !name) {
        errors.push(`Line ${i + 1}: invalid data — year=${cols[0]}, pick=${cols[1]}, name=${cols[2]}, age=${cols[4]}`);
        continue;
      }

      rows.push({ nfl_draft_year: year, overall_pick: pick, player_name: name, position, age_on_draft_day: age });
    }

    ctx.log.info("Parsed rookie class CSV", { total: rows.length, errors: errors.length });

    if (dryRun) {
      return {
        parsed: rows.length,
        inserted: 0,
        skipped: 0,
        errors: errors.slice(0, 20),
        sample: rows.slice(0, 10),
      };
    }

    // ── 2. Clear if not append ──────────────────────────────────
    if (!appendMode) {
      await ctx.integrations.apps_db.execute(
        "DELETE FROM ffwr_rookie_classes",
        undefined,
        { label: "Clear existing rookie classes" },
      );
    }

    // ── 3. Batch insert ─────────────────────────────────────────
    const BATCH = 100;
    let inserted = 0;
    let skipped = 0;

    for (let b = 0; b < rows.length; b += BATCH) {
      const batch = rows.slice(b, b + BATCH);

      // Build multi-row VALUES
      const values: unknown[] = [];
      const placeholders: string[] = [];
      batch.forEach((r, idx) => {
        const off = idx * 5;
        placeholders.push(`($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5})`);
        values.push(r.nfl_draft_year, r.overall_pick, r.player_name, r.position, r.age_on_draft_day);
      });

      const sql = `
        INSERT INTO ffwr_rookie_classes (nfl_draft_year, overall_pick, player_name, position, age_on_draft_day)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT DO NOTHING
      `;

      const result = await ctx.integrations.apps_db.execute(sql, values, {
        label: `Insert rookie batch ${Math.floor(b / BATCH) + 1}`,
      });

      inserted += result.rowCount;
    }

    skipped = rows.length - inserted;

    return {
      parsed: rows.length,
      inserted,
      skipped,
      errors: errors.slice(0, 20),
      sample: rows.slice(0, 5),
    };
  },
});

/** Simple CSV line parser that handles quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}
