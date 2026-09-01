import { api, z, gemini, postgres, readableFileSchema } from "@superblocksteam/sdk-api";
import { normalizeName } from "../../lib/normalize-trade-name.js";

const GEMINI_ID = "9284363a-0a4f-4167-b9fb-8d8e83c589ed";
const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// ─── Schemas ─────────────────────────────────────────────────

const ParsedTransactionSchema = z.object({
  added_player_name: z.string().nullable(),
  added_player_position: z.string().nullable(),
  added_player_nfl_team: z.string().nullable(),
  dropped_player_name: z.string().nullable(),
  dropped_player_position: z.string().nullable(),
  dropped_player_nfl_team: z.string().nullable(),
  manager_name: z.string(),
  transaction_date: z.string(),
  transaction_time: z.string().nullable(),
});

const GeminiResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(z.object({ text: z.string() })),
        role: z.string(),
      }),
    })
  ),
});

const DbPlayerSchema = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  nfl_team: z.string(),
});

const TeamSchema = z.object({
  id: z.coerce.number(),
  team_name: z.string(),
  manager_name: z.string(),
});

// Output enriched transaction with matching info
const EnrichedTransactionSchema = z.object({
  added_player_name: z.string().nullable(),
  added_player_position: z.string().nullable(),
  added_player_nfl_team: z.string().nullable(),
  added_player_id: z.number().nullable(),
  added_player_matched: z.boolean(),
  dropped_player_name: z.string().nullable(),
  dropped_player_position: z.string().nullable(),
  dropped_player_nfl_team: z.string().nullable(),
  dropped_player_id: z.number().nullable(),
  dropped_player_matched: z.boolean(),
  manager_name: z.string(),
  team_id: z.number().nullable(),
  team_matched: z.boolean(),
  transaction_date: z.string(),
  transaction_time: z.string().nullable(),
  is_duplicate: z.boolean(),
});

