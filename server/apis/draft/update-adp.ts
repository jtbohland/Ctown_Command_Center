import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "UpdateAdpFromCsv",
  description: "Accepts raw CSV text and upserts ADP rankings into ffwr_players.",

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

    // Parse header
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
    const rankIdx = header.indexOf("rank");
    const nameIdx = header.findIndex((h) => h.startsWith("player"));
    const posIdx = header.findIndex((h) => h === "pos");
    const avgIdx = header.findIndex((h) => h === "avg");

    if (nameIdx === -1 || posIdx === -1) throw new Error("Missing player/pos columns");

    // Parse "PlayerName   TEAM (bye)" -> { name, team, bye }
    function parsePlayerField(raw: string): { name: string; team: string; bye: number | null } {
      const byeMatch = raw.match(/\((\d+)\)\s*$/);
      const bye = byeMatch ? parseInt(byeMatch[1]) : null;
      let cleaned = raw.replace(/\(\d+\)\s*$/, "").trim();
      const teamMatch = cleaned.match(/\s{2,}([A-Z]{2,4})\s*$/) || cleaned.match(/\s([A-Z]{2,4})\s*$/);
      const team = teamMatch ? teamMatch[1] : "";
      if (team) cleaned = cleaned.replace(new RegExp(`\\s+${team}\\s*$`), "").trim();
      return { name: cleaned.replace(/\./g, "").replace(/\s+/g, " ").trim(), team: team || "FA", bye };
    }

    let processed = 0;
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

      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_players (name, position, nfl_team, adp_rank, positional_rank, bye_week, draft_rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (name, position) DO UPDATE SET
           nfl_team = COALESCE(EXCLUDED.nfl_team, ffwr_players.nfl_team),
           adp_rank = COALESCE(EXCLUDED.adp_rank, ffwr_players.adp_rank),
           positional_rank = COALESCE(EXCLUDED.positional_rank, ffwr_players.positional_rank),
           bye_week = COALESCE(EXCLUDED.bye_week, ffwr_players.bye_week),
           draft_rank = COALESCE(EXCLUDED.draft_rank, ffwr_players.draft_rank)`,
        [parsed.name, position, parsed.team, adpRank, posRank, parsed.bye, draftRank],
        { label: `Upsert: ${parsed.name}` }
      );
      processed++;
    }

    return { processed, skipped, message: `Updated ${processed} players, skipped ${skipped} K/DST.` };
  },
});
