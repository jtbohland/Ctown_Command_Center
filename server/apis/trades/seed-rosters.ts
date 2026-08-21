import { api, z, postgres } from "@superblocksteam/sdk-api";
import { requireAdmin } from "../../lib/auth/require-admin.js";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// Manager name → team ID mapping
const MANAGER_TO_TEAM: Record<string, number> = {
  JT: 1, Tyler: 2, Brooke: 3, Carson: 4, AJ: 5,
  Adam: 6, Drew: 7, Erik: 8, Jimmy: 9, Chuck: 10, Jordan: 11,
};

// ─── 2027 Corrected Ownership ───────────────────────────────
// Each round lists the current owner (manager name) for each of the 11 picks.
// The original_team_id stays as-is; only current_team_id is updated.
const OWNERSHIP_2027: Record<number, string[]> = {
  1:  ["Adam", "AJ", "AJ", "Brooke", "Carson", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "Tyler"],
  2:  ["Adam", "AJ", "Brooke", "Brooke", "Brooke", "Carson", "Chuck", "Drew", "Jimmy", "Jordan", "Tyler"],
  3:  ["Adam", "AJ", "Brooke", "Carson", "Carson", "Chuck", "Drew", "Erik", "Erik", "Jimmy", "Jordan"],
  4:  ["Adam", "AJ", "Brooke", "Carson", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "Tyler", "Tyler"],
  5:  ["Adam", "AJ", "Brooke", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "JT", "Tyler", "Tyler"],
  6:  ["Adam", "AJ", "AJ", "Carson", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "JT", "Tyler"],
  7:  ["Adam", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "JT", "JT", "Tyler", "Tyler", "Tyler"],
  8:  ["Adam", "AJ", "Brooke", "Carson", "Chuck", "Drew", "Erik", "Jordan", "JT", "JT", "Tyler"],
  9:  ["Adam", "Brooke", "Carson", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "JT", "JT", "Tyler"],
  10: ["Adam", "AJ", "Brooke", "Carson", "Carson", "Chuck", "Erik", "Erik", "Jordan", "JT", "JT"],
  11: ["Adam", "AJ", "Brooke", "Carson", "Chuck", "Drew", "Drew", "Jimmy", "Jordan", "JT", "Tyler"],
};