export default api({
  name: "ParseWaiverScreenshot",
  description: "Uses Gemini vision to extract waiver transactions from Sleeper screenshots.",

  integrations: {
    gemini: gemini(GEMINI_ID),
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    screenshot: z.object({
      files: z.array(readableFileSchema).min(1),
    }),
    season: z.string(),
  }),

  output: z.object({
    transactions: z.array(EnrichedTransactionSchema),
    parseWarnings: z.array(z.string()),
  }),

  async run(ctx, { screenshot, season }) {
    const warnings: string[] = [];

    // ── 1. Read screenshot as base64 ──
    const file = screenshot.files[0];
    const base64Data = await file.readContentsAsync();
    const mimeType = file.type ?? "image/png";

    ctx.log.info("Parsing waiver screenshot", { fileName: file.name, season });

    // ── 2. Call Gemini vision ──
    const systemPrompt = `You are a fantasy football transaction parser. You are analyzing a screenshot from the Sleeper fantasy football app showing waiver wire / free agent transactions.

Extract EVERY transaction visible in the screenshot. Each transaction typically shows:
- A manager/team name (the person making the move)  
- An added player (green "+" or "Added" indicator) with their NFL team abbreviation and position
- A dropped player (red "-" or "Dropped" indicator) with their NFL team abbreviation and position
- A date and optionally a time

IMPORTANT name mappings for this league's managers:
- "Bohland" or "JT" = "JT"
- "Tyler" or "Ty" = "Tyler"
- "Brooke" = "Brooke"  
- "Carson" = "Carson"
- "AJ" = "AJ"
- "Adam" = "Adam"
- "Drew" = "Drew"
- "Erik" = "Erik"
- "Jimmy" = "Jimmy"
- "Chuck" = "Chuck"
- "Jordan" = "Jordan"

Return ONLY a valid JSON array. Each element must have:
{
  "added_player_name": "Full Name" or null,
  "added_player_position": "QB"|"RB"|"WR"|"TE"|"K"|"DEF" or null,
  "added_player_nfl_team": "NFL Team Abbreviation" or null,
  "dropped_player_name": "Full Name" or null,
  "dropped_player_position": "QB"|"RB"|"WR"|"TE"|"K"|"DEF" or null,
  "dropped_player_nfl_team": "NFL Team Abbreviation" or null,
  "manager_name": "Manager first name from list above",
  "transaction_date": "YYYY-MM-DD",
  "transaction_time": "HH:MM AM/PM" or null
}

If a transaction is add-only (no drop), set dropped fields to null.
If a transaction is drop-only (no add), set added fields to null.
Return ONLY the JSON array — no markdown, no explanation.`;

    const result = await ctx.integrations.gemini.apiRequest(
      {
        method: "POST",
        path: "/v1beta/models/gemini-3.6-flash:generateContent",
        body: {
          contents: [
            {
              parts: [
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Data,
                  },
                },
                { text: systemPrompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384,
          },
        },
      },
      { response: GeminiResponseSchema },
      { label: "Parse waiver screenshot via Gemini vision" },
    );

    const rawText = result.candidates[0]?.content.parts[0]?.text ?? "[]";
    // Strip markdown code fences if present
    let jsonText = rawText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

    let parsed: z.infer<typeof ParsedTransactionSchema>[];
    try {
      const rawParsed = JSON.parse(jsonText);
      parsed = z.array(ParsedTransactionSchema).parse(rawParsed);
    } catch (firstErr) {
      // Gemini may truncate mid-JSON — try to salvage by closing the array
      ctx.log.warn("Initial JSON parse failed, attempting truncation recovery", { rawText: rawText.slice(0, 500) });
      try {
        // Find the last complete object (ends with })
        const lastBrace = jsonText.lastIndexOf("}");
        if (lastBrace > 0) {
          const trimmed = jsonText.slice(0, lastBrace + 1) + "]";
          const rawParsed = JSON.parse(trimmed);
          parsed = z.array(ParsedTransactionSchema).parse(rawParsed);
          warnings.push(`Gemini response was truncated — recovered ${parsed.length} transaction(s). Try uploading fewer screenshots at once.`);
        } else {
          throw firstErr;
        }
      } catch (recoveryErr) {
        ctx.log.error("Failed to parse Gemini response even after recovery", { rawText });
        throw new Error(`Failed to parse Gemini response: ${String(firstErr)}`);
      }
    }

    ctx.log.info(`Gemini extracted ${parsed.length} transactions`);

    // ── 3. Load player pool + teams for matching ──
    const [allPlayers, allTeams] = await Promise.all([
      ctx.integrations.apps_db.query(
        "SELECT id, name, position, nfl_team FROM ffwr_players LIMIT 2000",
        DbPlayerSchema,
        undefined,
        { label: "Load player pool for matching" },
      ),
      ctx.integrations.apps_db.query(
        "SELECT id, team_name, manager_name FROM ffwr_teams LIMIT 20",
        TeamSchema,
        undefined,
        { label: "Load teams for matching" },
      ),
    ]);

    // Build lookup maps
    const playerByNorm = new Map<string, z.infer<typeof DbPlayerSchema>>();
    for (const p of allPlayers) {
      playerByNorm.set(normalizeName(p.name), p);
    }

    const teamByManager = new Map<string, z.infer<typeof TeamSchema>>();
    for (const t of allTeams) {
      teamByManager.set(t.manager_name.toLowerCase(), t);
    }

    // ── 4. Check existing hashes for dedup ──
    const ExistingHashSchema = z.object({ dedup_hash: z.string() });
    const existingRows = await ctx.integrations.apps_db.query(
      "SELECT dedup_hash FROM ffwr_waiver_transactions WHERE season = $1 LIMIT 10000",
      ExistingHashSchema,
      [season],
      { label: "Load existing hashes for dedup" },
    );
    const existingHashes = new Set(existingRows.map((r) => r.dedup_hash));

    // ── 5. Enrich each transaction ──
    const enriched: z.infer<typeof EnrichedTransactionSchema>[] = [];

    for (const txn of parsed) {
      // Match added player
      let addedId: number | null = null;
      let addedMatched = false;
      if (txn.added_player_name) {
        const norm = normalizeName(txn.added_player_name);
        const match = playerByNorm.get(norm);
        if (match) {
          addedId = match.id;
          addedMatched = true;
        } else {
          warnings.push(`Added player "${txn.added_player_name}" not found in player pool`);
        }
      }

      // Match dropped player
      let droppedId: number | null = null;
      let droppedMatched = false;
      if (txn.dropped_player_name) {
        const norm = normalizeName(txn.dropped_player_name);
        const match = playerByNorm.get(norm);
        if (match) {
          droppedId = match.id;
          droppedMatched = true;
        } else {
          warnings.push(`Dropped player "${txn.dropped_player_name}" not found in player pool`);
        }
      }

      // Match team
      let teamId: number | null = null;
      let teamMatched = false;
      const managerKey = txn.manager_name.toLowerCase();
      const teamMatch = teamByManager.get(managerKey);
      if (teamMatch) {
        teamId = teamMatch.id;
        teamMatched = true;
      } else {
        warnings.push(`Manager "${txn.manager_name}" not matched to a team`);
      }

      // Compute dedup hash
      const hashParts = [
        txn.transaction_date,
        txn.transaction_time ?? "",
        txn.manager_name.toLowerCase(),
        txn.added_player_name?.toLowerCase() ?? "",
        txn.dropped_player_name?.toLowerCase() ?? "",
      ];
      const dedup_hash = hashParts.join("|");
      const isDuplicate = existingHashes.has(dedup_hash);

      enriched.push({
        added_player_name: txn.added_player_name,
        added_player_position: txn.added_player_position,
        added_player_nfl_team: txn.added_player_nfl_team,
        added_player_id: addedId,
        added_player_matched: addedMatched,
        dropped_player_name: txn.dropped_player_name,
        dropped_player_position: txn.dropped_player_position,
        dropped_player_nfl_team: txn.dropped_player_nfl_team,
        dropped_player_id: droppedId,
        dropped_player_matched: droppedMatched,
        manager_name: txn.manager_name,
        team_id: teamId,
        team_matched: teamMatched,
        transaction_date: txn.transaction_date,
        transaction_time: txn.transaction_time,
        is_duplicate: isDuplicate,
      });
    }

    return { transactions: enriched, parseWarnings: warnings };
  },
});
