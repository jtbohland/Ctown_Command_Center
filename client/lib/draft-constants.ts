export const TAG_OPTIONS = [
  { emoji: "🎯", label: "Get Your Guys", key: "target", points: 10 },
  { emoji: "💎", label: "Hidden Gems", key: "gem", points: 7 },
  { emoji: "🚀", label: "Breakouts", key: "breakout", points: 4 },
  { emoji: "📈", label: "Upside/Value", key: "upside", points: 3 },
  { emoji: "🔗", label: "Handcuffs", key: "handcuff", points: 2 },
  { emoji: "🌱", label: "Rookie", key: "rookie", points: 1 },
  { emoji: "🚫", label: "Avoid", key: "avoid", points: -10 },
  { emoji: "🏥", label: "Injured", key: "injured", points: 0 },
] as const;

export type TagKey = (typeof TAG_OPTIONS)[number]["key"];

export function getTagEmoji(key: string): string {
  return TAG_OPTIONS.find((t) => t.key === key)?.emoji ?? "🏷️";
}

export function getTagLabel(key: string): string {
  return TAG_OPTIONS.find((t) => t.key === key)?.label ?? key;
}

export const POSITION_COLORS: Record<string, string> = {
  QB: "var(--war-room-qb)",
  RB: "var(--war-room-rb)",
  WR: "var(--war-room-wr)",
  TE: "var(--war-room-te)",

};

export const POSITION_BG_CLASSES: Record<string, string> = {
  QB: "bg-war-room-qb/15 text-war-room-qb border-war-room-qb/30",
  RB: "bg-war-room-rb/15 text-war-room-rb border-war-room-rb/30",
  WR: "bg-war-room-wr/15 text-war-room-wr border-war-room-wr/30",
  TE: "bg-war-room-te/15 text-war-room-te border-war-room-te/30",

};

// Roster slot configuration — C-Town Redux! dynasty league
export const ROSTER_SLOTS = [
  { key: "QB", label: "QB", positions: ["QB"], count: 1 },
  { key: "WR1", label: "WR", positions: ["WR"], count: 1 },
  { key: "WR2", label: "WR", positions: ["WR"], count: 1 },
  { key: "RB1", label: "RB", positions: ["RB"], count: 1 },
  { key: "RB2", label: "RB", positions: ["RB"], count: 1 },
  { key: "TE", label: "TE", positions: ["TE"], count: 1 },
  { key: "WT", label: "W/T", positions: ["WR", "TE"], count: 1 },
  { key: "WR", label: "W/R", positions: ["WR", "RB"], count: 1 },
  { key: "BN1", label: "BN", positions: ["QB", "RB", "WR", "TE"], count: 1 },
  { key: "BN2", label: "BN", positions: ["QB", "RB", "WR", "TE"], count: 1 },
  { key: "BN3", label: "BN", positions: ["QB", "RB", "WR", "TE"], count: 1 },
  { key: "BN4", label: "BN", positions: ["QB", "RB", "WR", "TE"], count: 1 },
  { key: "BN5", label: "BN", positions: ["QB", "RB", "WR", "TE"], count: 1 },
  { key: "BN6", label: "BN", positions: ["QB", "RB", "WR", "TE"], count: 1 },
  { key: "BN7", label: "BN", positions: ["QB", "RB", "WR", "TE"], count: 1 },
  { key: "BN8", label: "BN", positions: ["QB", "RB", "WR", "TE"], count: 1 },
  { key: "IR", label: "IR", positions: ["QB", "RB", "WR", "TE"], count: 1 },
] as const;

// Starting roster slots only (excludes bench & IR)
export const STARTING_SLOTS = ROSTER_SLOTS.filter(
  (s) => !s.key.startsWith("BN") && s.key !== "IR"
);

export type Player = {
  id: number;
  name: string;
  position: string;
  nfl_team: string;
  adp_rank: number | null;
  dynasty_rank: number | null;
  positional_rank: number | null;
  implied_team_points: number | null;
  bye_week: number | null;
  // New ranking fields
  draft_rank: number | null;
  draft_tier: number | null;
  upside: string | null;
  bust: string | null;
  sos: string | null;
  age: number | null;
  dynasty_tier: number | null;
  // Keeper & draft state
  is_keeper: boolean;
  keeper_team_id: number | null;
  is_drafted: boolean;
  drafted_team_id: number | null;
  drafted_round: number | null;
  drafted_pick: number | null;
  tags: string | null;
  is_write_in?: boolean;
};

export type Team = {
  id: number;
  team_name: string;
  manager_name: string;
  color: string;
  secondary_color: string | null;
  logo_url: string | null;
  draft_position: number | null;
  is_my_team: boolean;
};

