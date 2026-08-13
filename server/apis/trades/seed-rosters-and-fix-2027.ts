import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

// Manager name → team_id mapping
const TEAM_IDS: Record<string, number> = {
  JT: 1,
  Tyler: 2,
  Brooke: 3,
  Carson: 4,
  AJ: 5,
  Adam: 6,
  Drew: 7,
  Erik: 8,
  Jimmy: 9,
  Chuck: 10,
  Jordan: 11,
};

// ─── 2027 corrected pick ownership (round → list of current owners) ───
const PICKS_2027: Record<number, string[]> = {
  1: ["Adam", "AJ", "AJ", "Brooke", "Carson", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "Tyler"],
  2: ["Adam", "AJ", "Brooke", "Brooke", "Brooke", "Carson", "Chuck", "Drew", "Jimmy", "Jordan", "Tyler"],
  3: ["Adam", "AJ", "Brooke", "Carson", "Carson", "Chuck", "Drew", "Erik", "Erik", "Jimmy", "Jordan"],
  4: ["Adam", "AJ", "Brooke", "Carson", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "Tyler", "Tyler"],
  5: ["Adam", "AJ", "Brooke", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "JT", "Tyler", "Tyler"],
  6: ["Adam", "AJ", "AJ", "Carson", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "JT", "Tyler"],
  7: ["Adam", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "JT", "JT", "Tyler", "Tyler", "Tyler"],
  8: ["Adam", "AJ", "Brooke", "Carson", "Chuck", "Drew", "Erik", "Jordan", "JT", "JT", "Tyler"],
  9: ["Adam", "Brooke", "Carson", "Chuck", "Drew", "Erik", "Jimmy", "Jordan", "JT", "JT", "Tyler"],
  10: ["Adam", "AJ", "Brooke", "Carson", "Carson", "Chuck", "Erik", "Erik", "Jordan", "JT", "JT"],
  11: ["Adam", "AJ", "Brooke", "Carson", "Chuck", "Drew", "Drew", "Jimmy", "Jordan", "JT", "Tyler"],
};

