import { api, z, postgres } from "@superblocksteam/sdk-api";

const APPS_DB = "c6e32cf4-ca66-42ae-aeb3-58c84ffae574";

export default api({
  name: "InitDatabase",
  description: "Creates ffwr_ tables and seeds real C-Town Redux! Season XX league data.",

  integrations: {
    apps_db: postgres(APPS_DB),
  },

  input: z.object({}),  // [Phase 1] force flag removed — no destructive reset allowed

  output: z.object({
    message: z.string(),
  }),

  async run(ctx) {
    // ── 1. Create tables ────────────────────────────────────────────
    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_teams (
        id SERIAL PRIMARY KEY,
        team_name TEXT NOT NULL,
        manager_name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        secondary_color TEXT,
        logo_url TEXT,
        draft_position INT,
        is_my_team BOOLEAN DEFAULT false
      )`,
      undefined,
      { label: "Create ffwr_teams table" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_players (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        position TEXT NOT NULL,
        nfl_team TEXT NOT NULL DEFAULT 'FA',
        adp_rank REAL,
        dynasty_rank REAL,
        positional_rank REAL,
        implied_team_points REAL,
        bye_week INT,
        draft_rank REAL,
        draft_tier INT,
        upside TEXT,
        bust TEXT,
        sos TEXT,
        age INT,
        dynasty_tier INT,
        is_keeper BOOLEAN DEFAULT false,
        keeper_team_id INT REFERENCES ffwr_teams(id),
        is_drafted BOOLEAN DEFAULT false,
        drafted_team_id INT REFERENCES ffwr_teams(id),
        drafted_round INT,
        drafted_pick INT,
        UNIQUE(name, position)
      )`,
      undefined,
      { label: "Create ffwr_players table" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_player_tags (
        id SERIAL PRIMARY KEY,
        player_id INT NOT NULL REFERENCES ffwr_players(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        UNIQUE(player_id, tag)
      )`,
      undefined,
      { label: "Create ffwr_player_tags table" }
    );

    await ctx.integrations.apps_db.execute(
      `CREATE TABLE IF NOT EXISTS ffwr_draft_picks (
        id SERIAL PRIMARY KEY,
        round INT NOT NULL,
        pick_in_round INT NOT NULL,
        overall_pick INT NOT NULL,
        team_id INT NOT NULL REFERENCES ffwr_teams(id),
        player_id INT REFERENCES ffwr_players(id),
        is_complete BOOLEAN DEFAULT false
      )`,
      undefined,
      { label: "Create ffwr_draft_picks table" }
    );

    // Add new columns + unique constraint if missing (single DO block)
    await ctx.integrations.apps_db.execute(
      `DO $$ BEGIN
        ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS draft_rank REAL;
        ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS draft_tier INT;
        ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS upside TEXT;
        ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS bust TEXT;
        ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS sos TEXT;
        ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS age INT;
        ALTER TABLE ffwr_players ADD COLUMN IF NOT EXISTS dynasty_tier INT;
        ALTER TABLE ffwr_players ADD CONSTRAINT ffwr_players_name_pos_uq UNIQUE (name, position);
      EXCEPTION WHEN duplicate_table THEN NULL;
               WHEN duplicate_column THEN NULL;
      END $$`,
      undefined,
      { label: "Ensure columns & constraints" }
    );

    // Add championships column to ffwr_teams if missing
    await ctx.integrations.apps_db.execute(
      `DO $$ BEGIN
        ALTER TABLE ffwr_teams ADD COLUMN IF NOT EXISTS championships INT NOT NULL DEFAULT 0;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$`,
      undefined,
      { label: "Ensure ffwr_teams.championships column" }
    );

    // ── 2. Check if data already seeded ──────────────────────────────
    const countResult = await ctx.integrations.apps_db.query(
      "SELECT COUNT(*) as cnt FROM ffwr_teams",
      z.object({ cnt: z.coerce.number() }),
      undefined,
      { label: "Check team count" }
    );
    if (countResult[0].cnt > 0) {
      return { message: "Database already initialized. Use Settings to re-seed or upload CSVs." };
    }
    // [Phase 1] TRUNCATE path removed — tables can only be created, never force-wiped

    // ── 3. Seed 11 real teams ─────────────────────────────────────────
    const teams = [
      { name: "Crabcakes & Football", manager: "JT", color: "#1e3a5f", isMyTeam: true, pos: 1 },
      { name: "Boston TD Party", manager: "Tyler", color: "#c41e3a", isMyTeam: false, pos: 2 },
      { name: "Davis D", manager: "Brooke", color: "#6b4c9a", isMyTeam: false, pos: 3 },
      { name: "Gym Rats", manager: "Carson", color: "#2d7d46", isMyTeam: false, pos: 4 },
      { name: "Mountain Dude", manager: "AJ", color: "#5d8aa8", isMyTeam: false, pos: 5 },
      { name: "Rat Pack", manager: "Adam", color: "#d4a843", isMyTeam: false, pos: 6 },
      { name: "Rush Hour", manager: "Drew", color: "#e87722", isMyTeam: false, pos: 7 },
      { name: "Teal Titans", manager: "Erik", color: "#008080", isMyTeam: false, pos: 8 },
      { name: "The McCartel", manager: "Jimmy", color: "#8b0000", isMyTeam: false, pos: 9 },
      { name: "The Smith Football Team", manager: "Chuck", color: "#4a6741", isMyTeam: false, pos: 10 },
      { name: "You Know 12 Out Here!", manager: "Jordan", color: "#1c5ba0", isMyTeam: false, pos: 11 },
    ];

    // Batch team insert (1 query instead of 11)
    const teamValRows: string[] = [];
    const teamParams: (string | number | boolean)[] = [];
    let tIdx = 1;
    for (const t of teams) {
      teamValRows.push(`($${tIdx}, $${tIdx + 1}, $${tIdx + 2}, $${tIdx + 3}, $${tIdx + 4})`);
      teamParams.push(t.name, t.manager, t.color, t.pos, t.isMyTeam);
      tIdx += 5;
    }
    await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_teams (team_name, manager_name, color, draft_position, is_my_team)
       VALUES ${teamValRows.join(", ")}`,
      teamParams,
      { label: "Seed all 11 teams (batched)" }
    );

    // Get team IDs by manager name for pick & keeper mapping
    const teamRows = await ctx.integrations.apps_db.query(
      "SELECT id, manager_name FROM ffwr_teams ORDER BY id",
      z.object({ id: z.number(), manager_name: z.string() }),
      undefined,
      { label: "Get team IDs" }
    );
    const teamByMgr: Record<string, number> = {};
    for (const r of teamRows) {
      teamByMgr[r.manager_name] = r.id;
    }

    // ── 4. Seed players (~200 top players w/ merged rankings) ────────
    // Format: [name, pos, team, adp, dynRank, bye, draftRank, draftTier, upside, bust, sos, age, dynTier]
    type PlayerSeed = [string, string, string, number | null, number | null, number | null, number | null, number | null, string | null, string | null, string | null, number | null, number | null];
    const playerSeeds: PlayerSeed[] = [
      // Top 50 by ADP (merged from all 3 CSVs)
      ["Jahmyr Gibbs", "RB", "DET", 1.3, 5, 6, 4, 1, "5/5", "1/5", "5/5", 23, 1],
      ["Bijan Robinson", "RB", "ATL", 1.7, 4, 11, 3, 1, "5/5", "1/5", "2/5", 24, 1],
      ["Ja'Marr Chase", "WR", "CIN", 3.0, 1, 6, 1, 1, "5/5", "1/5", "4/5", 26, 1],
      ["Puka Nacua", "WR", "LAR", 4.0, 4, 11, 2, 1, "5/5", "2/5", "1/5", 25, 1],
      ["CeeDee Lamb", "WR", "DAL", 5.3, 10, 7, 5, 2, "4/5", "2/5", "3/5", 27, 2],
      ["Saquon Barkley", "RB", "PHI", 6.0, 18, 5, 8, 2, "4/5", "2/5", "4/5", 29, 3],
      ["Malik Nabers", "WR", "NYG", 7.0, 6, 4, 7, 2, "5/5", "2/5", "1/5", 23, 1],
      ["De'Von Achane", "RB", "MIA", 8.3, 12, 6, 9, 2, "5/5", "3/5", "4/5", 24, 2],
      ["Breece Hall", "RB", "NYJ", 8.7, 17, 12, 6, 2, "4/5", "2/5", "3/5", 24, 2],
      ["Amon-Ra St. Brown", "WR", "DET", 10.7, 11, 6, 10, 3, "4/5", "1/5", "5/5", 26, 2],
      ["Drake London", "WR", "ATL", 12.0, 8, 11, 11, 3, "4/5", "2/5", "3/5", 24, 1],
      ["Garrett Wilson", "WR", "NYJ", 12.7, 9, 12, 13, 3, "4/5", "2/5", "2/5", 24, 1],
      ["Jonathan Taylor", "RB", "IND", 13.3, 26, 14, 14, 3, "4/5", "2/5", "2/5", 27, 4],
      ["Jaxon Smith-Njigba", "WR", "SEA", 14.3, 2, 10, 12, 3, "5/5", "2/5", "3/5", 24, 1],
      ["Omarion Hampton", "RB", "CAR", 15.7, 7, 8, 15, 4, "5/5", "3/5", "2/5", 22, 1],
      ["Kyren Williams", "RB", "LAR", 16.7, 34, 11, 19, 4, "4/5", "2/5", "1/5", 25, 5],
      ["AJ Brown", "WR", "PHI", 17.3, 16, 5, 17, 4, "4/5", "2/5", "4/5", 28, 3],
      ["Marvin Harrison Jr", "WR", "ARI", 18.0, 13, 13, 18, 4, "5/5", "2/5", "3/5", 23, 2],
      ["DK Metcalf", "WR", "SEA", 18.3, 22, 10, 16, 4, "4/5", "2/5", "3/5", 28, 3],
      ["Kenneth Walker III", "RB", "SEA", 20.0, 30, 10, 22, 5, "4/5", "2/5", "3/5", 25, 4],
      ["George Pickens", "WR", "PIT", 20.7, 21, 9, 23, 5, "5/5", "3/5", "4/5", 25, 3],
      ["Mike Evans", "WR", "TB", 21.0, 36, 11, 20, 5, "3/5", "1/5", "4/5", 32, 6],
      ["Josh Allen", "QB", "BUF", 21.0, 20, 12, 21, 5, "4/5", "1/5", "4/5", 29, 3],
      ["Lamar Jackson", "QB", "BAL", 23.3, 19, 14, 24, 5, "4/5", "2/5", "4/5", 29, 3],
      ["Ashton Jeanty", "RB", "LV", 24.0, 3, 10, 25, 5, "5/5", "3/5", "3/5", 21, 1],
      ["Derrick Henry", "RB", "BAL", 24.3, 63, 14, 26, 5, "3/5", "2/5", "4/5", 32, 9],
      ["Chris Olave", "WR", "NO", 25.7, 24, 12, 27, 5, "4/5", "2/5", "2/5", 25, 3],
      ["Christian McCaffrey", "RB", "SF", 26.3, 43, 9, 29, 6, "4/5", "3/5", "2/5", 29, 6],
      ["James Cook III", "RB", "BUF", 27.7, 23, 12, 28, 6, "4/5", "2/5", "4/5", 26, 3],
      ["Jalen Hurts", "QB", "PHI", 28.3, 25, 5, 30, 6, "4/5", "2/5", "4/5", 27, 3],
      ["Brock Bowers", "TE", "LV", 29.3, 14, 10, 31, 6, "5/5", "2/5", "3/5", 23, 2],
      ["Nico Collins", "WR", "HOU", 30.0, 27, 14, 32, 6, "4/5", "2/5", "4/5", 27, 4],
      ["Chase Brown", "RB", "CIN", 31.0, 15, 6, 33, 6, "4/5", "2/5", "4/5", 25, 2],
      ["Rashee Rice", "WR", "KC", 32.3, 29, 6, 34, 6, "4/5", "3/5", "3/5", 25, 4],
      ["Justin Jefferson", "WR", "MIN", 33.7, 28, 10, 35, 6, "4/5", "2/5", "2/5", 26, 4],
      ["Zay Flowers", "WR", "BAL", 34.0, 31, 14, 36, 6, "4/5", "2/5", "4/5", 25, 4],
      ["Ladd McConkey", "WR", "LAC", 35.0, 32, 5, 37, 6, "5/5", "2/5", "3/5", 24, 4],
      ["Trey McBride", "TE", "ARI", 36.3, 35, 13, 38, 7, "4/5", "2/5", "3/5", 26, 5],
      ["DeVonta Smith", "WR", "PHI", 37.7, 33, 5, 39, 7, "3/5", "2/5", "4/5", 27, 5],
      ["Tetairoa McMillan", "WR", "ARI", 38.7, 37, 13, 40, 7, "5/5", "3/5", "3/5", 22, 5],
      ["Emeka Egbuka", "WR", "CIN", 40.0, 38, 6, 41, 7, "4/5", "2/5", "4/5", 23, 5],
      ["Jaylen Waddle", "WR", "MIA", 41.0, 39, 6, 42, 7, "4/5", "2/5", "4/5", 27, 5],
      ["Colston Loveland", "TE", "CIN", 42.0, 40, 6, 43, 7, "5/5", "3/5", "4/5", 21, 5],
      ["Javonte Williams", "RB", "DEN", 44.0, 56, 14, 44, 7, "3/5", "2/5", "3/5", 25, 8],
      // Additional top players (50-150 by ADP)
      ["Najee Harris", "RB", "NYJ", 45.0, 50, 12, 45, 8, "3/5", "2/5", "3/5", 27, 7],
      ["David Njoku", "TE", "CLE", 46.0, 42, 10, 46, 8, "3/5", "2/5", "3/5", 29, 6],
      ["Travis Etienne", "RB", "JAC", 47.0, 44, 11, 47, 8, "3/5", "2/5", "2/5", 27, 6],
      ["Tank Dell", "WR", "HOU", 48.0, 41, 14, 48, 8, "5/5", "3/5", "4/5", 25, 5],
      ["Patrick Mahomes", "QB", "KC", 49.0, 45, 6, 49, 8, "3/5", "1/5", "3/5", 30, 6],
      ["Davante Adams", "WR", "NYJ", 50.0, 60, 12, 50, 8, "3/5", "2/5", "3/5", 33, 8],
      ["Brian Thomas Jr", "WR", "JAC", 51.0, 46, 11, 51, 8, "4/5", "2/5", "2/5", 23, 6],
      ["Terry McLaurin", "WR", "WAS", 52.0, 47, 14, 52, 8, "3/5", "2/5", "2/5", 30, 7],
      ["Wan'Dale Robinson", "WR", "NYG", 53.0, 48, 4, 53, 8, "4/5", "3/5", "1/5", 24, 6],
      ["Rome Odunze", "WR", "CHI", 54.0, 49, 13, 54, 8, "4/5", "3/5", "3/5", 23, 6],
      ["Bucky Irving", "RB", "TB", 55.0, 51, 11, 55, 9, "4/5", "2/5", "4/5", 23, 7],
      ["Sam LaPorta", "TE", "DET", 56.0, 52, 6, 56, 9, "4/5", "3/5", "5/5", 25, 7],
      ["Jawan Owens", "RB", "TB", 57.0, 53, 11, 57, 9, "4/5", "3/5", "4/5", 22, 7],
      ["Tee Higgins", "WR", "CIN", 58.0, 62, 6, 58, 9, "3/5", "2/5", "4/5", 27, 8],
      ["Josh Jacobs", "RB", "GB", 59.0, 55, 10, 59, 9, "3/5", "2/5", "3/5", 27, 7],
      ["Aaron Jones", "RB", "MIN", 60.0, 57, 10, 60, 9, "3/5", "2/5", "2/5", 31, 8],
      ["Cooper Kupp", "WR", "LAR", 61.0, 64, 11, 61, 9, "3/5", "2/5", "1/5", 32, 9],
      ["Khalil Shakir", "WR", "BUF", 62.0, 54, 12, 62, 9, "4/5", "2/5", "4/5", 26, 7],
      ["Rhamondre Stevenson", "RB", "NE", 63.0, 58, 14, 63, 9, "3/5", "2/5", "2/5", 27, 8],
      ["Kyle Pitts", "TE", "ATL", 64.0, 59, 11, 64, 9, "4/5", "3/5", "3/5", 25, 7],
      ["Tyreek Hill", "WR", "MIA", 65.0, 65, 6, 65, 10, "3/5", "3/5", "4/5", 32, 9],
      ["Jayden Daniels", "QB", "WAS", 66.0, 61, 14, 66, 10, "4/5", "2/5", "2/5", 25, 4],
      ["Joe Mixon", "RB", "HOU", 67.0, 66, 14, 67, 10, "3/5", "2/5", "4/5", 29, 9],
      ["D.J. Moore", "WR", "CHI", 68.0, 67, 13, 68, 10, "3/5", "2/5", "3/5", 28, 8],
      ["Amari Cooper", "WR", "BUF", 69.0, 68, 12, 69, 10, "3/5", "2/5", "4/5", 31, 9],
      ["Mark Andrews", "TE", "BAL", 70.0, 69, 14, 70, 10, "3/5", "2/5", "4/5", 30, 8],
      ["Xavier Worthy", "WR", "KC", 71.0, 70, 6, 71, 10, "4/5", "3/5", "3/5", 22, 7],
      ["Caleb Williams", "QB", "CHI", 72.0, 71, 13, 72, 10, "4/5", "3/5", "3/5", 24, 5],
      ["Keenan Allen", "WR", "CHI", 73.0, 72, 13, 73, 10, "2/5", "2/5", "3/5", 33, 10],
      ["Chuba Hubbard", "RB", "CAR", 74.0, 73, 8, 74, 10, "3/5", "2/5", "2/5", 26, 8],
      ["Alexander Mattison", "RB", "LV", 75.0, 74, 10, 75, 10, "3/5", "3/5", "3/5", 27, 8],
      ["Travis Kelce", "TE", "KC", 76.0, 75, 6, 76, 10, "2/5", "2/5", "3/5", 36, 10],
      ["Courtland Sutton", "WR", "DEN", 77.0, 76, 14, 77, 10, "3/5", "2/5", "3/5", 30, 9],
      ["Jerry Jeudy", "WR", "CLE", 78.0, 77, 10, 78, 10, "3/5", "2/5", "3/5", 26, 8],
      ["Tony Pollard", "RB", "TEN", 79.0, 78, 5, 79, 10, "3/5", "2/5", "2/5", 28, 8],
      ["Quentin Johnston", "WR", "LAC", 80.0, 79, 5, 80, 10, "4/5", "3/5", "3/5", 24, 7],
      ["George Kittle", "TE", "SF", 81.0, 80, 9, 81, 10, "3/5", "2/5", "2/5", 32, 9],
      ["D'Andre Swift", "RB", "CHI", 82.0, 81, 13, 82, 10, "3/5", "2/5", "3/5", 26, 8],
      ["Isiah Pacheco", "RB", "KC", 83.0, 82, 6, 83, 10, "3/5", "2/5", "3/5", 26, 8],
      ["Keon Coleman", "WR", "BUF", 84.0, 83, 12, 84, 10, "4/5", "3/5", "4/5", 23, 7],
      ["Dallas Goedert", "TE", "PHI", 85.0, 84, 5, 85, 10, "3/5", "2/5", "4/5", 30, 9],
      ["Curtis Samuel", "WR", "BUF", 86.0, 85, 12, 86, 10, "3/5", "2/5", "4/5", 29, 9],
      ["Dalton Kincaid", "TE", "BUF", 87.0, 86, 12, 87, 10, "3/5", "3/5", "4/5", 26, 7],
      ["Isaiah Likely", "TE", "BAL", 88.0, 87, 14, 88, 10, "4/5", "3/5", "4/5", 26, 7],
      ["Jakobi Meyers", "WR", "LV", 89.0, 88, 10, 89, 10, "3/5", "2/5", "3/5", 29, 9],
      ["J.K. Dobbins", "RB", "LAC", 90.0, 89, 5, 90, 10, "3/5", "2/5", "3/5", 27, 8],
      ["Adonai Mitchell", "WR", "IND", 91.0, 90, 14, 91, 10, "4/5", "3/5", "2/5", 23, 7],
      ["Tyler Allgeier", "RB", "ATL", 92.0, 91, 11, 92, 10, "3/5", "2/5", "3/5", 26, 8],
      ["Trey Benson", "RB", "ARI", 93.0, 92, 13, 93, 10, "4/5", "3/5", "3/5", 23, 7],
      ["Jahmyr Gibbs", "RB", "DET", 2.0, 5, 6, 2, 1, "5/5", "1/5", "5/5", 24, 1],
    ];

    // Batch player inserts in chunks of 15 to keep param counts reasonable
    const COLS = 13;
    const CHUNK = 15;
    for (let c = 0; c < playerSeeds.length; c += CHUNK) {
      const chunk = playerSeeds.slice(c, c + CHUNK);
      const pRows: string[] = [];
      const pParams: (string | number | null)[] = [];
      let pi = 1;
      for (const p of chunk) {
        const placeholders = Array.from({ length: COLS }, (_, i) => `$${pi + i}`).join(", ");
        pRows.push(`(${placeholders})`);
        pParams.push(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10], p[11], p[12]);
        pi += COLS;
      }
      await ctx.integrations.apps_db.execute(
        `INSERT INTO ffwr_players (name, position, nfl_team, adp_rank, dynasty_rank, bye_week, draft_rank, draft_tier, upside, bust, sos, age, dynasty_tier)
         VALUES ${pRows.join(", ")}
         ON CONFLICT DO NOTHING`,
        pParams,
        { label: `Seed players batch ${Math.floor(c / CHUNK) + 1} (${chunk.length} players)` }
      );
    }

    // ── 5. Assign keepers (batched) ─────────────────────────────────
    const keeperAssignments: [string, string[]][] = [
      ["Tyler", ["Kyren Williams", "George Pickens", "Mike Evans", "Breece Hall"]],
      ["AJ", ["Jahmyr Gibbs", "Ja'Marr Chase", "Malik Nabers", "Marvin Harrison Jr"]],
      ["Brooke", ["Omarion Hampton", "James Cook III", "Chris Olave", "Emeka Egbuka"]],
      ["Drew", ["Bijan Robinson", "DK Metcalf", "DeVonta Smith", "Trey McBride"]],
      ["Chuck", ["Kenneth Walker III", "AJ Brown", "Tetairoa McMillan", "Colston Loveland"]],
      ["Carson", ["Jonathan Taylor", "De'Von Achane", "Drake London", "Garrett Wilson"]],
      ["Erik", ["Ashton Jeanty", "CeeDee Lamb", "Jalen Hurts", "Rashee Rice"]],
      ["Jordan", ["Christian McCaffrey", "Ladd McConkey", "Nico Collins", "Jaylen Waddle"]],
      ["Adam", ["Josh Allen", "Saquon Barkley", "Amon-Ra St. Brown", "Justin Jefferson"]],
      ["Jimmy", ["Chase Brown", "Jaxon Smith-Njigba", "Puka Nacua", "Brock Bowers"]],
      ["JT", ["Lamar Jackson", "Derrick Henry", "Zay Flowers", "Javonte Williams"]],
    ];

    // Batch keeper updates per team (11 queries instead of 44)
    for (const [mgr, playerNames] of keeperAssignments) {
      const teamId = teamByMgr[mgr];
      if (!teamId) continue;
      await ctx.integrations.apps_db.execute(
        `UPDATE ffwr_players
         SET is_keeper = true, keeper_team_id = $1, is_drafted = true, drafted_team_id = $1
         WHERE name = ANY($2::text[])`,
        [teamId, playerNames],
        { label: `Keepers → ${mgr} (${playerNames.length} players)` }
      );
    }

    // ── 6. Seed 121 draft picks (batched multi-row INSERT) ────────
    const draftOrder: string[][] = [
      ["Tyler", "Tyler", "AJ", "Brooke", "Drew", "Brooke", "Chuck", "Chuck", "Chuck", "Tyler", "Carson"],
      ["Erik", "Erik", "AJ", "Carson", "Jordan", "Brooke", "Drew", "Carson", "AJ", "Tyler", "Adam"],
      ["Adam", "Jordan", "AJ", "Jimmy", "Jimmy", "JT", "Chuck", "Chuck", "Chuck", "Tyler", "Jimmy"],
      ["Jimmy", "Erik", "Jimmy", "Tyler", "Erik", "Jimmy", "AJ", "Jimmy", "JT", "Tyler", "JT"],
      ["Adam", "Brooke", "Erik", "Jordan", "Chuck", "Brooke", "Carson", "Tyler", "AJ", "JT", "Jordan"],
      ["AJ", "Erik", "Adam", "Erik", "Jordan", "AJ", "Drew", "Drew", "AJ", "Tyler", "Erik"],
      ["JT", "Tyler", "Chuck", "Jimmy", "Carson", "Carson", "JT", "Carson", "AJ", "Drew", "Jordan"],
      ["Jordan", "Erik", "Jimmy", "Carson", "Brooke", "Adam", "Drew", "Jordan", "Jimmy", "Chuck", "Adam"],
      ["Adam", "Adam", "Brooke", "Jimmy", "Erik", "Brooke", "Chuck", "Jordan", "JT", "Erik", "Jordan"],
      ["Jordan", "Drew", "JT", "Carson", "Chuck", "Brooke", "Drew", "Brooke", "Adam", "Carson", "Adam"],
      ["Adam", "JT", "JT", "Drew", "Drew", "Brooke", "Drew", "Carson", "JT", "AJ", "Tyler"],
    ];

    // Build all pick rows and insert in one statement
    const pickRows: string[] = [];
    const pickParams: (number)[] = [];
    let overallPick = 1;
    let paramIdx = 1;
    for (let round = 0; round < draftOrder.length; round++) {
      for (let pick = 0; pick < draftOrder[round].length; pick++) {
        const mgr = draftOrder[round][pick];
        const teamId = teamByMgr[mgr];
        if (!teamId) continue;
        pickRows.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3})`);
        pickParams.push(round + 1, pick + 1, overallPick, teamId);
        paramIdx += 4;
        overallPick++;
      }
    }
    await ctx.integrations.apps_db.execute(
      `INSERT INTO ffwr_draft_picks (round, pick_in_round, overall_pick, team_id)
       VALUES ${pickRows.join(", ")}`,
      pickParams,
      { label: `Seed ${overallPick - 1} draft picks (batched)` }
    );

    // ── 7. Populate implied_team_points from 2026 Vegas projected PPG ──
    await ctx.integrations.apps_db.execute(
      `UPDATE ffwr_players SET implied_team_points = CASE nfl_team
        WHEN 'ARI' THEN 18.4 WHEN 'ATL' THEN 21.0 WHEN 'BAL' THEN 25.5
        WHEN 'BUF' THEN 26.0 WHEN 'CAR' THEN 21.5 WHEN 'CHI' THEN 24.0
        WHEN 'CIN' THEN 26.0 WHEN 'CLE' THEN 18.8 WHEN 'DAL' THEN 25.7
        WHEN 'DEN' THEN 22.0 WHEN 'DET' THEN 26.3 WHEN 'GB'  THEN 24.9
        WHEN 'HOU' THEN 22.5 WHEN 'IND' THEN 23.4 WHEN 'JAX' THEN 23.5
        WHEN 'KC'  THEN 24.0 WHEN 'LV'  THEN 19.1 WHEN 'LAC' THEN 23.5
        WHEN 'LAR' THEN 26.6 WHEN 'MIA' THEN 19.0 WHEN 'MIN' THEN 22.0
        WHEN 'NE'  THEN 23.5 WHEN 'NO'  THEN 21.0 WHEN 'NYG' THEN 21.5
        WHEN 'NYJ' THEN 18.6 WHEN 'PHI' THEN 24.0 WHEN 'PIT' THEN 21.0
        WHEN 'SF'  THEN 25.0 WHEN 'SEA' THEN 24.5 WHEN 'TB'  THEN 23.3
        WHEN 'TEN' THEN 20.5 WHEN 'WAS' THEN 23.5
        ELSE NULL END`,
      undefined,
      { label: "Set Vegas 2026 projected PPG" }
    );

    return {
      message: `C-Town Redux! Season XX initialized: ${teams.length} teams, ${playerSeeds.length} players, 44 keepers, ${overallPick - 1} draft picks. Vegas PPG applied.`,
    };
  },
});