export type DraftPick = {
  id: number;
  round: number;
  pick_in_round: number;
  overall_pick: number;
  team_id: number;
  team_name: string;
  team_color: string;
  is_my_team: boolean;
  player_id: number | null;
  player_name: string | null;
  player_position: string | null;
  player_nfl_team: string | null;
  is_complete: boolean;
  is_write_in?: boolean;
};

// Team Emojis — app-wide display
export const TEAM_EMOJIS: Record<string, string> = {
  "Crabcakes": "🦀",
  "Boston": "🫖",
  "Mountain": "🏔️",
  "Davis": "🍆",
  "Rush": "🐲",
  "Smith": "🚬",
  "Rat Pack": "🐀",
  "Gym": "🏋🏻‍♂️",
  "McCartel": "🪇",
  "You Know": "🕛",
  "Teal": "🚙",
};

export function getTeamEmoji(teamName: string): string {
  for (const [key, emoji] of Object.entries(TEAM_EMOJIS)) {
    if (teamName.includes(key)) return emoji;
  }
  return "🏈";
}

export function getTeamDisplayName(teamName: string): string {
  return `${getTeamEmoji(teamName)} ${teamName}`;
}

// ─── Strength of Schedule (SOS) ─────────────────────────────
// Key: "TEAM_ABBR:POSITION" → SOS rating 1–5 (1 = toughest, 5 = easiest)
// Source: 2025 SOS projections by team & position group
const SOS_RAW: Record<string, number[]> = {
  // [QB, RB, WR, TE]
  ARI: [2, 2, 2, 2],
  ATL: [4, 2, 3, 3],
  BAL: [3, 3, 4, 4],
  BUF: [3, 2, 4, 3],
  CAR: [2, 1, 2, 2],
  CHI: [3, 2, 3, 2],
  CIN: [3, 2, 4, 3],
  CLE: [4, 3, 3, 3],
  DAL: [2, 4, 2, 2],
  DEN: [3, 2, 2, 4],
  DET: [5, 5, 4, 3],
  GB: [4, 4, 5, 2],
  HOU: [4, 4, 3, 4],
  IND: [4, 4, 4, 3],
  JAX: [4, 4, 4, 3],
  KC: [2, 3, 2, 4],
  LV: [1, 2, 2, 3],
  LAC: [2, 3, 2, 4],
  LAR: [3, 5, 1, 4],
  MIA: [3, 3, 3, 5],
  MIN: [5, 4, 5, 4],
  NE: [2, 2, 2, 4],
  NO: [3, 3, 3, 2],
  NYG: [4, 4, 4, 3],
  NYJ: [4, 3, 4, 4],
  PHI: [5, 4, 4, 4],
  PIT: [2, 2, 3, 2],
  SF: [1, 2, 2, 3],
  SEA: [4, 4, 3, 3],
  TB: [2, 2, 4, 2],
  TEN: [3, 3, 3, 3],
  WAS: [2, 4, 2, 1],
};

const POS_INDEX: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

/**
 * Get SOS rating (1–5) for a player based on their NFL team + position.
 * Returns null for K/DST or unknown teams.
 */
export function getPlayerSos(nflTeam: string, position: string): number | null {
  const idx = POS_INDEX[position];
  if (idx == null) return null;
  const row = SOS_RAW[nflTeam];
  if (!row) return null;
  return row[idx];
}

/**
 * SOS display labels
 */
export const SOS_LABELS: Record<number, string> = {
  1: "Brutal",
  2: "Hard",
  3: "Average",
  4: "Easy",
  5: "Cake",
};

// ─── Vegas Implied Team Points ──────────────────────────────
// Source: 2025 season-average projected points per game by team
// Higher = better offense for fantasy purposes
export const VEGAS_IMPLIED: Record<string, number> = {
  DET: 26.35,
  CIN: 26.03,
  BAL: 26.01,
  DAL: 25.79,
  LAR: 25.87,
  BUF: 25.71,
  SF: 25.28,
  SEA: 25.00,
  GB: 25.22,
  CHI: 24.56,
  KC: 24.50,
  PHI: 23.91,
  NE: 23.59,
  LAC: 23.56,
  TB: 23.34,
  IND: 23.28,
  WAS: 23.26,
  JAX: 23.18,
  HOU: 22.59,
  MIN: 22.53,
  DEN: 22.37,
  NYG: 21.94,
  ATL: 21.60,
  PIT: 21.60,
  NO: 21.63,
  CAR: 20.31,
  TEN: 20.74,
  LV: 19.28,
  MIA: 19.09,
  NYJ: 18.32,
  ARI: 18.56,
  CLE: 18.71,
};

// Min/max for bar scaling
const VEGAS_MIN = 18.0;
const VEGAS_MAX = 27.0;

/**
 * Get Vegas implied points for a player's team.
 * Returns null for unknown teams.
 */
