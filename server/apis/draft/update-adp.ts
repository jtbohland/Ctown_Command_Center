import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizePlayerName } from "../../lib/normalize-player-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "UpdateAdpFromCsv",
  description: "Upserts daily ADP rankings with positional-CSV detection and name-match validation.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvText: z.string(),
  }),

  output: z.object({
    processed: z.number(),
    skipped: z.number(),
    matched: z.number(),
    newPlayers: z.number(),
    message: z.string(),
    warnings: z.array(z.string()).optional(),
  }),

  async run(ctx, { csvText }) {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV must have header + data rows");

    const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
    const rankIdx = header.indexOf("rank");
    const nameIdx = header.findIndex((h) => h.startsWith("player"));
    const posIdx = header.findIndex((h) => h === "pos");
    const avgIdx = header.findIndex((h) => h === "avg" || h === "avg." || h.includes("adp"));
    // "real-time" column for real-time ADP (fallback for avgIdx)
    const rtIdx = header.findIndex((h) => h === "real-time" || h.includes("real"));

    if (nameIdx === -1 || posIdx === -1) throw new Error("Missing player/pos columns");

    const warnings: string[] = [];

    // Parse "PlayerName   TEAM (bye)" → { name, team, bye }
    function parsePlayerField(raw: string): { name: string; team: string; bye: number | null } {
      const byeMatch = raw.match(/\((\d+)\)\s*$/);
      const bye = byeMatch ? parseInt(byeMatch[1]) : null;
      let cleaned = raw.replace(/\(\d+\)\s*$/, "").trim();
      const teamMatch = cleaned.match(/\s{2,}([A-Z]{2,4})\s*$/) || cleaned.match(/\s([A-Z]{2,4})\s*$/);
      const team = teamMatch ? teamMatch[1] : "";
      if (team) cleaned = cleaned.replace(new RegExp(`\\s+${team}\\s*$`), "").trim();
      return { name: normalizePlayerName(cleaned), team: team || "FA", bye };
    }

    // ── FIRST PASS: parse all rows ──
    type ParsedRow = {
      name: string; position: string; nflTeam: string;
      rawRank: number | null; adpRank: number | null;
      posRankFromCol: number | null; byeWeek: number | null;
    };
    const parsedRows: ParsedRow[] = [];
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const rawName = cols[nameIdx] || "";
      const posRaw = cols[posIdx] || "";
      if (!rawName || !posRaw) continue;

      const position = posRaw.replace(/[0-9]/g, "").trim();
      if (!["QB", "RB", "WR", "TE"].includes(position)) { skipped++; continue; }

      const posRankFromCol = parseInt(posRaw.replace(/[^0-9]/g, "")) || null;
      const parsed = parsePlayerField(rawName);
      if (!parsed.name) continue;

      const rawRank = rankIdx >= 0 ? parseFloat(cols[rankIdx]) || null : null;
      const adpRank = avgIdx >= 0 ? parseFloat(cols[avgIdx]) || null
        : (rtIdx >= 0 ? parseFloat(cols[rtIdx]) || null : null);

      parsedRows.push({
        name: parsed.name, position, nflTeam: parsed.team,
        rawRank, adpRank, posRankFromCol, byeWeek: parsed.bye,
      });
    }

    // ── DETECT CSV SHAPE: mixed (overall) vs positional ──
    const posCounts: Record<string, number> = {};
    for (const r of parsedRows) {
      posCounts[r.position] = (posCounts[r.position] ?? 0) + 1;
    }
    const maxPosCount = Math.max(...Object.values(posCounts), 0);
    const isPositionalCsv = parsedRows.length > 0 && (maxPosCount / parsedRows.length) > 0.75;
    const hasAdpColumn = avgIdx >= 0 || rtIdx >= 0;

    // Rank column = overall draft_rank only when:
    // 1. CSV has an ADP/AVG column (rank is consensus order, ADP is average pick), OR
    // 2. CSV is mixed positions (not positional-only)
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
    type Row = {
      name: string; position: string; nflTeam: string;
      adpRank: number | null; posRank: number | null;
      byeWeek: number | null; draftRank: number | null;
    };
    const batch: Row[] = [];

    for (const r of parsedRows) {
      let draftRank: number | null = null;
      let posRank = r.posRankFromCol;

      if (rankIsOverall) {
        draftRank = r.rawRank;
      } else {
        // Positional CSV: rank column = positional rank, NOT draft_rank
        if (r.rawRank != null && posRank == null) {
          posRank = r.rawRank;
        }
      }

      batch.push({
        name: r.name, position: r.position, nflTeam: r.nflTeam,
        adpRank: r.adpRank, posRank, byeWeek: r.byeWeek, draftRank,
      });
    }

    // ── NAME-MATCH VALIDATION ──
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

    // ── BATCH UPSERT ──
    const CHUNK = 50;
    for (let c = 0; c < batch.length; c += CHUNK) {
      const chunk = batch.slice(c, c + CHUNK);
      const values: string[] = [];
      const params: (string | number | null)[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const row = chunk[j];
        const o = j * 7;
        values.push(`($${o+1}, $${o+2}, $${o+3}, $${o+4}, $${o+5}, $${o+6}, $${o+7})`);
        params.push(row.name, row.position, row.nflTeam, row.adpRank, row.posRank, row.byeWeek, row.draftRank);
      }
      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_players (name, position, nfl_team, adp_rank, positional_rank, bye_week, draft_rank)
         VALUES ${values.join(", ")}
         ON CONFLICT (name, position) DO UPDATE SET
           nfl_team = COALESCE(EXCLUDED.nfl_team, ffwr_players.nfl_team),
           adp_rank = COALESCE(EXCLUDED.adp_rank, ffwr_players.adp_rank),
           positional_rank = COALESCE(EXCLUDED.positional_rank, ffwr_players.positional_rank),
           bye_week = COALESCE(EXCLUDED.bye_week, ffwr_players.bye_week),
           draft_rank = COALESCE(EXCLUDED.draft_rank, ffwr_players.draft_rank)`,
        params,
        { label: `ADP batch ${Math.floor(c / CHUNK) + 1}` }
      );
    }

    return {
      processed: batch.length,
      skipped,
      matched,
      newPlayers,
      message: `Updated ${batch.length} players (${matched} matched, ${newPlayers} new), skipped ${skipped} K/DST. rankIsOverall=${rankIsOverall}`,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
});
