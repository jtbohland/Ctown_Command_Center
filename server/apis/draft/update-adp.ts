import { api, z, postgres } from "@superblocksteam/sdk-api";
import { normalizePlayerName } from "../../lib/normalize-player-name.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "UpdateAdpFromCsv",
  description: "Upserts daily ADP rankings into ffwr_players with canonical name normalization.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    csvText: z.string(),
  }),

  output: z.object({
    processed: z.number(),
    skipped: z.number(),
    message: z.string(),
  }),

  async run(ctx, { csvText }) {
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new Error("CSV must have header + data rows");

    const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
    const rankIdx = header.indexOf("rank");
    const nameIdx = header.findIndex((h) => h.startsWith("player"));
    const posIdx = header.findIndex((h) => h === "pos");
    const avgIdx = header.findIndex((h) => h === "avg");

    if (nameIdx === -1 || posIdx === -1) throw new Error("Missing player/pos columns");

    // Parse "PlayerName   TEAM (bye)" → { name, team, bye }
    function parsePlayerField(raw: string): { name: string; team: string; bye: number | null } {
      const byeMatch = raw.match(/\((\d+)\)\s*$/);
      const bye = byeMatch ? parseInt(byeMatch[1]) : null;
      let cleaned = raw.replace(/\(\d+\)\s*$/, "").trim();
      const teamMatch = cleaned.match(/\s{2,}([A-Z]{2,4})\s*$/) || cleaned.match(/\s([A-Z]{2,4})\s*$/);
      const team = teamMatch ? teamMatch[1] : "";
      if (team) cleaned = cleaned.replace(new RegExp(`\\s+${team}\\s*$`), "").trim();
      // Normalize name through canonical normalizer
      return { name: normalizePlayerName(cleaned), team: team || "FA", bye };
    }

    // Batch upserts for performance
    type Row = {
      name: string; position: string; nflTeam: string;
      adpRank: number | null; posRank: number | null;
      byeWeek: number | null; draftRank: number | null;
    };
    const batch: Row[] = [];
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      const rawName = cols[nameIdx] || "";
      const posRaw = cols[posIdx] || "";
      if (!rawName || !posRaw) continue;

      const position = posRaw.replace(/[0-9]/g, "").trim();
      if (!["QB", "RB", "WR", "TE"].includes(position)) { skipped++; continue; }

      const posRank = parseInt(posRaw.replace(/[^0-9]/g, "")) || null;
      const parsed = parsePlayerField(rawName);
      if (!parsed.name) continue;

      const draftRank = rankIdx >= 0 ? parseFloat(cols[rankIdx]) || null : null;
      const adpRank = avgIdx >= 0 ? parseFloat(cols[avgIdx]) || null : null;

      batch.push({ name: parsed.name, position, nflTeam: parsed.team, adpRank, posRank, byeWeek: parsed.bye, draftRank });
    }

    // Batch upsert in chunks of 50 (7 params per row)
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
           adp_rank = EXCLUDED.adp_rank,
           positional_rank = EXCLUDED.positional_rank,
           bye_week = COALESCE(EXCLUDED.bye_week, ffwr_players.bye_week),
           draft_rank = EXCLUDED.draft_rank`,
        params,
        { label: `ADP batch ${Math.floor(c / CHUNK) + 1}` }
      );
    }

    return { processed: batch.length, skipped, message: `Updated ${batch.length} players, skipped ${skipped} K/DST.` };
  },
});