// ─── Full Rosters by Manager ────────────────────────────────
interface RosterEntry { name: string; position: string }
const ROSTERS: Record<string, RosterEntry[]> = {
  Adam: [
    { name: "Josh Allen", position: "QB" },
    { name: "Saquon Barkley", position: "RB" }, { name: "Travis Etienne Jr", position: "RB" },
    { name: "Jaylen Warren", position: "RB" }, { name: "RJ Harvey", position: "RB" },
    { name: "Kimani Vidal", position: "RB" }, { name: "Tyler Allgeier", position: "RB" },
    { name: "Keaton Mitchell", position: "RB" },
    { name: "Amon-Ra St. Brown", position: "WR" }, { name: "Justin Jefferson", position: "WR" },
    { name: "Khalil Shakir", position: "WR" }, { name: "Ricky Pearsall", position: "WR" },
    { name: "Jayden Reed", position: "WR" }, { name: "Devaughn Vele", position: "WR" },
    { name: "Adonai Mitchell", position: "WR" },
    { name: "Jake Ferguson", position: "TE" }, { name: "Dalton Schultz", position: "TE" },
  ],
  AJ: [
    { name: "Jaxon Dart", position: "QB" }, { name: "Joe Burrow", position: "QB" },
    { name: "Jahmyr Gibbs", position: "RB" }, { name: "Sean Tucker", position: "RB" },
    { name: "Nick Chubb", position: "RB" }, { name: "Kaleb Johnson", position: "RB" },
    { name: "Ja'Marr Chase", position: "WR" }, { name: "Malik Nabers", position: "WR" },
    { name: "Christian Watson", position: "WR" }, { name: "Marvin Harrison Jr", position: "WR" },
    { name: "Cooper Kupp", position: "WR" }, { name: "Xavier Legette", position: "WR" },
    { name: "Tez Johnson", position: "WR" }, { name: "Darnell Mooney", position: "WR" },
    { name: "Luther Burden III", position: "WR" },
    { name: "TJ Hockenson", position: "TE" }, { name: "Evan Engram", position: "TE" },
  ],
  Brooke: [
    { name: "Trevor Lawrence", position: "QB" },
    { name: "Omarion Hampton", position: "RB" }, { name: "Tyrone Tracy Jr", position: "RB" },
    { name: "Alvin Kamara", position: "RB" }, { name: "Blake Corum", position: "RB" },
    { name: "Isiah Pacheco", position: "RB" }, { name: "James Cook III", position: "RB" },
    { name: "Chris Olave", position: "WR" }, { name: "Emeka Egbuka", position: "WR" },
    { name: "Alec Pierce", position: "WR" }, { name: "Jauan Jennings", position: "WR" },
    { name: "Xavier Worthy", position: "WR" },
    { name: "Sam LaPorta", position: "TE" }, { name: "Hunter Henry", position: "TE" },
  ],
  Carson: [
    { name: "Drake Maye", position: "QB" }, { name: "Brock Purdy", position: "QB" },
    { name: "Jonathan Taylor", position: "RB" }, { name: "De'Von Achane", position: "RB" },
    { name: "D'Andre Swift", position: "RB" }, { name: "JK Dobbins", position: "RB" },
    { name: "Aaron Jones Sr", position: "RB" }, { name: "Rachaad White", position: "RB" },
    { name: "Jaylen Wright", position: "RB" },
    { name: "Drake London", position: "WR" }, { name: "Garrett Wilson", position: "WR" },
    { name: "Stefon Diggs", position: "WR" }, { name: "Chimere Dike", position: "WR" },
    { name: "Kyshon Boutte", position: "WR" }, { name: "Jalen Coker", position: "WR" },
    { name: "Darren Waller", position: "TE" },
  ],
  Chuck: [
    { name: "Jared Goff", position: "QB" }, { name: "Jayden Daniels", position: "QB" },
    { name: "Kenneth Walker III", position: "RB" }, { name: "Kenneth Gainwell", position: "RB" },
    { name: "Kareem Hunt", position: "RB" }, { name: "Jawhar Jordan", position: "RB" },
    { name: "Audric Estime", position: "RB" }, { name: "Devin Neal", position: "RB" },
    { name: "AJ Brown", position: "WR" }, { name: "Michael Wilson", position: "WR" },
    { name: "Rome Odunze", position: "WR" }, { name: "Tetairoa McMillan", position: "WR" },
    { name: "Brian Thomas Jr", position: "WR" }, { name: "Matthew Golden", position: "WR" },
    { name: "Kyle Williams", position: "WR" },
    { name: "Kyle Pitts Sr", position: "TE" }, { name: "Colby Parkinson", position: "TE" },
    { name: "Colston Loveland", position: "TE" },
  ],
  Drew: [
    { name: "Jacoby Brissett", position: "QB" },
    { name: "Bijan Robinson", position: "RB" }, { name: "Quinshon Judkins", position: "RB" },
    { name: "Zach Charbonnet", position: "RB" }, { name: "Emanuel Wilson", position: "RB" },
    { name: "Dylan Simpson", position: "RB" }, { name: "MarShawn Lloyd", position: "RB" },
    { name: "DK Metcalf", position: "WR" }, { name: "DeVonta Smith", position: "WR" },
    { name: "Troy Franklin", position: "WR" }, { name: "DJ Moore", position: "WR" },
    { name: "Tre Tucker", position: "WR" }, { name: "Elic Ayomanor", position: "WR" },
    { name: "Isaac TeSlaa", position: "WR" },
    { name: "Trey McBride", position: "TE" }, { name: "Harold Fannin Jr", position: "TE" },
    { name: "Juwan Johnson", position: "TE" },
  ],
  Erik: [
    { name: "Jalen Hurts", position: "QB" },
    { name: "Cam Skattebo", position: "RB" }, { name: "Ashton Jeanty", position: "RB" },
    { name: "David Montgomery", position: "RB" }, { name: "Woody Marks", position: "RB" },
    { name: "Bhayshul Tuten", position: "RB" },
    { name: "Rashee Rice", position: "WR" }, { name: "CeeDee Lamb", position: "WR" },
    { name: "Tee Higgins", position: "WR" }, { name: "Jakobi Meyers", position: "WR" },
    { name: "Dalton Kincaid", position: "TE" }, { name: "AJ Barner", position: "TE" },
  ],
  Jimmy: [
    { name: "Justin Herbert", position: "QB" },
    { name: "Chase Brown", position: "RB" }, { name: "Rico Dowdle", position: "RB" },
    { name: "Tony Pollard", position: "RB" }, { name: "Kyle Monangai", position: "RB" },
    { name: "Chuba Hubbard", position: "RB" }, { name: "Isaiah Davis", position: "RB" },
    { name: "Jaxon Smith-Njigba", position: "WR" }, { name: "Puka Nacua", position: "WR" },
    { name: "Deebo Samuel", position: "WR" }, { name: "Josh Downs", position: "WR" },
    { name: "Keon Coleman", position: "WR" },
    { name: "Brock Bowers", position: "TE" },
  ],
  Jordan: [
    { name: "Dak Prescott", position: "QB" },
    { name: "Christian McCaffrey", position: "RB" }, { name: "Josh Jacobs", position: "RB" },
    { name: "TreVeyon Henderson", position: "RB" }, { name: "Tyjae Spears", position: "RB" },
    { name: "Malik Davis", position: "RB" }, { name: "Brian Robinson Jr", position: "RB" },
    { name: "Ladd McConkey", position: "WR" }, { name: "Nico Collins", position: "WR" },
    { name: "Jaylen Waddle", position: "WR" }, { name: "Jameson Williams", position: "WR" },
    { name: "Michael Pittman Jr", position: "WR" }, { name: "Terry McLaurin", position: "WR" },
    { name: "Rashid Shaheed", position: "WR" }, { name: "Chris Godwin Jr", position: "WR" },
    { name: "George Kittle", position: "TE" },
  ],
  JT: [
    { name: "Patrick Mahomes", position: "QB" }, { name: "Matthew Stafford", position: "QB" },
    { name: "Lamar Jackson", position: "QB" },
    { name: "Javonte Williams", position: "RB" }, { name: "Derrick Henry", position: "RB" },
    { name: "Rhamondre Stevenson", position: "RB" }, { name: "Jacory Croskey-Merritt", position: "RB" },
    { name: "Jordan Mason", position: "RB" },
    { name: "Davante Adams", position: "WR" }, { name: "Wan'Dale Robinson", position: "WR" },
    { name: "Courtland Sutton", position: "WR" }, { name: "Keenan Allen", position: "WR" },
    { name: "Jordan Addison", position: "WR" }, { name: "Zay Flowers", position: "WR" },
    { name: "Dallas Goedert", position: "TE" }, { name: "Travis Kelce", position: "TE" },
    { name: "Tyler Warren", position: "TE" },
  ],
  Tyler: [
    { name: "Sam Darnold", position: "QB" },
    { name: "Bucky Irving", position: "RB" }, { name: "Bam Knight", position: "RB" },
    { name: "Michael Carter", position: "RB" }, { name: "Chris Rodriguez Jr", position: "RB" },
    { name: "Kyren Williams", position: "RB" }, { name: "Breece Hall", position: "RB" },
    { name: "George Pickens", position: "WR" }, { name: "Quentin Johnston", position: "WR" },
    { name: "Mike Evans", position: "WR" }, { name: "Romeo Doubs", position: "WR" },
    { name: "Travis Hunter", position: "WR" }, { name: "Jayden Higgins", position: "WR" },
    { name: "Darius Slayton", position: "WR" }, { name: "Brandon Aiyuk", position: "WR" },
    { name: "Tyreek Hill", position: "WR" },
    { name: "Tucker Kraft", position: "TE" }, { name: "Brenton Strange", position: "TE" },
    { name: "Cade Otton", position: "TE" },
  ],
};