export function getPlayerVegas(nflTeam: string): number | null {
  return VEGAS_IMPLIED[nflTeam] ?? null;
}

/**
 * Get a 0–1 fraction for bar rendering.
 */
export function getVegasFraction(points: number): number {
  return Math.max(0, Math.min(1, (points - VEGAS_MIN) / (VEGAS_MAX - VEGAS_MIN)));
}

/**
 * Get color class based on Vegas points tier.
 * Elite (25+) = green, Good (22-25) = amber, Weak (<22) = red
 */
export function getVegasColor(points: number): string {
  if (points >= 25) return "bg-emerald-500";
  if (points >= 22) return "bg-amber-500";
  return "bg-red-500";
}

export function getVegasTextColor(points: number): string {
  if (points >= 25) return "text-emerald-400";
  if (points >= 22) return "text-amber-400";
  return "text-red-400";
}

// ─── Rookie Overall Ratings ─────────────────────────────────
// Source: 2025 dynasty rookie rankings CSV (overall "X out of 5")
// Maps player name → star rating (1–5). Zero weight on formula, visual indicator only.
export const ROOKIE_STARS: Record<string, number> = {
  "Jeremiyah Love": 5,
  "Carnell Tate": 5,
  "Jordyn Tyson": 4,
  "Makai Lemon": 4,
  "KC Concepcion": 4,
  "Jadarian Price": 4,
  "Kenyon Sadiq": 4,
  "Omar Cooper Jr.": 4,
  "Fernando Mendoza": 4,
  "Eli Stowers": 4,
  "Denzel Boston": 4,
  "Jonah Coleman": 4,
  "Antonio Williams": 4,
  "Chris Bell": 4,
  "Nicholas Singleton": 2,
  "Germie Bernard": 3,
  "Emmett Johnson": 4,
  "De'Zhaun Stribling": 3,
  "Elijah Sarratt": 4,
  "Ted Hurst III": 4,
  "Kaytron Allen": 3,
  "Chris Brazzell II": 3,
  "Ty Simpson": 4,
  "Malachi Fields": 3,
  "Zachariah Branch": 3,
  "Oscar Delp": 4,
  "Demond Claiborne": 3,
  "Mike Washington Jr.": 4,
  "Eli Raridon": 4,
  "Kaelon Black": 3,
  "Skyler Bell": 4,
  "Ja'Kobi Lane": 4,
  "Max Klare": 4,
  "Adam Randall": 3,
  "Carson Beck": 3,
  "Bryce Lance": 4,
  "Eli Heidenreich": 3,
  "Kevin Coleman Jr.": 0,
  "Seth McGowan": 4,
  "Justin Joly": 4,
  "Brenen Thompson": 3,
  "Drew Allar": 2,
  "Cole Payton": 4,
  "Cade Klubnik": 3,
  "Jam Miller": 2,
  "Marlin Klein": 3,
  "Caleb Douglas": 3,
  "J'Mari Taylor": 2,
  "Sam Roush": 2,
  "Taylen Green": 3,
  "Tanner Koziol": 3,
  "Cyrus Allen": 3,
  "Zavion Thomas": 2,
  "Jaydn Ott": 2,
  "Garrett Nussmeier": 2,
  "Roman Hemby": 1,
  "Deion Burks": 3,
  "Robert Henry Jr.": 2,
  "CJ Daniels": 3,
  "Reggie Virgil": 2,
  "Barion Brown": 3,
  "Malik Benson": 2,
  "Nate Boerkircher": 2,
  "Dean Connors": 3,
  "Jack Endries": 2,
  "Noah Whittington": 1,
  "Josh Cameron": 2,
  "Colbie Young": 3,
  "Matt Hibner": 4,
  "Jeff Caldwell": 3,
  "Kendrick Law": 2,
  "Terion Stewart": 2,
  "Desmond Reid": 1,
  "Michael Trigg": 2,
  "Eric Rivers Jr.": 3,
  "CJ Donaldson": 1,
  "Chip Trayanum": 1,
  "Joe Royer": 2,
  "Lewis Bond": 2,
  "Jamal Haynes": 1,
  "Tyren Montgomery": 2,
  "Eric McAlister": 2,
  "Aaron Anderson": 2,
  "Kaden Wetjen": 3,
  "John Michael Gyllenborg": 1,
  "Josh Cuevas": 1,
  "Rahsul Faison": 2,
  "Diego Pavia": 1,
  "Brendan Sorsby": 3,
  "Dane Key": 2,
  "J. Michael Sturdivant": 2,
  "Riley Nowakowski": 4,
  "Trebor Pena": 2,
  "Dae'Quan Wright": 2,
  "TJ Harden": 1,
  "Haynes King": 3,
  "Max Bredeson": 1,
  "Harrison Wallace III": 1,
  "Will Kacmarek": 2,
  "Dallen Bentley": 1,
  "Joey Aguilar": 2,
  "Noah Thomas": 1,
  "Chase Roberts": 2,
  "Luke Altmyer": 1,
  "Jalon Daniels": 1,
  "Joe Fagnano": 1,
  "Emmanuel Henderson Jr.": 1,
  "Seydou Traore": 3,
  "Kentrel Bullock": 1,
  "Sawyer Robertson": 1,
  "Miller Moss": 1,
  "Jaren Kanak": 2,
  "Jack Velling": 0,
  "Rueben Owens II": 2,
  "Athan Kaliakmanis": 1,
  "Caullin Lacy": 1,
  "Behren Morton": 1,
  "Vinny Anthony II": 1,
  "Al-Jay Henderson": 4,
};

