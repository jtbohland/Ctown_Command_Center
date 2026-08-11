import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

const numOrNull = z.union([z.null(), z.coerce.number()]);

const PlayerRow = z.object({
  id: z.coerce.number(),
  name: z.string(),
  position: z.string(),
  nfl_team: z.string(),
  adp_rank: numOrNull,
  dynasty_rank: numOrNull,
  positional_rank: numOrNull,
  bye_week: numOrNull,
  is_keeper: z.coerce.boolean(),
  keeper_team_id: numOrNull,
});

const DraftPickRow = z.object({
  id: z.coerce.number(),
  round: z.coerce.number(),
  pick_in_round: z.coerce.number(),
  overall_pick: z.coerce.number(),
  team_id: z.coerce.number(),
});

const TeamRow = z.object({
  id: z.coerce.number(),
  team_name: z.string(),
  draft_position: numOrNull,
});

// Starting lineup: 1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX (W/T), 1 FLEX (W/R) = 8 starters
// Bench: 3 slots + 1 IR = 4 bench spots  →  total roster = 12

function countPositions(positions: string[]) {
  let qb = 0, rb = 0, wr = 0, te = 0;
  for (const p of positions) {
    if (p === "QB") qb++;
    else if (p === "RB") rb++;
    else if (p === "WR") wr++;
    else if (p === "TE") te++;
  }
  return { qb, rb, wr, te };
}

/**
 * Roster-aware positional need scoring.
 * Returns a score (higher = team needs this position more) AND
 * a hard penalty for positions that should be avoided.
 *
 * Logic mirrors SmartSuggestions formula:
 * - Strong need for unfilled starter slots
 * - Moderate need for flex-eligible depth (WR/RB)
 * - Hard penalty for 2nd QB/TE (unless elite value)
 * - Tiny value for bench depth, zero for excess
 */
function positionalNeedScore(
  positions: string[],
  candidatePos: string,
  round: number,
  candidateAdpRank: number | null,
  overallPick: number,
): number {
  const { qb, rb, wr, te } = countPositions(positions);
  const totalRostered = positions.length;

  // === QB logic ===
  if (candidatePos === "QB") {
    if (qb === 0) return 30; // need a starter badly
    if (qb === 1) {
      // 2nd QB: only if late rounds AND great value
      if (round >= 8) return 5;
      // Otherwise, heavy penalty — don't double up on QB
      const adpGap = overallPick - (candidateAdpRank ?? overallPick);
      if (adpGap >= 20) return 3; // massive steal, small allowance
      return -40; // strong "don't take another QB"
    }
    return -100; // 3rd QB? never
  }

  // === TE logic ===
  if (candidatePos === "TE") {
    if (te === 0) return 25; // need TE1
    if (te === 1) {
      // 2nd TE: only for flex if W/T flex still open, or late-round depth
      // Check if W/T flex is open: need > 2 WR + 1 TE for flex
      const flexNeed = (wr + te) < 4; // base 2 WR + 1 TE + 1 W/T flex = 4
      if (flexNeed) return 8;
      if (round >= 8) return 3;
      const adpGap = overallPick - (candidateAdpRank ?? overallPick);
      if (adpGap >= 20) return 3; // steal
      return -35; // don't double up early
    }
    return -80; // 3+ TEs? no
  }

  // === RB logic (high volume, flex-eligible) ===
  if (candidatePos === "RB") {
    if (rb < 2) return 25; // need 2 starters
    if (rb === 2) return 15; // W/R flex or first bench RB
    if (rb === 3) return 8; // solid depth
    if (rb === 4) return 3; // bench stash
    return 0; // enough
  }

  // === WR logic (high volume, dual-flex-eligible) ===
  if (candidatePos === "WR") {
    if (wr < 2) return 25; // need 2 starters
    if (wr === 2) return 15; // W/T or W/R flex
    if (wr === 3) return 10; // second flex or depth
    if (wr === 4) return 4; // bench stash
    return 0;
  }

  return 0;
}

