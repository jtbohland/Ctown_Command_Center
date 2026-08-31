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
  picks: z.array(
    z.object({
      playerName: z.string(),
      position: z.string(),
      round: z.number(),
      pickInRound: z.number(),
      overallPick: z.number(),
      adpRank: z.number().nullable(),
      value: z.number(),
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
  description: "Uses Gemini to generate opinionated AI draft summaries for each team.",

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
      .map(
        (t) =>
          `**${t.teamName}** (${t.managerName}) — Rank #${t.rank}, Grade: ${t.grade}\n` +
          `Total Value: ${t.totalValue > 0 ? "+" : ""}${t.totalValue}, Avg: ${t.avgValue > 0 ? "+" : ""}${t.avgValue.toFixed(1)}, ` +
          `Steals: ${t.stealCount}, Reaches: ${t.reachCount}\n` +
          `Picks:\n${t.picks.map((p) => `  ${p.round}.${String(p.pickInRound).padStart(2, "0")} (Overall #${p.overallPick}): ${p.playerName} (${p.position}) — ADP ${p.adpRank ?? "N/A"}, Value ${p.value > 0 ? "+" : ""}${p.value}`).join("\n")}`,
      )
      .join("\n\n");

    const prompt = `You are a fun, opinionated fantasy football analyst writing draft recaps for a dynasty league called "C-Town Redux."

League context: 11 teams, 15 rounds, PPR dynasty league. The league average pick value is ${leagueAvgValue > 0 ? "+" : ""}${leagueAvgValue.toFixed(1)}.

"Value" = ADP rank minus the overall pick number. Positive means the player was still available later than expected (steal). Negative means the team reached for someone earlier than their ADP (reach).

For EACH team below, write exactly 3-4 sentences of opinionated, fun analysis of their draft. Reference specific players and picks. Be honest — call out great steals and bad reaches. Use a snarky, entertaining tone like a fantasy football podcast host. End each team's summary with a forward-looking comment (e.g. "this roster could contend" or "this squad needs work").

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
    // Strip code fences if Gemini wraps in ```json ... ```
    const cleaned = rawText.replace(/```json\s*\n?/gi, "").replace(/```\s*$/g, "").trim();

    let summaries: { teamName: string; summary: string }[];
    try {
      summaries = JSON.parse(cleaned);
    } catch {
      ctx.log.warn("Failed to parse Gemini response, using fallback", { rawText: cleaned.slice(0, 500) });
      summaries = teams.map((t) => ({
        teamName: t.teamName,
        summary: `Draft grade: ${t.grade}. Total value of ${t.totalValue > 0 ? "+" : ""}${t.totalValue} across ${t.picks.length} picks.`,
      }));
    }

    return { summaries };
  },
});