/**
 * Get rookie star rating for a player (1–5), or null if not a rookie.
 * Stars with 0 value are excluded (no data / dash in CSV).
 */
export function getRookieStars(playerName: string): number | null {
  const stars = ROOKIE_STARS[playerName];
  if (stars == null || stars === 0) return null;
  return stars;
}

/**
 * Render star string for a rookie: "⭐⭐⭐⭐⭐" for 5, etc.
 */
export function getRookieStarDisplay(playerName: string): string | null {
  const stars = getRookieStars(playerName);
  if (stars == null) return null;
  return "⭐".repeat(stars);
}

// ─── Keeper Window — Dynasty shelf-life tiers ──────────────

export type KeeperWindow = {
  tier: "long" | "closing" | "short";
  emoji: string;
  label: string;
  colorClass: string;
  bgClass: string;
  points: number;
};

const LONG: Omit<KeeperWindow, "points"> = {
  tier: "long",
  emoji: "🪟",
  label: "Long Window",
  colorClass: "text-emerald-400",
  bgClass: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400",
};
const CLOSING: Omit<KeeperWindow, "points"> = {
  tier: "closing",
  emoji: "🖼️",
  label: "Closing Window",
  colorClass: "text-amber-400",
  bgClass: "bg-amber-500/15 border-amber-500/30 text-amber-400",
};
const SHORT: Omit<KeeperWindow, "points"> = {
  tier: "short",
  emoji: "🚪",
  label: "Short Window",
  colorClass: "text-red-400",
  bgClass: "bg-red-500/15 border-red-500/30 text-red-400",
};

/**
 * Determine keeper window tier + scoring points based on position and age.
 *
 * RB ages fastest:  ≤24 Long (8pts), 25-27 Closing (3pts), 28+ Short (0pts)
 * WR has wider peak: ≤26 Long (8pts), 27-29 Closing (2pts), 30+ Short (0pts)
 * QB/TE are age-stable: always Long Window (5pts)
 *
 * Returns null if age is unknown (no badge, no points).
 */
export function getKeeperWindow(position: string, age: number | null): KeeperWindow | null {
  if (age == null) return null;

  if (position === "QB" || position === "TE") {
    return { ...LONG, points: 5 };
  }

  if (position === "RB") {
    if (age <= 24) return { ...LONG, points: 8 };
    if (age <= 27) return { ...CLOSING, points: 3 };
    return { ...SHORT, points: 0 };
  }

  if (position === "WR") {
    if (age <= 26) return { ...LONG, points: 8 };
    if (age <= 29) return { ...CLOSING, points: 2 };
    return { ...SHORT, points: 0 };
  }

  return null;
}

// League metadata
export const LEAGUE = {
  name: "C-Town Redux!",
  season: "XX",
  est: 2006,
  teamCount: 11,
  rounds: 11,
  keepersPerTeam: 4,
} as const;

// Manager-to-team mapping
export const TEAMS_DATA = [
  { name: "Crabcakes & Football", manager: "JT", color: "#1e3a5f", isMyTeam: true },
  { name: "Boston TD Party", manager: "Tyler", color: "#c41e3a" },
  { name: "Davis D", manager: "Brooke", color: "#6b4c9a" },
  { name: "Gym Rats", manager: "Carson", color: "#2d7d46" },
  { name: "Mountain Dude", manager: "AJ", color: "#5d8aa8" },
  { name: "Rat Pack", manager: "Adam", color: "#d4a843", champion: true },
  { name: "Rush Hour", manager: "Drew", color: "#e87722" },
  { name: "Teal Titans", manager: "Erik", color: "#008080" },
  { name: "The McCartel", manager: "Jimmy", color: "#8b0000" },
  { name: "The Smith Football Team", manager: "Chuck", color: "#4a6741" },
  { name: "You Know 12 Out Here!", manager: "Jordan", color: "#1c5ba0" },
] as const;