export default api({
  name: "RunMockDraft",
  description: "Simulates a full mock draft with controlled randomness.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    // Optional: start from a specific round (for "finish mock")
    startRound: z.number().int().min(1).max(11).default(1),
    // Optional: pre-existing picks to respect (player_id -> overall_pick mapping)
    existingPicks: z.array(z.object({
      overallPick: z.number(),
      playerId: z.number(),
    })).default([]),
  }),

  output: z.object({
    picks: z.array(z.object({
      overallPick: z.number(),
      round: z.number(),
      pickInRound: z.number(),
      teamId: z.number(),
      playerId: z.number(),
      playerName: z.string(),
      playerPosition: z.string(),
      playerNflTeam: z.string(),
      playerAdpRank: z.number().nullable(),
      playerDynastyRank: z.number().nullable(),
    })),
  }),

  async run(ctx, { startRound, existingPicks }) {
    // Fetch all data
    const [players, draftPicks, teams] = await Promise.all([
      ctx.integrations.apps_db.query(
        `SELECT id, name, position, nfl_team, adp_rank, dynasty_rank, positional_rank, bye_week,
                is_keeper, keeper_team_id
         FROM ffwr_players
         WHERE position IN ('QB','RB','WR','TE')
         ORDER BY COALESCE(adp_rank, 999)`,
        PlayerRow,
        undefined,
        { label: "Fetch all eligible players" }
      ),
      ctx.integrations.apps_db.query(
        `SELECT id, round, pick_in_round, overall_pick, team_id
         FROM ffwr_draft_picks ORDER BY overall_pick`,
        DraftPickRow,
        undefined,
        { label: "Fetch draft pick order" }
      ),
      ctx.integrations.apps_db.query(
        `SELECT id, team_name, draft_position FROM ffwr_teams`,
        TeamRow,
        undefined,
        { label: "Fetch teams" }
      ),
    ]);

    // Build keeper map: team_id -> [player positions]
    const teamKeepers = new Map<number, string[]>();
    const keeperIds = new Set<number>();
    for (const p of players) {
      if (p.is_keeper && p.keeper_team_id != null) {
        const arr = teamKeepers.get(p.keeper_team_id) ?? [];
        arr.push(p.position);
        teamKeepers.set(p.keeper_team_id, arr);
        keeperIds.add(p.id);
      }
    }

    // Track what each team has drafted (positions) — start with keepers
    const teamRoster = new Map<number, string[]>();
    for (const t of teams) {
      teamRoster.set(t.id, [...(teamKeepers.get(t.id) ?? [])]);
    }

    // Mark existing picks
    const drafted = new Set<number>(keeperIds);
    const existingPickMap = new Map<number, number>(); // overallPick -> playerId
    for (const ep of existingPicks) {
      existingPickMap.set(ep.overallPick, ep.playerId);
      drafted.add(ep.playerId);
      const player = players.find((p) => p.id === ep.playerId);
      if (player) {
        const pick = draftPicks.find((dp) => dp.overall_pick === ep.overallPick);
        if (pick) {
          const roster = teamRoster.get(pick.team_id) ?? [];
          roster.push(player.position);
          teamRoster.set(pick.team_id, roster);
        }
      }
    }

    // Generate team "personality" for this mock (randomness source)
    // Each team gets a slight positional lean
    const teamPersonality = new Map<number, { posLean: string; aggressiveness: number }>();
    const posOptions = ["QB", "RB", "WR", "TE", "BPA"];
    for (const t of teams) {
      const roll = Math.random();
      let posLean = "BPA"; // most teams draft BPA
      if (roll < 0.15) posLean = "RB";
      else if (roll < 0.3) posLean = "WR";
      else if (roll < 0.35) posLean = "TE";
      else if (roll < 0.38) posLean = "QB";
      // aggressiveness: how much they deviate from ADP (0-1, higher = more reaches)
      const aggressiveness = 0.1 + Math.random() * 0.3; // 0.1-0.4
      teamPersonality.set(t.id, { posLean, aggressiveness });
    }

    // Simulate picks
    const results: Array<{
      overallPick: number;
      round: number;
      pickInRound: number;
      teamId: number;
      playerId: number;
      playerName: string;
      playerPosition: string;
      playerNflTeam: string;
      playerAdpRank: number | null;
      playerDynastyRank: number | null;
    }> = [];

    // Process pre-startRound picks from existingPicks
    for (const pick of draftPicks) {
      if (pick.round < startRound) {
        const existingPlayerId = existingPickMap.get(pick.overall_pick);
        if (existingPlayerId) {
          const player = players.find((p) => p.id === existingPlayerId)!;
          results.push({
            overallPick: pick.overall_pick,
            round: pick.round,
            pickInRound: pick.pick_in_round,
            teamId: pick.team_id,
            playerId: player.id,
            playerName: player.name,
            playerPosition: player.position,
            playerNflTeam: player.nfl_team,
            playerAdpRank: player.adp_rank,
            playerDynastyRank: player.dynasty_rank,
          });
        }
        continue;
      }

      // Check if this pick has a pre-set assignment
      if (existingPickMap.has(pick.overall_pick)) {
        const player = players.find((p) => p.id === existingPickMap.get(pick.overall_pick)!)!;
        results.push({
          overallPick: pick.overall_pick,
          round: pick.round,
          pickInRound: pick.pick_in_round,
          teamId: pick.team_id,
          playerId: player.id,
          playerName: player.name,
          playerPosition: player.position,
          playerNflTeam: player.nfl_team,
          playerAdpRank: player.adp_rank,
          playerDynastyRank: player.dynasty_rank,
        });
        continue;
      }

      // Simulate this pick
      const teamId = pick.team_id;
      const roster = teamRoster.get(teamId) ?? [];
      const personality = teamPersonality.get(teamId) ?? { posLean: "BPA", aggressiveness: 0.2 };

      // Score all available players
      const available = players.filter((p) => !drafted.has(p.id));
      if (available.length === 0) break;

      const scored = available.map((p) => {
        // Base score from ADP — normalized to 0-100 range so need scores
        // can meaningfully compete. A player at ADP 1 scores 100, ADP 100 = 50, ADP 200 = 0.
        const adpScore = p.adp_rank != null
          ? Math.max(0, 100 * (1 - (p.adp_rank - 1) / 200))
          : 25;
        // Dynasty bonus (0-20 range)
        const dynScore = p.dynasty_rank != null
          ? Math.max(0, 20 * (1 - (p.dynasty_rank - 1) / 150))
          : 0;
        // Positional need — roster-aware, round-aware, value-aware
        // Returns -100 to +30 — at this scale, a -40 penalty actually matters
        const needScore = positionalNeedScore(roster, p.position, pick.round, p.adp_rank, pick.overall_pick);
        // Personality lean bonus
        const leanBonus = personality.posLean === p.position ? 8 : 0;
        // Random variance (controlled chaos — smaller range so it doesn't override logic)
        const randomFactor = (Math.random() - 0.5) * 2 * personality.aggressiveness * 15;
        // Position run: if last 2-3 picks in the draft were same position, slight avoidance
        const recentPositions = results.slice(-3).map((r) => r.playerPosition);
        const runPenalty = recentPositions.filter((pos) => pos === p.position).length >= 2 ? -5 : 0;

        const totalScore = adpScore + dynScore + needScore + leanBonus + randomFactor + runPenalty;
        return { player: p, score: totalScore };
      });

      // Sort by score descending, then occasionally pick #2 (8%) or #3 (4%)
      // Narrower range so terrible picks don't sneak through
      scored.sort((a, b) => b.score - a.score);
      let pickIdx = 0;
      const pickRoll = Math.random();
      if (pickRoll > 0.96 && scored.length > 2) pickIdx = 2;
      else if (pickRoll > 0.88 && scored.length > 1) pickIdx = 1;

      const chosen = scored[pickIdx].player;
      drafted.add(chosen.id);
      roster.push(chosen.position);
      teamRoster.set(teamId, roster);

      results.push({
        overallPick: pick.overall_pick,
        round: pick.round,
        pickInRound: pick.pick_in_round,
        teamId: pick.team_id,
        playerId: chosen.id,
        playerName: chosen.name,
        playerPosition: chosen.position,
        playerNflTeam: chosen.nfl_team,
        playerAdpRank: chosen.adp_rank,
        playerDynastyRank: chosen.dynasty_rank,
      });
    }

    return { picks: results };
  },
});