// ─── Full team rosters ───
const ROSTERS: Record<string, { position: string; name: string }[]> = {
  Adam: [
    { position: "QB", name: "Josh Allen" },
    { position: "RB", name: "Saquon Barkley" },
    { position: "RB", name: "Travis Etienne Jr" },
    { position: "RB", name: "Jaylen Warren" },
    { position: "RB", name: "RJ Harvey" },
    { position: "RB", name: "Kimani Vidal" },
    { position: "RB", name: "Tyler Allgeier" },
    { position: "RB", name: "Keaton Mitchell" },
    { position: "WR", name: "Amon-Ra St. Brown" },
    { position: "WR", name: "Justin Jefferson" },
    { position: "WR", name: "Khalil Shakir" },
    { position: "WR", name: "Ricky Pearsall" },
    { position: "WR", name: "Jayden Reed" },
    { position: "WR", name: "Devaughn Vele" },
    { position: "WR", name: "Adonai Mitchell" },
    { position: "TE", name: "Jake Ferguson" },
    { position: "TE", name: "Dalton Schultz" },
  ],
  AJ: [
    { position: "QB", name: "Jaxon Dart" },
    { position: "QB", name: "Joe Burrow" },
    { position: "RB", name: "Jahmyr Gibbs" },
    { position: "RB", name: "Sean Tucker" },
    { position: "RB", name: "Nick Chubb" },
    { position: "RB", name: "Kaleb Johnson" },
    { position: "WR", name: "Ja'Marr Chase" },
    { position: "WR", name: "Malik Nabers" },
    { position: "WR", name: "Christian Watson" },
    { position: "WR", name: "Marvin Harrison Jr" },
    { position: "WR", name: "Cooper Kupp" },
    { position: "WR", name: "Xavier Legette" },
    { position: "WR", name: "Tez Johnson" },
    { position: "WR", name: "Darnell Mooney" },
    { position: "WR", name: "Luther Burden III" },
    { position: "TE", name: "TJ Hockenson" },
    { position: "TE", name: "Evan Engram" },
  ],
  Brooke: [
    { position: "QB", name: "Trevor Lawrence" },
    { position: "RB", name: "Omarion Hampton" },
    { position: "RB", name: "Tyrone Tracy Jr" },
    { position: "RB", name: "Alvin Kamara" },
    { position: "RB", name: "Blake Corum" },
    { position: "RB", name: "Isiah Pacheco" },
    { position: "RB", name: "James Cook III" },
    { position: "WR", name: "Chris Olave" },
    { position: "WR", name: "Emeka Egbuka" },
    { position: "WR", name: "Alec Pierce" },
    { position: "WR", name: "Jauan Jennings" },
    { position: "WR", name: "Xavier Worthy" },
    { position: "TE", name: "Sam LaPorta" },
    { position: "TE", name: "Hunter Henry" },
  ],
  Carson: [
    { position: "QB", name: "Drake Maye" },
    { position: "QB", name: "Brock Purdy" },
    { position: "RB", name: "Jonathan Taylor" },
    { position: "RB", name: "De'Von Achane" },
    { position: "RB", name: "D'Andre Swift" },
    { position: "RB", name: "JK Dobbins" },
    { position: "RB", name: "Aaron Jones Sr" },
    { position: "RB", name: "Rachaad White" },
    { position: "RB", name: "Jaylen Wright" },
    { position: "WR", name: "Drake London" },
    { position: "WR", name: "Garrett Wilson" },
    { position: "WR", name: "Stefon Diggs" },
    { position: "WR", name: "Chimere Dike" },
    { position: "WR", name: "Kyshon Boutte" },
    { position: "WR", name: "Jalen Coker" },
    { position: "TE", name: "Darren Waller" },
  ],
  Chuck: [
    { position: "QB", name: "Jared Goff" },
    { position: "QB", name: "Jayden Daniels" },
    { position: "RB", name: "Kenneth Walker III" },
    { position: "RB", name: "Kenneth Gainwell" },
    { position: "RB", name: "Kareem Hunt" },
    { position: "RB", name: "Jawhar Jordan" },
    { position: "RB", name: "Audric Estime" },
    { position: "RB", name: "Devin Neal" },
    { position: "WR", name: "AJ Brown" },
    { position: "WR", name: "Michael Wilson" },
    { position: "WR", name: "Rome Odunze" },
    { position: "WR", name: "Tetairoa McMillan" },
    { position: "WR", name: "Brian Thomas Jr" },
    { position: "WR", name: "Matthew Golden" },
    { position: "WR", name: "Kyle Williams" },
    { position: "TE", name: "Kyle Pitts Sr" },
    { position: "TE", name: "Colby Parkinson" },
    { position: "TE", name: "Colston Loveland" },
  ],
  Drew: [
    { position: "QB", name: "Jacoby Brissett" },
    { position: "RB", name: "Bijan Robinson" },
    { position: "RB", name: "Quinshon Judkins" },
    { position: "RB", name: "Zach Charbonnet" },
    { position: "RB", name: "Emanuel Wilson" },
    { position: "RB", name: "Dylan Simpson" },
    { position: "RB", name: "MarShawn Lloyd" },
    { position: "WR", name: "DK Metcalf" },
    { position: "WR", name: "DeVonta Smith" },
    { position: "WR", name: "Troy Franklin" },
    { position: "WR", name: "DJ Moore" },
    { position: "WR", name: "Tre Tucker" },
    { position: "WR", name: "Elic Ayomanor" },
    { position: "WR", name: "Isaac TeSlaa" },
    { position: "TE", name: "Trey McBride" },
    { position: "TE", name: "Harold Fannin Jr" },
    { position: "TE", name: "Juwan Johnson" },
  ],
  Erik: [
    { position: "QB", name: "Jalen Hurts" },
    { position: "RB", name: "Cam Skattebo" },
    { position: "RB", name: "Ashton Jeanty" },
    { position: "RB", name: "David Montgomery" },
    { position: "RB", name: "Woody Marks" },
    { position: "RB", name: "Bhayshul Tuten" },
    { position: "WR", name: "Rashee Rice" },
    { position: "WR", name: "CeeDee Lamb" },
    { position: "WR", name: "Tee Higgins" },
    { position: "WR", name: "Jakobi Meyers" },
    { position: "TE", name: "Dalton Kincaid" },
    { position: "TE", name: "AJ Barner" },
  ],
  Jimmy: [
    { position: "QB", name: "Justin Herbert" },
    { position: "RB", name: "Chase Brown" },
    { position: "RB", name: "Rico Dowdle" },
    { position: "RB", name: "Tony Pollard" },
    { position: "RB", name: "Kyle Monangai" },
    { position: "RB", name: "Chuba Hubbard" },
    { position: "RB", name: "Isaiah Davis" },
    { position: "WR", name: "Jaxon Smith-Njigba" },
    { position: "WR", name: "Puka Nacua" },
    { position: "WR", name: "Deebo Samuel" },
    { position: "WR", name: "Josh Downs" },
    { position: "WR", name: "Keon Coleman" },
    { position: "TE", name: "Brock Bowers" },
  ],
  Jordan: [
    { position: "QB", name: "Dak Prescott" },
    { position: "RB", name: "Christian McCaffrey" },
    { position: "RB", name: "Josh Jacobs" },
    { position: "RB", name: "TreVeyon Henderson" },
    { position: "RB", name: "Tyjae Spears" },
    { position: "RB", name: "Malik Davis" },
    { position: "RB", name: "Brian Robinson Jr" },
    { position: "WR", name: "Ladd McConkey" },
    { position: "WR", name: "Nico Collins" },
    { position: "WR", name: "Jaylen Waddle" },
    { position: "WR", name: "Jameson Williams" },
    { position: "WR", name: "Michael Pittman Jr" },
    { position: "WR", name: "Terry McLaurin" },
    { position: "WR", name: "Rashid Shaheed" },
    { position: "WR", name: "Chris Godwin Jr" },
    { position: "TE", name: "George Kittle" },
  ],
  JT: [
    { position: "QB", name: "Patrick Mahomes" },
    { position: "QB", name: "Matthew Stafford" },
    { position: "QB", name: "Lamar Jackson" },
    { position: "RB", name: "Javonte Williams" },
    { position: "RB", name: "Derrick Henry" },
    { position: "RB", name: "Rhamondre Stevenson" },
    { position: "RB", name: "Jacory Croskey-Merritt" },
    { position: "RB", name: "Jordan Mason" },
    { position: "WR", name: "Davante Adams" },
    { position: "WR", name: "Wan'Dale Robinson" },
    { position: "WR", name: "Courtland Sutton" },
    { position: "WR", name: "Keenan Allen" },
    { position: "WR", name: "Jordan Addison" },
    { position: "WR", name: "Zay Flowers" },
    { position: "TE", name: "Dallas Goedert" },
    { position: "TE", name: "Travis Kelce" },
    { position: "TE", name: "Tyler Warren" },
  ],
  Tyler: [
    { position: "QB", name: "Sam Darnold" },
    { position: "RB", name: "Bucky Irving" },
    { position: "RB", name: "Bam Knight" },
    { position: "RB", name: "Michael Carter" },
    { position: "RB", name: "Chris Rodriguez Jr" },
    { position: "RB", name: "Kyren Williams" },
    { position: "RB", name: "Breece Hall" },
    { position: "WR", name: "George Pickens" },
    { position: "WR", name: "Quentin Johnston" },
    { position: "WR", name: "Mike Evans" },
    { position: "WR", name: "Romeo Doubs" },
    { position: "WR", name: "Travis Hunter" },
    { position: "WR", name: "Jayden Higgins" },
    { position: "WR", name: "Darius Slayton" },
    { position: "WR", name: "Brandon Aiyuk" },
    { position: "WR", name: "Tyreek Hill" },
    { position: "TE", name: "Tucker Kraft" },
    { position: "TE", name: "Brenton Strange" },
    { position: "TE", name: "Cade Otton" },
  ],
};

