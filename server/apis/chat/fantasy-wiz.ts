import { api, z, anthropic, postgres } from "@superblocksteam/sdk-api";

const ANTHROPIC = "c7c693c4-0472-4c6b-952c-122c8d884281";
const DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string() }),
]);

const MessageResponseSchema = z.object({
  id: z.string(),
  type: z.literal("message"),
  role: z.literal("assistant"),
  content: z.array(ContentBlockSchema),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

export default api({
  name: "FantasyWiz",
  description: "AI-powered fantasy football analyst using league data + Anthropic Claude",

  integrations: {
    ai: anthropic(ANTHROPIC),
    db: postgres(DB),
  },

  input: z.object({
    prompt: z.string(),
    conversationHistory: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string(),
    })).default([]),
  }),

  output: z.object({
    answer: z.string(),
    tokensUsed: z.number(),
  }),

  async run(ctx, { prompt, conversationHistory }) {
    // ── Gather league context in parallel ──
    const TradeRow = z.object({ id: z.number(), season: z.string(), trade_date: z.string().nullable(), team_a_name: z.string().nullable(), team_b_name: z.string().nullable(), team_c_name: z.string().nullable(), verdict: z.string().nullable(), pct_difference: z.coerce.number().nullable(), confidence: z.string().nullable() });
    const AssetRow = z.object({ trade_id: z.number(), asset_type: z.string(), player_name: z.string().nullable(), player_position: z.string().nullable(), from_team_id: z.number(), pick_year: z.number().nullable(), pick_round: z.number().nullable() });
    const TeamRow = z.object({ id: z.number(), team_name: z.string(), manager_name: z.string() });
    const PlayerRow = z.object({ name: z.string(), position: z.string(), adp_rank: z.coerce.number().nullable(), nfl_team: z.string().nullable() });
    const ScoreRow = z.object({ player_name: z.string().nullable(), season: z.string(), position: z.string(), total_points: z.coerce.number().nullable(), avg_points: z.coerce.number().nullable(), games_played: z.coerce.number().nullable(), ppg_percentile: z.coerce.number().nullable() });
    const AdpRow = z.object({ player_name: z.string(), season: z.string(), adp_rank: z.coerce.number().nullable(), position: z.string().nullable() });

    const [trades, tradeAssets, teams, players, scores, adp] = await Promise.all([
      ctx.integrations.db.query(
        `SELECT t.id, t.season, t.trade_date,
                ta.team_name AS team_a_name, tb.team_name AS team_b_name, tc.team_name AS team_c_name,
                COALESCE(t.verdict_label, t.verdict_severity) AS verdict,
                t.pct_difference, t.confidence
         FROM ffwr_trades t
         LEFT JOIN ffwr_teams ta ON ta.id = t.team_a_id
         LEFT JOIN ffwr_teams tb ON tb.id = t.team_b_id
         LEFT JOIN ffwr_teams tc ON tc.id = t.team_c_id
         ORDER BY t.trade_date DESC NULLS LAST LIMIT 200`,
        TradeRow, [], { label: "All trades" }
      ),
      ctx.integrations.db.query(
        `SELECT trade_id, asset_type, player_name, player_position, from_team_id, pick_year, pick_round
         FROM ffwr_trade_assets LIMIT 1000`,
        AssetRow, [], { label: "Trade assets" }
      ),
      ctx.integrations.db.query("SELECT id, team_name, manager_name FROM ffwr_teams", TeamRow, [], { label: "Teams" }),
      ctx.integrations.db.query(
        `SELECT name, position, adp_rank, nfl_team FROM ffwr_players
         WHERE adp_rank IS NOT NULL ORDER BY adp_rank LIMIT 300`,
        PlayerRow, [], { label: "Top 300 players" }
      ),
      ctx.integrations.db.query(
        `SELECT cp.canonical_name AS player_name, ps.season, ps.position, ps.total_points, ps.avg_points, ps.games_played, ps.ppg_percentile
         FROM ffwr_player_scores ps
         LEFT JOIN ffwr_canonical_players cp ON cp.id = ps.canonical_player_id
         ORDER BY ps.season DESC, ps.total_points DESC NULLS LAST LIMIT 500`,
        ScoreRow, [], { label: "Player scores" }
      ),
      ctx.integrations.db.query(
        `SELECT player_name, season, adp_rank, position
         FROM ffwr_historical_adp ORDER BY season DESC, adp_rank LIMIT 500`,
        AdpRow, [], { label: "Historical ADP" }
      ),
    ]);

    // ── Build system prompt with all context ──
    const teamList = teams.map((t) => `  ${t.team_name} (Manager: ${t.manager_name}, ID: ${t.id})`).join("\n");

    const tradesSummary = trades.slice(0, 100).map((t) => {
      const tAssets = tradeAssets.filter((a) => a.trade_id === t.id);
      const aSends = tAssets.filter((a) => a.from_team_id === teams.find((tm) => tm.team_name === t.team_a_name)?.id);
      const bSends = tAssets.filter((a) => a.from_team_id === teams.find((tm) => tm.team_name === t.team_b_name)?.id);
      const fmtAsset = (a: typeof tAssets[0]) => a.asset_type === "player" ? `${a.player_name} (${a.player_position})` : `${a.pick_year} Rd ${a.pick_round}`;
      return `  #${t.id} [${t.season}${t.trade_date ? ` ${t.trade_date}` : ""}] ${t.team_a_name} sends [${aSends.map(fmtAsset).join(", ")}] ↔ ${t.team_b_name} sends [${bSends.map(fmtAsset).join(", ")}]${t.team_c_name ? ` (3-way with ${t.team_c_name})` : ""} → Verdict: ${t.verdict ?? "N/A"}, Gap: ${t.pct_difference ?? "N/A"}%, Confidence: ${t.confidence ?? "N/A"}`;
    }).join("\n");

    const topPlayers = players.slice(0, 60).map((p) => `  ${p.name} (${p.position}, ${p.nfl_team}) ADP: ${p.adp_rank}`).join("\n");

    const scoreSummary = scores.slice(0, 200).map((s) => `  ${s.player_name} [${s.season}] ${s.position} GP:${s.games_played} PPG:${s.avg_points?.toFixed(1)} Total:${s.total_points?.toFixed(0)} Pctile:${s.ppg_percentile?.toFixed(0)}%`).join("\n");

    const adpSummary = adp.slice(0, 200).map((a) => `  ${a.player_name} [${a.season}] ${a.position} ADP:${a.adp_rank}`).join("\n");

    const systemPrompt = `You are the Fantasy Wiz 🧙🏻‍♂️ — the smartest fantasy football analyst in the C-Town WarRoom.
You are an expert on THIS specific 12-team dynasty keeper league (4 keepers per team, PPR scoring).

You have access to the complete league database. Here is your context:

## League Teams
${teamList}

## Current Top Players (2026 ADP)
${topPlayers}

## Trade History (most recent 100 of ${trades.length} total)
${tradesSummary}

## Player Performance History (top scorers by season)
${scoreSummary}

## Historical ADP Data
${adpSummary}

## League Rules
- 12 teams, 4 keepers per year
- PPR scoring (1 point per reception)
- Positions: QB, RB, WR, TE
- Trade verdicts use ADP power-law formula: 10,000 × (1/adpRank)^0.6
- In-season actuals blend into valuations
- Future picks are discounted by year + round

## Your Personality
- You're witty, opinionated, and love hot takes
- Give direct answers — don't hedge everything
- When asked about a manager's track record, be brutally honest
- Reference specific trades, numbers, and seasons to back up your takes
- If asked a prediction, commit to one — don't give "it depends" answers
- Use fantasy football terminology naturally
- Keep answers concise but thorough — aim for 2-4 paragraphs max unless more detail is requested
- End with a clear takeaway or recommendation when relevant`;

    // Build message history
    const messages = [
      ...conversationHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user" as const, content: prompt },
    ];

    const result = await ctx.integrations.ai.apiRequest(
      {
        method: "POST",
        path: "/v1/messages",
        body: {
          model: "claude-sonnet-5",
          max_tokens: 2048,
          system: systemPrompt,
          messages,
        },
      },
      { response: MessageResponseSchema },
      { label: "Fantasy Wiz chat" },
    );

    const textContent = result.content.find((c) => c.type === "text");
    return {
      answer: textContent?.text ?? "",
      tokensUsed: result.usage.input_tokens + result.usage.output_tokens,
    };
  },
});