export default api({
  name: "SeedRosters",
  description: "Corrects 2027 Treasury pick ownership and seeds full team rosters with roster_team_id.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({
    action: z.enum(["fix_2027_treasury", "seed_rosters", "both"]),
  }),

  output: z.object({
    treasury2027Updated: z.number(),
    rostersSeeded: z.number(),
    playersCreated: z.number(),
    errors: z.array(z.string()),
  }),

  async run(ctx, { action }) {
    requireAdmin(ctx, "seed rosters and treasury");

    let treasury2027Updated = 0;
    let rostersSeeded = 0;
    let playersCreated = 0;
    const errors: string[] = [];

    // ──────────────────────────────────────────────────
    // 1. Fix 2027 Treasury
    // ──────────────────────────────────────────────────
    if (action === "fix_2027_treasury" || action === "both") {
      ctx.log.info("Fixing 2027 Treasury ownership...");

      // Get existing 2027 picks grouped by round + original_team_id
      const ExistingSchema = z.object({
        id: z.coerce.number(),
        round: z.coerce.number(),
        original_team_id: z.coerce.number(),
        current_team_id: z.coerce.number(),
      });

      const existing = await ctx.integrations.apps_db.query(
        `SELECT id, round, original_team_id, current_team_id
         FROM ffwr_draft_capital
         WHERE year = 2027
         ORDER BY round, original_team_id
         LIMIT 200`,
        ExistingSchema,
        undefined,
        { label: "Fetch existing 2027 capital" }
      );

      // Group by round
      const byRound = new Map<number, typeof existing>();
      for (const pick of existing) {
        const arr = byRound.get(pick.round) ?? [];
        arr.push(pick);
        byRound.set(pick.round, arr);
      }

      // For each round, map picks to correct owners
      for (let round = 1; round <= 11; round++) {
        const roundPicks = byRound.get(round) ?? [];
        const owners = OWNERSHIP_2027[round];
        if (!owners) continue;

        // Sort by original_team_id to have deterministic order
        roundPicks.sort((a, b) => a.original_team_id - b.original_team_id);

        // Count how many picks each manager should own
        const ownerCounts = new Map<string, number>();
        for (const name of owners) {
          ownerCounts.set(name, (ownerCounts.get(name) ?? 0) + 1);
        }

        // Figure out who doesn't have a pick (their pick was traded)
        const allManagers = Object.keys(MANAGER_TO_TEAM);
        const tradedFrom: string[] = [];
        for (const m of allManagers) {
          if (!ownerCounts.has(m)) {
            tradedFrom.push(m);
          }
        }

        // For managers with >1 pick, they acquired from managers with 0 picks
        // Match them: traded-from managers' picks → extra-pick managers
        const extraPicks: { fromManager: string; toManager: string }[] = [];
        const remaining = [...tradedFrom];
        for (const [manager, count] of ownerCounts.entries()) {
          if (count > 1) {
            for (let i = 1; i < count; i++) {
              const from = remaining.shift();
              if (from) {
                extraPicks.push({ fromManager: from, toManager: manager });
              }
            }
          }
        }

        // Now update: each pick's current_team_id
        // - Original owner still has pick → current = original
        // - Original owner traded it → current = new owner
        for (const pick of roundPicks) {
          const origManager = allManagers.find(m => MANAGER_TO_TEAM[m] === pick.original_team_id);
          if (!origManager) continue;

          let newOwnerTeamId: number;

          // Check if this original owner traded their pick
          const traded = extraPicks.find(e => e.fromManager === origManager);
          if (traded) {
            newOwnerTeamId = MANAGER_TO_TEAM[traded.toManager];
          } else if (ownerCounts.has(origManager)) {
            // They kept their pick
            newOwnerTeamId = pick.original_team_id;
          } else {
            // Shouldn't happen, but skip
            continue;
          }

          if (pick.current_team_id !== newOwnerTeamId) {
            await ctx.integrations.apps_db.execute(
              `UPDATE ffwr_draft_capital SET current_team_id = $1 WHERE id = $2`,
              [newOwnerTeamId, pick.id],
              { label: `Fix R${round} pick from team ${pick.original_team_id} → owner ${newOwnerTeamId}` }
            );
            treasury2027Updated++;
          }
        }
      }
      ctx.log.info(`Updated ${treasury2027Updated} picks for 2027`);
    }

    // ──────────────────────────────────────────────────
    // 2. Seed Rosters
    // ──────────────────────────────────────────────────
    if (action === "seed_rosters" || action === "both") {
      ctx.log.info("Seeding rosters...");

      // Add roster_team_id column if it doesn't exist
      await ctx.integrations.apps_db.execute(
        `ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS roster_team_id INTEGER REFERENCES ffwr_teams(id)`,
        undefined,
        { label: "Add roster_team_id column" }
      );

      // Reset all roster assignments first
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players SET roster_team_id = NULL`,
        undefined,
        { label: "Clear existing roster assignments" }
      );

      // Also set roster_team_id for existing keepers
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players SET roster_team_id = keeper_team_id WHERE is_keeper = true AND keeper_team_id IS NOT NULL`,
        undefined,
        { label: "Set roster_team_id for keepers" }
      );

      // Process each team's roster
      for (const [manager, roster] of Object.entries(ROSTERS)) {
        const teamId = MANAGER_TO_TEAM[manager];
        if (!teamId) {
          errors.push(`Unknown manager: ${manager}`);
          continue;
        }

        for (const player of roster) {
          // Try to match by exact name first
          const MatchSchema = z.object({ id: z.coerce.number() });
          const matches = await ctx.integrations.apps_db.query(
            `SELECT id FROM ffwr_players WHERE LOWER(name) = LOWER($1) LIMIT 1`,
            MatchSchema,
            [player.name],
            { label: `Find ${player.name}` }
          );

          if (matches.length > 0) {
            // Player exists — assign to roster
            await ctx.integrations.apps_db.execute(
              `UPDATE ffwr_players SET roster_team_id = $1 WHERE id = $2`,
              [teamId, matches[0].id],
              { label: `Assign ${player.name} → ${manager}` }
            );
            rostersSeeded++;
          } else {
            // Player doesn't exist — insert with roster_team_id
            await ctx.integrations.apps_db.execute(
              `INSERT INTO ffwr_players (name, position, nfl_team, roster_team_id)
               VALUES ($1, $2, '', $3)`,
              [player.name, player.position, teamId],
              { label: `Create + assign ${player.name} → ${manager}` }
            );
            playersCreated++;
            rostersSeeded++;
          }
        }
      }
      ctx.log.info(`Seeded ${rostersSeeded} roster spots, created ${playersCreated} new players`);
    }

    return { treasury2027Updated, rostersSeeded, playersCreated, errors };
  },
});