export default api({
  name: "SeedRostersAndFix2027",
  description: "Corrects 2027 draft capital ownership + adds roster_team_id + seeds full team rosters.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),

  output: z.object({
    picksUpdated: z.number(),
    rosterPlayersSeeded: z.number(),
    columnAdded: z.boolean(),
  }),

  async run(ctx) {
    // ─── Step 1: Add roster_team_id column if missing ───
    let columnAdded = false;
    try {
      await ctx.integrations.apps_db.execute(
        `ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS roster_team_id INTEGER REFERENCES ffwr_teams(id)`,
        undefined,
        { label: "Add roster_team_id column" }
      );
      columnAdded = true;
    } catch (e) {
      ctx.log.info("roster_team_id column may already exist", { error: String(e) });
    }

    // ─── Step 2: Fix 2027 draft capital ───
    // First, get all existing 2027 picks with original_team_id mapping
    const existing2027 = await ctx.integrations.apps_db.query(
      `SELECT id, round, original_team_id, current_team_id
       FROM ffwr_draft_capital
       WHERE year = 2027
       ORDER BY round, original_team_id
       LIMIT 200`,
      z.object({
        id: z.coerce.number(),
        round: z.coerce.number(),
        original_team_id: z.coerce.number(),
        current_team_id: z.coerce.number(),
      }),
      undefined,
      { label: "Read existing 2027 draft capital" }
    );

    // For each round, we need to match user's ownership to original teams
    // Strategy: for each round, count how many picks each manager should own
    // Then assign original_team picks to current owners
    let picksUpdated = 0;

    for (let round = 1; round <= 11; round++) {
      const roundPicks = existing2027.filter((p) => p.round === round);
      const desiredOwners = PICKS_2027[round];
      if (!desiredOwners) continue;

      // Count desired ownership by team_id
      const desiredCounts = new Map<number, number>();
      for (const manager of desiredOwners) {
        const teamId = TEAM_IDS[manager];
        if (teamId) desiredCounts.set(teamId, (desiredCounts.get(teamId) ?? 0) + 1);
      }

      // Current ownership counts
      const currentCounts = new Map<number, number>();
      for (const p of roundPicks) {
        currentCounts.set(p.current_team_id, (currentCounts.get(p.current_team_id) ?? 0) + 1);
      }

      // Check if already correct
      let isCorrect = true;
      for (const [teamId, count] of desiredCounts) {
        if ((currentCounts.get(teamId) ?? 0) !== count) {
          isCorrect = false;
          break;
        }
      }
      // Also check teams that should have 0 but currently have picks
      for (const [teamId, count] of currentCounts) {
        if ((desiredCounts.get(teamId) ?? 0) !== count) {
          isCorrect = false;
          break;
        }
      }

      if (isCorrect) continue;

      // Need to reassign. Strategy: 
      // - Teams that keep their own pick stay (original == current == desired)
      // - For the rest, assign traded picks
      const availablePicks = [...roundPicks]; // picks we can reassign
      const assignments: { pickId: number; newOwner: number }[] = [];

      // First pass: lock in picks where original owner still owns it AND is in desired
      const lockedPickIds = new Set<number>();
      const fulfilledOwners: number[] = [];

      for (const pick of availablePicks) {
        if (
          pick.original_team_id === pick.current_team_id &&
          desiredCounts.has(pick.current_team_id)
        ) {
          // This team owns their own pick and should own at least one
          const remaining = (desiredCounts.get(pick.current_team_id) ?? 0) - 
            fulfilledOwners.filter((o) => o === pick.current_team_id).length;
          if (remaining > 0) {
            lockedPickIds.add(pick.id);
            fulfilledOwners.push(pick.current_team_id);
          }
        }
      }

      // Build remaining needs
      const remainingNeeds: number[] = [];
      for (const manager of desiredOwners) {
        const teamId = TEAM_IDS[manager]!;
        const alreadyFulfilled = fulfilledOwners.filter((o) => o === teamId).length;
        const totalNeeded = desiredOwners.filter((m) => TEAM_IDS[m] === teamId).length;
        const stillNeeded = totalNeeded - alreadyFulfilled;
        if (stillNeeded > 0 && remainingNeeds.filter((n) => n === teamId).length < stillNeeded) {
          remainingNeeds.push(teamId);
        }
      }

      // Deduplicate remainingNeeds properly
      const needsByTeam = new Map<number, number>();
      for (const manager of desiredOwners) {
        const teamId = TEAM_IDS[manager]!;
        needsByTeam.set(teamId, (needsByTeam.get(teamId) ?? 0) + 1);
      }
      for (const id of fulfilledOwners) {
        const cur = needsByTeam.get(id) ?? 0;
        if (cur > 0) needsByTeam.set(id, cur - 1);
      }

      // Assign remaining unlocked picks to remaining needs
      const unlockedPicks = availablePicks.filter((p) => !lockedPickIds.has(p.id));
      let needIdx = 0;
      const flatNeeds: number[] = [];
      for (const [teamId, count] of needsByTeam) {
        for (let i = 0; i < count; i++) flatNeeds.push(teamId);
      }

      for (const pick of unlockedPicks) {
        if (needIdx < flatNeeds.length) {
          const newOwner = flatNeeds[needIdx]!;
          if (pick.current_team_id !== newOwner) {
            assignments.push({ pickId: pick.id, newOwner });
          }
          needIdx++;
        }
      }

      // Execute updates for this round
      for (const { pickId, newOwner } of assignments) {
        await ctx.integrations.apps_db.execute(
          `UPDATE ffwr_draft_capital SET current_team_id = $1 WHERE id = $2`,
          [newOwner, pickId],
          { label: `Fix 2027 R${round} pick ${pickId} → team ${newOwner}` }
        );
        picksUpdated++;
      }
    }

    // ─── Step 3: Seed roster assignments ───
    // First, clear all existing roster assignments to start fresh
    await ctx.integrations.apps_db.execute(
      `UPDATE ffwr_players SET roster_team_id = NULL WHERE roster_team_id IS NOT NULL`,
      undefined,
      { label: "Clear existing roster assignments" }
    );

    let rosterPlayersSeeded = 0;

    for (const [manager, players] of Object.entries(ROSTERS)) {
      const teamId = TEAM_IDS[manager];
      if (!teamId) continue;

      // Batch update: set roster_team_id for each player by name match
      // Process in batches of 5 to avoid parameter limits
      for (let i = 0; i < players.length; i += 5) {
        const batch = players.slice(i, i + 5);
        for (const player of batch) {
          // Try exact match first, then fuzzy via ILIKE
          const result = await ctx.integrations.apps_db.execute(
            `UPDATE ffwr_players SET roster_team_id = $1 
             WHERE (name = $2 OR name ILIKE $3) AND roster_team_id IS NULL`,
            [teamId, player.name, `%${player.name}%`],
            { label: `Assign ${player.name} → ${manager}` }
          );

          if (result.rowCount > 0) {
            rosterPlayersSeeded += result.rowCount;
          } else {
            // Player doesn't exist in ffwr_players — insert them
            await ctx.integrations.apps_db.execute(
              `INSERT INTO ffwr_players (name, position, nfl_team, roster_team_id, is_keeper, is_drafted)
               VALUES ($1, $2, '', $3, false, false)
               ON CONFLICT DO NOTHING`,
              [player.name, player.position, teamId],
              { label: `Insert + assign ${player.name} → ${manager}` }
            );
            rosterPlayersSeeded++;
          }
        }
      }
    }

    // Also set roster_team_id for all keepers based on keeper_team_id
    await ctx.integrations.apps_db.execute(
      `UPDATE ffwr_players SET roster_team_id = keeper_team_id 
       WHERE is_keeper = true AND keeper_team_id IS NOT NULL AND roster_team_id IS NULL`,
      undefined,
      { label: "Sync keeper roster assignments" }
    );

    return { picksUpdated, rosterPlayersSeeded, columnAdded };
  },
});
