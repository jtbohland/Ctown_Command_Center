import { api, z, postgres, readableFileSchema } from "@superblocksteam/sdk-api";
import { normalizePlayerName } from "../../lib/normalize-player-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "UploadPlayers",
  description: "Parses CSV and upserts players/rankings/keepers based on mode.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvFile: z.object({
      files: z.array(readableFileSchema).min(1),
    }),
    mode: z.enum(["players", "keepers", "dynasty", "rookie", "roster"]).default("players"),
  }),

  output: z.object({
    imported: z.number(),
    updated: z.number(),
    message: z.string(),
    warnings: z.array(z.string()).optional(),
  }),

  async run(ctx, { csvFile, mode }) {
    const file = csvFile.files[0];
    const content = await file.readContentsAsync();
    const text = typeof content === "string" ? content : String(content);

    const lines: string[] = text.split(/\r?\n/).filter((line: string) => line.trim().length > 0);
    if (lines.length < 2) {
      throw new Error("CSV must have a header row and at least one data row.");
    }

    // Smart CSV parser that handles quoted fields
    function parseCsvLine(line: string): string[] {
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

    const headerLine = parseCsvLine(lines[0]);
    const header: string[] = headerLine.map((h: string) => h.toLowerCase().replace(/['"]/g, ""));

    // ── KEEPER MODE: CSV with team_name, player_name columns ──
    if (mode === "keepers") {
      const teamCol = header.findIndex((h: string) => h.includes("team"));
      const playerCol = header.findIndex((h: string) => h.includes("player") || h.includes("name"));
      if (teamCol === -1 || playerCol === -1) {
        throw new Error("Keeper CSV must have 'team' and 'player' columns. Found: " + header.join(", "));
      }

      // Clear all existing keepers first
      await ctx.integrations.apps_db.execute(
        "UPDATE ffwr_players SET is_keeper = false, keeper_team_id = NULL, is_drafted = false, drafted_team_id = NULL WHERE is_keeper = true",
        [],
        { label: "Clear all keepers" }
      );

      let assigned = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols: string[] = parseCsvLine(lines[i]);
        const teamName = (cols[teamCol] || "").trim();
        const playerName = (cols[playerCol] || "").trim();
        if (!teamName || !playerName) continue;

        // Find team by name (fuzzy)
        const teamResult = await ctx.integrations.apps_db.query(
          "SELECT id FROM ffwr_teams WHERE LOWER(team_name) LIKE LOWER($1) LIMIT 1",
          z.object({ id: z.number() }),
          [`%${teamName}%`],
          { label: `Find team: ${teamName}` }
        );
        if (teamResult.length === 0) continue;

        // Find player by name (fuzzy)
        const playerResult = await ctx.integrations.apps_db.query(
          "SELECT id FROM ffwr_players WHERE LOWER(name) LIKE LOWER($1) LIMIT 1",
          z.object({ id: z.number() }),
          [`%${playerName}%`],
          { label: `Find player: ${playerName}` }
        );
        if (playerResult.length === 0) continue;

        await ctx.integrations.apps_db.execute(
          "UPDATE ffwr_players SET is_keeper = true, keeper_team_id = $1, is_drafted = true, drafted_team_id = $1 WHERE id = $2",
          [teamResult[0].id, playerResult[0].id],
          { label: `Assign keeper: ${playerName} → ${teamName}` }
        );
        assigned++;
      }

      return { imported: assigned, updated: 0, message: `Assigned ${assigned} keepers from CSV.` };
    }

    // ── ROSTER MODE: CSV with team, player columns → assigns roster_team_id ──
    if (mode === "roster") {
      const rTeamCol = header.findIndex((h: string) => h.includes("team") || h.includes("manager"));
      const rPlayerCol = header.findIndex((h: string) => h.includes("player") || h.includes("name"));
      if (rTeamCol === -1 || rPlayerCol === -1) {
        throw new Error("Roster CSV must have 'team' and 'player' columns. Found: " + header.join(", "));
      }

      // Ensure roster_team_id column exists
      await ctx.integrations.apps_db.execute(
        `ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS roster_team_id INTEGER REFERENCES ffwr_teams(id)`,
        undefined,
        { label: "Ensure roster_team_id column" }
      );

      // Clear all existing roster assignments
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players SET roster_team_id = NULL`,
        undefined,
        { label: "Clear existing roster assignments" }
      );

      // Re-assign keepers
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players SET roster_team_id = keeper_team_id WHERE is_keeper = true AND keeper_team_id IS NOT NULL`,
        undefined,
        { label: "Restore keeper roster assignments" }
      );

      let assigned = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols: string[] = parseCsvLine(lines[i]);
        const teamName = (cols[rTeamCol] || "").trim();
        const playerName = (cols[rPlayerCol] || "").trim();
        if (!teamName || !playerName) continue;

        // Find team by name or manager name (fuzzy)
        const teamResult = await ctx.integrations.apps_db.query(
          `SELECT id FROM ffwr_teams WHERE LOWER(team_name) LIKE LOWER($1) OR LOWER(manager_name) LIKE LOWER($1) LIMIT 1`,
          z.object({ id: z.number() }),
          [`%${teamName}%`],
          { label: `Find team: ${teamName}` }
        );
        if (teamResult.length === 0) continue;

        // Find player by name (fuzzy)
        const playerResult = await ctx.integrations.apps_db.query(
          `SELECT id FROM ffwr_players WHERE LOWER(name) LIKE LOWER($1) LIMIT 1`,
          z.object({ id: z.number() }),
          [`%${playerName}%`],
          { label: `Find player: ${playerName}` }
        );

        if (playerResult.length > 0) {
          await ctx.integrations.apps_db.execute(
            `UPDATE ffwr_players SET roster_team_id = $1 WHERE id = $2`,
            [teamResult[0].id, playerResult[0].id],
            { label: `Roster assign: ${playerName} → ${teamName}` }
          );
          assigned++;
        }
      }

      return { imported: assigned, updated: 0, message: `Assigned ${assigned} players to team rosters from CSV.` };
    }

    // ── DYNASTY MODE: CSV with RK, TIERS, PLAYER NAME, TEAM, POS, AGE ──
    if (mode === "dynasty") {
      const rkIdx = header.findIndex((h: string) => h === "rk" || h === "rank");
      const tierColIdx = header.findIndex((h: string) => h === "tiers" || h === "tier");
      const dnNameIdx = header.findIndex((h: string) => h.includes("player") || (h.includes("name") && !h.includes("team")));
      const dnPosIdx = header.findIndex((h: string) => h === "pos" || h === "position");
      const dnAgeIdx = header.findIndex((h: string) => h === "age");
      const dnTeamIdx = header.findIndex((h: string) => h === "team" || h === "nfl_team");

      if (dnNameIdx === -1 || dnPosIdx === -1) {
        throw new Error("Dynasty CSV must have 'player name' and 'pos' columns. Found: " + header.join(", "));
      }

      // Parse all rows first
      const dynRows: Array<{
        name: string; position: string; dynastyRank: number | null;
        dynastyTier: number | null; age: number | null; nflTeam: string;
        posRank: number | null;
      }> = [];

      for (let i = 1; i < lines.length; i++) {
        const cols: string[] = parseCsvLine(lines[i]);
        const rawName = cols[dnNameIdx] || "";
        const posRaw = cols[dnPosIdx] || "";
        if (!rawName || !posRaw) continue;

        const position = posRaw.replace(/[0-9]/g, "").trim();
        if (!["QB", "RB", "WR", "TE"].includes(position)) continue;

        const name = normalizePlayerName(rawName);
        if (!name) continue;

        dynRows.push({
          name,
          position,
          dynastyRank: rkIdx >= 0 ? parseFloat(cols[rkIdx]) || null : null,
          dynastyTier: tierColIdx >= 0 ? parseInt(cols[tierColIdx]) || null : null,
          age: dnAgeIdx >= 0 ? parseInt(cols[dnAgeIdx]) || null : null,
          nflTeam: dnTeamIdx >= 0 ? (cols[dnTeamIdx] || "").trim() : "",
          posRank: parseInt(posRaw.replace(/[^0-9]/g, "")) || null,
        });
      }

      if (dynRows.length === 0) {
        return { imported: 0, updated: 0, message: "No dynasty players parsed from CSV." };
      }

      // Batch update in chunks of 50 using a VALUES list + FROM join
      const CHUNK = 50;
      let updated = 0;
      for (let c = 0; c < dynRows.length; c += CHUNK) {
        const chunk = dynRows.slice(c, c + CHUNK);
        const values: string[] = [];
        const params: (string | number | null)[] = [];
        for (let j = 0; j < chunk.length; j++) {
          const r = chunk[j];
          const o = j * 7; // 7 params per row
          values.push(`($${o + 1}, $${o + 2}, $${o + 3}::float, $${o + 4}::int, $${o + 5}::int, $${o + 6}::text, $${o + 7}::int)`);
          params.push(r.name, r.position, r.dynastyRank, r.dynastyTier, r.age, r.nflTeam, r.posRank);
        }
        await ctx.integrations.apps_db.execute(
          `UPDATE ffwr_players p SET
             dynasty_rank = COALESCE(v.dynasty_rank, p.dynasty_rank),
             dynasty_tier = COALESCE(v.dynasty_tier, p.dynasty_tier),
             age = COALESCE(v.age, p.age),
             nfl_team = CASE WHEN v.nfl_team <> '' THEN v.nfl_team ELSE p.nfl_team END,
             positional_rank = COALESCE(v.pos_rank, p.positional_rank)
           FROM (VALUES ${values.join(", ")})
             AS v(name, position, dynasty_rank, dynasty_tier, age, nfl_team, pos_rank)
           WHERE LOWER(REPLACE(REPLACE(p.name, '.', ''), ' ', '')) = LOWER(REPLACE(REPLACE(v.name, '.', ''), ' ', ''))
             AND p.position = v.position`,
          params,
          { label: `Batch dynasty update: rows ${c + 1}-${c + chunk.length}` }
        );
        updated += chunk.length;
      }

      return {
        imported: 0,
        updated,
        message: `Updated dynasty rankings for ${updated} players from CSV.`,
      };
    }

    // ── ROOKIE MODE: CSV with pick/overall, player_name, position, age ──
    if (mode === "rookie") {
      const rNameIdx = header.findIndex((h: string) => h.includes("player") || (h.includes("name") && !h.includes("team")));
      const rPosIdx = header.findIndex((h: string) => h === "pos" || h === "position");
      const rPickIdx = header.findIndex((h: string) => h === "overall" || h === "pick" || h === "overall_pick" || h === "rk" || h === "rank");
      const rAgeIdx = header.findIndex((h: string) => h === "age");
      const rYearIdx = header.findIndex((h: string) => h === "year" || h === "draft_year" || h === "nfl_draft_year");

      if (rNameIdx === -1 || rPosIdx === -1) {
        throw new Error("Rookie CSV must have 'player name' and 'pos' columns. Found: " + header.join(", "));
      }

      // Detect draft year from header or default to next year
      const currentYear = new Date().getFullYear();
      let draftYear = currentYear + 1;

      const rows: Array<{ year: number; pick: number; name: string; pos: string; age: number | null }> = [];
      for (let i = 1; i < lines.length; i++) {
        const cols: string[] = parseCsvLine(lines[i]);
        const rawName = (cols[rNameIdx] || "").trim();
        const posRaw = (cols[rPosIdx] || "").trim();
        if (!rawName || !posRaw) continue;
        const position = posRaw.replace(/[0-9]/g, "").trim();
        if (!["QB", "RB", "WR", "TE"].includes(position)) continue;

        const pick = rPickIdx >= 0 ? parseInt(cols[rPickIdx]) || i : i;
        const age = rAgeIdx >= 0 ? parseInt(cols[rAgeIdx]) || null : null;
        const year = rYearIdx >= 0 ? parseInt(cols[rYearIdx]) || draftYear : draftYear;
        draftYear = year; // use detected year for all rows

        rows.push({ year, pick, name: normalizePlayerName(rawName), pos: position, age });
      }

      if (rows.length === 0) {
        return { imported: 0, updated: 0, message: "No rookie players parsed from CSV." };
      }

      // Clear existing data for this draft year, then batch insert
      const targetYear = rows[0].year;
      await ctx.integrations.apps_db.execute(
        `DELETE FROM ffwr_rookie_classes WHERE nfl_draft_year = $1`,
        [targetYear],
        { label: `Clear existing ${targetYear} rookies before re-import` }
      );

      const CHUNK = 50;
      for (let c = 0; c < rows.length; c += CHUNK) {
        const chunk = rows.slice(c, c + CHUNK);
        const values: string[] = [];
        const params: (string | number | null)[] = [];
        for (let j = 0; j < chunk.length; j++) {
          const r = chunk[j];
          const offset = j * 5;
          values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
          params.push(r.year, r.pick, r.name, r.pos, r.age ?? 0);
        }
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_rookie_classes (nfl_draft_year, overall_pick, player_name, position, age_on_draft_day)
           VALUES ${values.join(", ")}`,
          params,
          { label: `Batch insert rookies ${c + 1}-${c + chunk.length}` }
        );
      }

      return { imported: rows.length, updated: 0, message: `Imported ${rows.length} rookies for ${targetYear} draft class (replaced existing).` };
    }

    // ── PLAYER/RANKINGS MODE ──
    // Flexible column detection
    // "player (bye)" or "player" → name col (also extract NFL team + bye from it)
    const nameIdx = header.findIndex((h: string) =>
      h.startsWith("player") || ((h.includes("name") && !h.includes("team")))
    );
    const posIdx = header.findIndex((h: string) => h === "pos" || h === "position");
    // Standalone team column (e.g. "team", "nfl_team")
    const teamIdx = header.findIndex((h: string) => h === "team" || h === "nfl_team");
    // Rank column = overall draft rank (consensus order: 1 = best overall pick)
    const rankIdx = header.findIndex((h: string) => h === "rank" || h === "rk");
    // AVG column = ADP (average draft position across platforms)
    const adpIdx = header.findIndex((h: string) => h === "avg" || h === "avg." || h.includes("adp"));
    const dynIdx = header.findIndex((h: string) => h.includes("dynasty") || h.includes("dyn"));
    // Positional rank extracted from POS column (e.g. "RB1" → 1) - prIdx for explicit col only
    const prIdx = header.findIndex((h: string) => h.includes("positional") || h.includes("pos_rank") || h.includes("posrank"));
    const ptsIdx = header.findIndex((h: string) => h.includes("implied") || h.includes("points") || h.includes("pts"));
    const byeIdx = header.findIndex((h: string) => h === "bye" || h === "bye_week");
    const tierIdx = header.findIndex((h: string) => h === "tiers" || h === "tier");
    const upsideIdx = header.findIndex((h: string) => h.includes("upside"));
    const bustIdx = header.findIndex((h: string) => h.includes("bust"));
    const sosIdx = header.findIndex((h: string) => h.includes("sos"));
    const ageIdx = header.findIndex((h: string) => h === "age");
    // "real-time" column for real-time ADP (fallback for adpIdx)
    const rtIdx = header.findIndex((h: string) => h === "real-time" || h.includes("real"));

    // If no dedicated name column found, check if header contains "player" (it could be "player (bye)")
    if (nameIdx === -1) {
      throw new Error("CSV must have a 'player' or 'name' column. Found headers: " + header.join(", "));
    }
    if (posIdx === -1) {
      throw new Error("CSV must have a 'pos' or 'position' column.");
    }

    // Helper: parse "Player (Bye)" field like "Jahmyr Gibbs   DET (6)" → { name, team, bye }
    function parsePlayerField(raw: string): { name: string; team: string; bye: number | null } {
      // Pattern: "PlayerName   TEAM (bye)"
      // Also handles: "PlayerName TEAM" without bye, or just "PlayerName"
      const byeMatch = raw.match(/\((\d+)\)\s*$/);
      const bye = byeMatch ? parseInt(byeMatch[1]) : null;
      // Remove the bye part
      let cleaned = raw.replace(/\(\d+\)\s*$/, "").trim();
      // Try to extract team abbreviation (2-4 uppercase letters at the end after whitespace)
      const teamMatch = cleaned.match(/\s{2,}([A-Z]{2,4})\s*$/) || cleaned.match(/\s([A-Z]{2,4})\s*$/);
      const team = teamMatch ? teamMatch[1] : "";
      if (team) {
        cleaned = cleaned.replace(new RegExp(`\\s+${team}\\s*$`), "").trim();
      }
      return { name: cleaned, team: team || "FA", bye };
    }

    // Use canonical shared normalizer
    const normalizeName = normalizePlayerName;

    const warnings: string[] = [];
    let imported = 0;
    let updated = 0;

    // Batch upserts for performance: collect all rows, then batch insert
    const batch: Array<{
      name: string; position: string; nflTeam: string;
      adpRank: number | null; dynRank: number | null; posRank: number | null;
      impliedPts: number | null; byeWeek: number | null; draftRank: number | null;
      tier: number | null; upside: string | null; bust: string | null;
      sos: string | null; age: number | null;
    }> = [];

    // ── FIRST PASS: parse all rows to detect CSV shape ──
    const parsedRows: Array<{
      rawName: string; posRaw: string; position: string;
      parsed: { name: string; team: string; bye: number | null };
      name: string; nflTeam: string;
      rawRank: number | null; adpRank: number | null; dynRank: number | null;
      posRank: number | null; posRankFromCol: number | null;
      impliedPts: number | null; byeWeek: number | null;
      tier: number | null; upside: string | null; bust: string | null;
      sos: string | null; age: number | null;
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols: string[] = parseCsvLine(lines[i]);
      const rawName = cols[nameIdx] || "";
      const posRaw = cols[posIdx] || "";
      if (!rawName || !posRaw) continue;

      const position = posRaw.replace(/[0-9]/g, "").trim();
      if (!["QB", "RB", "WR", "TE"].includes(position)) continue;

      const posRankFromCol = parseInt(posRaw.replace(/[^0-9]/g, "")) || null;
      const parsed = parsePlayerField(rawName);
      const name = normalizeName(parsed.name);
      if (!name) continue;

      const nflTeam = parsed.team !== "FA" ? parsed.team : (teamIdx >= 0 ? (cols[teamIdx] || "FA") : "FA");
      const rawRank = rankIdx >= 0 ? parseFloat(cols[rankIdx]) || null : null;
      const adpRank = adpIdx >= 0 ? parseFloat(cols[adpIdx]) || null
        : (rtIdx >= 0 ? parseFloat(cols[rtIdx]) || null : null);
      const dynRank = dynIdx >= 0 ? parseFloat(cols[dynIdx]) || null : null;
      const posRank = prIdx >= 0 ? (parseFloat(cols[prIdx]) || null) : posRankFromCol;
      const impliedPts = ptsIdx >= 0 ? parseFloat(cols[ptsIdx]) || null : null;
      const byeWeek = byeIdx >= 0 ? (parseInt(cols[byeIdx]) || null) : parsed.bye;
      const tier = tierIdx >= 0 ? parseInt(cols[tierIdx]) || null : null;
      const upside = upsideIdx >= 0 ? (cols[upsideIdx] || null) : null;
      const bust = bustIdx >= 0 ? (cols[bustIdx] || null) : null;
      const sos = sosIdx >= 0 ? (cols[sosIdx] || null) : null;
      const age = ageIdx >= 0 ? parseInt(cols[ageIdx]) || null : null;

      parsedRows.push({ rawName, posRaw, position, parsed, name, nflTeam, rawRank, adpRank, dynRank, posRank, posRankFromCol, impliedPts, byeWeek, tier, upside, bust, sos, age });
    }

    // ── DETECT CSV SHAPE: mixed (overall) vs positional ──
    // If >75% of rows share a single position, treat RANK column as positional, not overall
    const posCounts: Record<string, number> = {};
    for (const r of parsedRows) {
      posCounts[r.position] = (posCounts[r.position] ?? 0) + 1;
    }
    const maxPosCount = Math.max(...Object.values(posCounts), 0);
    const isPositionalCsv = parsedRows.length > 0 && (maxPosCount / parsedRows.length) > 0.75;
    const hasAdpColumn = adpIdx >= 0 || rtIdx >= 0;

    // If CSV has an ADP/AVG column, the rank column is the overall consensus order.
    // If CSV has NO ADP column AND it's positional, the rank column is positional rank.
    // If CSV has NO ADP column AND it's mixed, the rank column is draft_rank.
    const rankIsOverall = hasAdpColumn || !isPositionalCsv;

    if (isPositionalCsv && rankIdx >= 0 && !hasAdpColumn) {
      const dominantPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
      warnings.push(`CSV appears to be a ${dominantPos}-only ranking (${maxPosCount}/${parsedRows.length} rows). Rank column treated as positional rank, NOT overall draft rank.`);
    }

    // ── DUPLICATE DETECTION within CSV ──
    const nameKeys = new Map<string, number>();
    for (const r of parsedRows) {
      const key = `${r.name.toLowerCase()}|${r.position}`;
      nameKeys.set(key, (nameKeys.get(key) ?? 0) + 1);
    }
    const dupsInCsv = [...nameKeys.entries()].filter(([_, cnt]) => cnt > 1);
    if (dupsInCsv.length > 0) {
      const dupNames = dupsInCsv.map(([k, cnt]) => `${k.split("|")[0]} (${cnt}x)`).slice(0, 10);
      warnings.push(`Duplicate names in CSV: ${dupNames.join(", ")}`);
    }

    // ── BUILD BATCH with correct draft_rank logic ──
    for (const r of parsedRows) {
      let draftRank: number | null = null;
      let posRank = r.posRank;

      if (rankIsOverall) {
        // Rank column = overall consensus order → write as draft_rank
        draftRank = r.rawRank;
      } else {
        // Rank column = positional rank → write as positional_rank, NOT draft_rank
        if (r.rawRank != null && posRank == null) {
          posRank = r.rawRank;
        }
      }

      batch.push({
        name: r.name, position: r.position, nflTeam: r.nflTeam,
        adpRank: r.adpRank, dynRank: r.dynRank, posRank,
        impliedPts: r.impliedPts, byeWeek: r.byeWeek, draftRank,
        tier: r.tier, upside: r.upside, bust: r.bust,
        sos: r.sos, age: r.age,
      });
    }

    // Diagnostic: column detection results
    const colInfo = `cols: name=${nameIdx} pos=${posIdx} rank=${rankIdx} adp=${adpIdx} team=${teamIdx} bye=${byeIdx} rt=${rtIdx} | lines=${lines.length} batch=${batch.length} | rankIsOverall=${rankIsOverall}`;

    if (batch.length === 0) {
      const sampleCols = lines.length > 1 ? parseCsvLine(lines[1]) : [];
      const samplePosRaw = posIdx >= 0 ? sampleCols[posIdx] : "N/A";
      const sampleNameRaw = nameIdx >= 0 ? sampleCols[nameIdx] : "N/A";
      return {
        imported: 0,
        updated: 0,
        message: `No players parsed from CSV. ${colInfo} | sample name="${sampleNameRaw}" pos="${samplePosRaw}" | headers: ${header.join(", ")}`,
        warnings,
      };
    }

    // ── NAME-MATCH VALIDATION: check how many names match existing players ──
    const existingPlayers = await ctx.integrations.apps_db.query(
      `SELECT LOWER(REPLACE(REPLACE(name, '.', ''), ' ', '')) AS norm_name, position FROM ffwr_players`,
      z.object({ norm_name: z.string(), position: z.string() }),
      undefined,
      { label: "Load existing player names for match validation" }
    );
    const existingSet = new Set(existingPlayers.map(p => `${p.norm_name}|${p.position}`));

    let matched = 0;
    let newPlayers = 0;
    const unmatchedNames: string[] = [];
    for (const r of batch) {
      const normKey = `${r.name.toLowerCase().replace(/[. ]/g, "")}|${r.position}`;
      if (existingSet.has(normKey)) {
        matched++;
      } else {
        newPlayers++;
        if (unmatchedNames.length < 15) {
          unmatchedNames.push(`${r.name} (${r.position})`);
        }
      }
    }
    if (newPlayers > 0) {
      warnings.push(`${newPlayers} new player(s) not in DB will be inserted: ${unmatchedNames.join(", ")}${newPlayers > 15 ? ` ...and ${newPlayers - 15} more` : ""}`);
    }

    // Batch upsert in chunks of 25 (14 params per row × 25 = 350 params)
    const CHUNK_SIZE = 25;
    for (let c = 0; c < batch.length; c += CHUNK_SIZE) {
      const chunk = batch.slice(c, c + CHUNK_SIZE);
      const values: string[] = [];
      const params: (string | number | null)[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const o = j * 14; // 14 params per row
        values.push(`($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7}, $${o+8}, $${o+9}, $${o+10}, $${o+11}, $${o+12}, $${o+13}, $${o+14})`);
        params.push(row.name, row.position, row.nflTeam, row.adpRank, row.dynRank,
          row.posRank, row.impliedPts, row.byeWeek, row.draftRank, row.tier,
          row.upside, row.bust, row.sos, row.age);
      }
      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_players (name, position, nfl_team, adp_rank, dynasty_rank, positional_rank, implied_team_points, bye_week, draft_rank, draft_tier, upside, bust, sos, age)
         VALUES ${values.join(", ")}
         ON CONFLICT (name, position) DO UPDATE SET
           nfl_team = COALESCE(EXCLUDED.nfl_team, ffwr_players.nfl_team),
           adp_rank = COALESCE(EXCLUDED.adp_rank, ffwr_players.adp_rank),
           dynasty_rank = COALESCE(EXCLUDED.dynasty_rank, ffwr_players.dynasty_rank),
           positional_rank = COALESCE(EXCLUDED.positional_rank, ffwr_players.positional_rank),
           implied_team_points = COALESCE(EXCLUDED.implied_team_points, ffwr_players.implied_team_points),
           bye_week = COALESCE(EXCLUDED.bye_week, ffwr_players.bye_week),
           draft_rank = COALESCE(EXCLUDED.draft_rank, ffwr_players.draft_rank),
           draft_tier = COALESCE(EXCLUDED.draft_tier, ffwr_players.draft_tier),
           upside = COALESCE(EXCLUDED.upside, ffwr_players.upside),
           bust = COALESCE(EXCLUDED.bust, ffwr_players.bust),
           sos = COALESCE(EXCLUDED.sos, ffwr_players.sos),
           age = COALESCE(EXCLUDED.age, ffwr_players.age)`,
        params,
        { label: `Batch upsert players ${c + 1}-${c + chunk.length}` }
      );
      imported += chunk.length;
    }

    return {
      imported,
      updated: matched,
      message: `Processed ${imported} players (${matched} matched existing, ${newPlayers} new). ${colInfo}`,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
});
