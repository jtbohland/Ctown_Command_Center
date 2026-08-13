import { api, z, postgres, readableFileSchema } from "@superblocksteam/sdk-api";

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

      let updated = 0;
      for (let i = 1; i < lines.length; i++) {
        const cols: string[] = parseCsvLine(lines[i]);
        const rawName = cols[dnNameIdx] || "";
        const posRaw = cols[dnPosIdx] || "";
        if (!rawName || !posRaw) continue;

        const position = posRaw.replace(/[0-9]/g, "").trim();
        if (!["QB", "RB", "WR", "TE"].includes(position)) continue;

        const name = normalizeName(rawName);
        if (!name) continue;

        const dynastyRank = rkIdx >= 0 ? parseFloat(cols[rkIdx]) || null : null;
        const dynastyTier = tierColIdx >= 0 ? parseInt(cols[tierColIdx]) || null : null;
        const age = dnAgeIdx >= 0 ? parseInt(cols[dnAgeIdx]) || null : null;
        const nflTeam = dnTeamIdx >= 0 ? (cols[dnTeamIdx] || "").trim() : "";

        // Extract positional rank from POS column (e.g., "WR1" → 1)
        const posRankFromCol = parseInt(posRaw.replace(/[^0-9]/g, "")) || null;

        await ctx.integrations.apps_db.execute(
          `UPDATE ffwr_players SET
             dynasty_rank = COALESCE($3, dynasty_rank),
             dynasty_tier = COALESCE($4, dynasty_tier),
             age = COALESCE($5, age),
             nfl_team = CASE WHEN $6::text <> '' THEN $6 ELSE nfl_team END,
             positional_rank = COALESCE($7, positional_rank)
           WHERE LOWER(REPLACE(REPLACE(name, '.', ''), ' ', '')) = LOWER(REPLACE(REPLACE($1::text, '.', ''), ' ', ''))
             AND position = $2`,
          [name, position, dynastyRank, dynastyTier, age, nflTeam, posRankFromCol],
          { label: `Dynasty update: ${name} (${position})` }
        );
        updated++;
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

        rows.push({ year, pick, name: rawName.replace(/\./g, "").replace(/\s+/g, " ").trim(), pos: position, age });
      }

      if (rows.length === 0) {
        return { imported: 0, updated: 0, message: "No rookie players parsed from CSV." };
      }

      // Batch upsert in chunks of 50
      const CHUNK = 50;
      for (let c = 0; c < rows.length; c += CHUNK) {
        const chunk = rows.slice(c, c + CHUNK);
        const values: string[] = [];
        const params: (string | number | null)[] = [];
        for (let j = 0; j < chunk.length; j++) {
          const r = chunk[j];
          const offset = j * 5;
          values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`);
          params.push(r.year, r.pick, r.name, r.pos, r.age);
        }
        await ctx.integrations.apps_db.execute(
          `INSERT INTO ffwr_rookie_classes (nfl_draft_year, overall_pick, player_name, position, age_on_draft_day)
           VALUES ${values.join(", ")}
           ON CONFLICT (nfl_draft_year, overall_pick) DO UPDATE SET
             player_name = EXCLUDED.player_name,
             position = EXCLUDED.position,
             age_on_draft_day = COALESCE(EXCLUDED.age_on_draft_day, ffwr_rookie_classes.age_on_draft_day)`,
          params,
          { label: `Batch upsert rookies ${c + 1}-${c + chunk.length}` }
        );
      }

      return { imported: rows.length, updated: 0, message: `Imported ${rows.length} rookies for ${rows[0].year} draft class.` };
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

    // Normalize player name: strip periods, trailing "Jr"/"Sr"/"III" dots, collapse spaces
    function normalizeName(raw: string): string {
      return raw
        .replace(/\./g, "")       // "A.J. Brown" → "AJ Brown", "Jr." → "Jr"
        .replace(/\s+/g, " ")     // collapse multiple spaces
        .trim();
    }

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

    for (let i = 1; i < lines.length; i++) {
      const cols: string[] = parseCsvLine(lines[i]);
      const rawName = cols[nameIdx] || "";
      const posRaw = cols[posIdx] || "";
      if (!rawName || !posRaw) continue;

      // Extract base position (e.g., "WR1" → "WR", "RB2" → "RB")
      const position = posRaw.replace(/[0-9]/g, "").trim();
      // Skip K and DST — league doesn't use them
      if (!["QB", "RB", "WR", "TE"].includes(position)) continue;

      // Extract positional rank from POS column (e.g., "RB1" → 1, "WR23" → 23)
      const posRankFromCol = parseInt(posRaw.replace(/[^0-9]/g, "")) || null;

      // Parse the player field for name, team, bye — then normalize (strip periods, collapse spaces)
      const parsed = parsePlayerField(rawName);
      const name = normalizeName(parsed.name);
      if (!name) continue;

      // NFL team: prefer parsed from player field, then standalone team column
      const nflTeam = parsed.team !== "FA" ? parsed.team : (teamIdx >= 0 ? (cols[teamIdx] || "FA") : "FA");

      // draft_rank = Rank column (overall consensus order)
      const draftRank = rankIdx >= 0 ? parseFloat(cols[rankIdx]) || null : null;

      // adp_rank = AVG column (consensus ADP across platforms)
      const adpRank = adpIdx >= 0 ? parseFloat(cols[adpIdx]) || null
        : (rtIdx >= 0 ? parseFloat(cols[rtIdx]) || null : null);

      const dynRank = dynIdx >= 0 ? parseFloat(cols[dynIdx]) || null : null;

      // Positional rank: prefer explicit pos_rank column, else extract from POS column
      const posRank = prIdx >= 0 ? (parseFloat(cols[prIdx]) || null) : posRankFromCol;

      const impliedPts = ptsIdx >= 0 ? parseFloat(cols[ptsIdx]) || null : null;

      // Bye week: prefer explicit bye column, else parsed from player field
      const byeWeek = byeIdx >= 0 ? (parseInt(cols[byeIdx]) || null) : parsed.bye;

      const tier = tierIdx >= 0 ? parseInt(cols[tierIdx]) || null : null;
      const upside = upsideIdx >= 0 ? (cols[upsideIdx] || null) : null;
      const bust = bustIdx >= 0 ? (cols[bustIdx] || null) : null;
      const sos = sosIdx >= 0 ? (cols[sosIdx] || null) : null;
      const age = ageIdx >= 0 ? parseInt(cols[ageIdx]) || null : null;

      batch.push({ name, position, nflTeam, adpRank, dynRank, posRank, impliedPts, byeWeek, draftRank, tier, upside, bust, sos, age });
    }

    // Diagnostic: column detection results
    const colInfo = `cols: name=${nameIdx} pos=${posIdx} rank=${rankIdx} adp=${adpIdx} team=${teamIdx} bye=${byeIdx} rt=${rtIdx} | lines=${lines.length} batch=${batch.length}`;

    if (batch.length === 0) {
      // Debug: show first data row to help diagnose
      const sampleCols = lines.length > 1 ? parseCsvLine(lines[1]) : [];
      const samplePosRaw = posIdx >= 0 ? sampleCols[posIdx] : "N/A";
      const sampleNameRaw = nameIdx >= 0 ? sampleCols[nameIdx] : "N/A";
      return {
        imported: 0,
        updated: 0,
        message: `No players parsed from CSV. ${colInfo} | sample name="${sampleNameRaw}" pos="${samplePosRaw}" | headers: ${header.join(", ")}`,
      };
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
      updated: 0,
      message: `Processed ${imported} players. ${colInfo}`,
    };
  },
});
