import { api, z, gemini } from "@superblocksteam/sdk-api";

const GEMINI = "9284363a-0a4f-4167-b9fb-8d8e83c589ed";

const TeamInputSchema = z.object({
  teamName: z.string(),
  managerName: z.string(),
  rank: z.number(),
  grade: z.string(),
  totalValue: z.number(),
  avgValue: z.number(),
  stealCount: z.number(),
  reachCount: z.number(),
  wasteCount: z.number(),
  picks: z.array(
    z.object({
      playerName: z.string(),
      position: z.string(),
      round: z.number(),
      pickInRound: z.number(),
      overallPick: z.number(),
      adpRank: z.number().nullable(),
      value: z.number(),
      classification: z.string(),
      bpaRank: z.number(),
      receipts: z.array(z.string()),
    }),
  ),
});

const GenerateContentResponseSchema = z.object({
  candidates: z.array(
    z.object({
      content: z.object({
        parts: z.array(z.object({ text: z.string() })),
        role: z.string(),
      }),
      finishReason: z.string(),
    }),
  ),
});

export default api({
  name: "GenerateDraftRecap",
  description: "Uses Gemini to generate opinionated AI draft summaries with board-aware grading data.",

  integrations: {
    gemini: gemini(GEMINI),
  },

  input: z.object({
    teams: z.array(TeamInputSchema),
    leagueAvgValue: z.number(),
  }),

  output: z.object({
    summaries: z.array(
      z.object({
        teamName: z.string(),
        summary: z.string(),
      }),
    ),
  }),

  async run(ctx, { teams, leagueAvgValue }) {
    const teamBlocks = teams
      .map((t) => {
        const steals = t.picks.filter((p) => p.classification === "steal");
        const reaches = t.picks.filter((p) => p.classification === "reach");
        const wastes = t.picks.filter((p) => p.classification === "positional_waste");

        let block =
          `**${t.teamName}** (${t.managerName}) — Rank #${t.rank}, Grade: ${t.grade}\n` +
          `Score: ${t.totalValue > 0 ? "+" : ""}${t.totalValue}, Avg: ${t.avgValue > 0 ? "+" : ""}${t.avgValue.toFixed(1)}, ` +
          `Steals: ${t.stealCount}, Reaches: ${t.reachCount}, Positional Wastes: ${t.wasteCount}\n`;

        block += `Picks:\n${t.picks
          .map(
            (p) =>
              `  ${p.round}.${String(p.pickInRound).padStart(2, "0")} (#${p.overallPick}): ${p.playerName} (${p.position}) — ` +
              `ADP ${p.adpRank ?? "N/A"}, BPA #${p.bpaRank}, [${p.classification.toUpperCase()}] Score ${p.value > 0 ? "+" : ""}${p.value}` +
              (p.receipts.length > 0 ? ` ← Passed on: ${p.receipts.join(", ")}` : ""),
          )
          .join("\n")}`;

        if (reaches.length > 0) {
          block += `\n  Worst reaches: ${reaches
            .sort((a, b) => a.value - b.value)
            .slice(0, 3)
            .map((p) => `${p.playerName} at ${p.round}.${String(p.pickInRound).padStart(2, "0")} (BPA #${p.bpaRank})`)
            .join("; ")}`;
        }
        if (wastes.length > 0) {
          block += `\n  Positional waste: ${wastes.map((p) => `${p.playerName} (${p.position})`).join(", ")}`;
        }

        return block;
      })
      .join("\n\n");

    const prompt = `You are a fun, opinionated fantasy football analyst writing draft recaps for a dynasty league called "C-Town Redux!"

League context: 11 teams, 15 rounds, PPR dynasty league. The league average pick score is ${leagueAvgValue > 0 ? "+" : ""}${leagueAvgValue.toFixed(1)}.

GRADING SYSTEM (Board-Aware BPA):
- For each pick, we simulated the available player pool at that moment (keepers excluded, previously drafted players removed)
- "BPA #N" means the player was the Nth-best available player by ADP when picked
- "STEAL" = top-3 available RB/WR at their position, or QB/TE that fell 40+ ADP spots
- "RIGHT" = solid pick from top-7 available RB/WR
- "REACH" = passed on clearly better RB/WR (the players they passed on are listed as receipts)
- "POSITIONAL_WASTE" = took a 2nd QB or TE when quality RB/WR was still on the board

For EACH team below, write exactly 3-4 sentences of opinionated, fun analysis. IMPORTANT RULES:
1. Reference SPECIFIC players and picks — name the steals, call out the reaches with who they passed on
2. Be honest and ruthless — if someone reached badly, say so (e.g. "took Watson at 1.05 over Jacobs, Irving, and Adams — bold or delusional?")
3. Use a snarky, entertaining tone like a fantasy football podcast host
4. End each summary with a forward-looking dynasty comment

Return ONLY a JSON array (no markdown, no code fence) with one object per team:
[{"teamName": "...", "summary": "..."}]

Here are the draft results:

${teamBlocks}`;

    const result = await ctx.integrations.gemini.apiRequest(
      {
        method: "POST",
        path: "/v1/models/gemini-3.6-flash:generateContent",
        body: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            maxOutputTokens: 4096,
          },
        },
      },
      { response: GenerateContentResponseSchema },
      { label: "Generate AI draft summaries" },
    );

    const rawText = result.candidates[0]?.content.parts[0]?.text ?? "[]";
    const cleaned = rawText.replace(/```json\s*\n?/gi, "").replace(/```\s*$/g, "").trim();

    let summaries: { teamName: string; summary: string }[];
    try {
      summaries = JSON.parse(cleaned);
    } catch {
      ctx.log.warn("Failed to parse Gemini response, using fallback", { rawText: cleaned.slice(0, 500) });
      summaries = teams.map((t) => ({
        teamName: t.teamName,
        summary: `Draft grade: ${t.grade}. Score of ${t.totalValue > 0 ? "+" : ""}${t.totalValue} across ${t.picks.length} picks.`,
      }));
    }

    return { summaries };
  },
});
