import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizePlayerName } from "../../lib/normalize-player-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const SeasonCountSchema = z.object({
  season: z.coerce.number(),
  cnt: z.coerce.number(),
});

export default api({
  name: "SeedHistoricalKeepersPicks",
  description: "Creates tables and seeds historical keepers + draft picks from CSV text.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    keepersCsv: z.string().optional(),
    draftPicksCsv: z.string().optional(),
  }),

  output: z.object({
    keepersInserted: z.number(),
    keepersSkipped: z.number(),
    keepersBySeason: z.array(z.object({ season: z.number(), count: z.number() })),
    picksInserted: z.number(),
    picksBySeason: z.array(z.object({ season: z.number(), count: z.number() })),
    duplicateKeepers: z.number(),
    duplicatePicks: z.number(),
    message: z.string(),
  }),

  async run(ctx, { keepersCsv, draftPicksCsv }) {
    if (!keepersCsv && !draftPicksCsv) {
      throw new Error("Provide at least one CSV: keepersCsv or draftPicksCsv");
    }

    // Helper: strip BOM and detect delimiter from header row
    function prepCsv(raw: string): { lines: string[]; delimiter: string } {
      const cleaned = raw.replace(/^\uFEFF/, ""); // strip UTF-8 BOM
      const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const header = lines[0] ?? "";
      // Auto-detect: tab > semicolon > comma (default)
      const delimiter = header.includes("\t") ? "\t" : header.includes(";") ? ";" : ",";
      return { lines, delimiter };
    }
    // 1. Create tables
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_historical_keepers (
        id SERIAL PRIMARY KEY,
        season INTEGER NOT NULL,
        manager TEXT NOT NULL,
        player TEXT NOT NULL,
        position TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(season, manager, player)
      )`,
      undefined,
      { label: "Create keepers table" },
    );

    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_historical_draft_picks (
        id SERIAL PRIMARY KEY,
        draft_year INTEGER NOT NULL,
        pick INTEGER NOT NULL,
        player TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(draft_year, pick)
      )`,
      undefined,
      { label: "Create draft picks table" },
    );

    // 2. Parse keepers CSV (if provided)
    const CHUNK = 50;
    let keepersInserted = 0;
    let keepersSkipped = 0;
    type KeeperRow = { season: number; manager: string; player: string; position: string };
    const keeperRows: KeeperRow[] = [];

    if (keepersCsv) {
    const { lines: keeperLines, delimiter: keeperDelim } = prepCsv(keepersCsv);
    if (keeperLines.length < 2) throw new Error("Keepers CSV must have header + data rows");

    for (let i = 1; i < keeperLines.length; i++) {
      const cols = keeperLines[i].split(keeperDelim).map((c) => c.trim());
      const season = parseInt(cols[0]);
      const manager = cols[1] || "";
      const rawPlayer = cols[2] || "";
      const position = cols[3] || "";

      // Skip placeholder rows (manager kept no one)
      if (!rawPlayer || rawPlayer === "--" || !manager) {
        keepersSkipped++;
        continue;
      }

      const player = normalizePlayerName(rawPlayer);
      keeperRows.push({ season, manager, player, position });
    }

    // Batch insert keepers
    for (let c = 0; c < keeperRows.length; c += CHUNK) {
      const chunk = keeperRows.slice(c, c + CHUNK);
      const values: string[] = [];
      const params: (string | number)[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const o = j * 4;
        values.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4})`);
        params.push(row.season, row.manager, row.player, row.position);
      }
      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_historical_keepers (season, manager, player, position)
         VALUES ${values.join(", ")}
         ON CONFLICT (season, manager, player) DO NOTHING`,
        params,
        { label: `Keepers batch ${Math.floor(c / CHUNK) + 1}` },
      );
      keepersInserted += chunk.length;
    }
    } // end if keepersCsv

    // 3. Parse draft picks CSV (if provided)
    let picksInserted = 0;
    if (draftPicksCsv) {
    const { lines: pickLines, delimiter: pickDelim } = prepCsv(draftPicksCsv);
    if (pickLines.length < 2) throw new Error("Draft picks CSV must have header + data rows");

    type PickRow = { draftYear: number; pick: number; player: string };
    const pickRows: PickRow[] = [];

    for (let i = 1; i < pickLines.length; i++) {
      const cols = pickLines[i].split(pickDelim).map((c) => c.trim());
      const draftYear = parseInt(cols[0]);
      const pick = parseInt(cols[1]);
      const rawPlayer = cols[2] || "";
      if (!rawPlayer) continue;

      const player = normalizePlayerName(rawPlayer);
      pickRows.push({ draftYear, pick, player });
    }

    // Batch insert draft picks
    for (let c = 0; c < pickRows.length; c += CHUNK) {
      const chunk = pickRows.slice(c, c + CHUNK);
      const values: string[] = [];
      const params: (string | number)[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const o = j * 3;
        values.push(`($${o + 1}, $${o + 2}, $${o + 3})`);
        params.push(row.draftYear, row.pick, row.player);
      }
      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_historical_draft_picks (draft_year, pick, player)
         VALUES ${values.join(", ")}
         ON CONFLICT (draft_year, pick) DO NOTHING`,
        params,
        { label: `Picks batch ${Math.floor(c / CHUNK) + 1}` },
      );
      picksInserted += chunk.length;
    }
    } // end if draftPicksCsv

    // 4. Validate — counts per season
    const keeperCounts = await ctx.integrations.apps_db.query(
      `SELECT season, COUNT(*) AS cnt FROM ffwr_historical_keepers GROUP BY season ORDER BY season`,
      SeasonCountSchema,
      undefined,
      { label: "Keeper counts by season" },
    );

    const pickCounts = await ctx.integrations.apps_db.query(
      `SELECT draft_year AS season, COUNT(*) AS cnt FROM ffwr_historical_draft_picks GROUP BY draft_year ORDER BY draft_year`,
      SeasonCountSchema,
      undefined,
      { label: "Pick counts by season" },
    );

    // 5. Check for duplicates (should be 0 given unique constraints, but verify source data)
    const DupCountSchema = z.object({ dup_count: z.coerce.number() });

    const keeperDups = await ctx.integrations.apps_db.query(
      `SELECT COUNT(*) AS dup_count FROM (
        SELECT season, manager, player FROM ffwr_historical_keepers
        GROUP BY season, manager, player HAVING COUNT(*) > 1
      ) dupes`,
      DupCountSchema,
      undefined,
      { label: "Check keeper duplicates" },
    );

    const pickDups = await ctx.integrations.apps_db.query(
      `SELECT COUNT(*) AS dup_count FROM (
        SELECT draft_year, pick FROM ffwr_historical_draft_picks
        GROUP BY draft_year, pick HAVING COUNT(*) > 1
      ) dupes`,
      DupCountSchema,
      undefined,
      { label: "Check pick duplicates" },
    );

    const keepersBySeason = keeperCounts.map((r) => ({ season: r.season, count: r.cnt }));
    const picksBySeason = pickCounts.map((r) => ({ season: r.season, count: r.cnt }));
    const dupKeepers = keeperDups[0]?.dup_count ?? 0;
    const dupPicks = pickDups[0]?.dup_count ?? 0;

    return {
      keepersInserted,
      keepersSkipped,
      keepersBySeason,
      picksInserted,
      picksBySeason,
      duplicateKeepers: dupKeepers,
      duplicatePicks: dupPicks,
      message:
        keepersCsv && keepersInserted === 0
          ? `Warning: 0 keepers inserted from ${keeperRows.length + keepersSkipped} rows (${keepersSkipped} placeholders). Check that the CSV uses columns: season, manager, player, position.`
          : `Seeded ${keepersInserted} keepers (${keepersSkipped} placeholders skipped) and ${picksInserted} draft picks. Duplicates: keepers=${dupKeepers}, picks=${dupPicks}.`,
    };
  },
});
