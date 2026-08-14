/**
 * NFL Teams with 2025 bye weeks.
 * Update bye weeks each season from the official NFL schedule.
 */
export const NFL_TEAMS: { abbr: string; name: string; bye: number }[] = [
  { abbr: "ARI", name: "Arizona Cardinals", bye: 11 },
  { abbr: "ATL", name: "Atlanta Falcons", bye: 12 },
  { abbr: "BAL", name: "Baltimore Ravens", bye: 14 },
  { abbr: "BUF", name: "Buffalo Bills", bye: 12 },
  { abbr: "CAR", name: "Carolina Panthers", bye: 7 },
  { abbr: "CHI", name: "Chicago Bears", bye: 7 },
  { abbr: "CIN", name: "Cincinnati Bengals", bye: 5 },
  { abbr: "CLE", name: "Cleveland Browns", bye: 9 },
  { abbr: "DAL", name: "Dallas Cowboys", bye: 7 },
  { abbr: "DEN", name: "Denver Broncos", bye: 14 },
  { abbr: "DET", name: "Detroit Lions", bye: 5 },
  { abbr: "GB", name: "Green Bay Packers", bye: 10 },
  { abbr: "HOU", name: "Houston Texans", bye: 14 },
  { abbr: "IND", name: "Indianapolis Colts", bye: 14 },
  { abbr: "JAX", name: "Jacksonville Jaguars", bye: 12 },
  { abbr: "KC", name: "Kansas City Chiefs", bye: 6 },
  { abbr: "LV", name: "Las Vegas Raiders", bye: 10 },
  { abbr: "LAC", name: "Los Angeles Chargers", bye: 5 },
  { abbr: "LAR", name: "Los Angeles Rams", bye: 6 },
  { abbr: "MIA", name: "Miami Dolphins", bye: 6 },
  { abbr: "MIN", name: "Minnesota Vikings", bye: 9 },
  { abbr: "NE", name: "New England Patriots", bye: 14 },
  { abbr: "NO", name: "New Orleans Saints", bye: 12 },
  { abbr: "NYG", name: "New York Giants", bye: 9 },
  { abbr: "NYJ", name: "New York Jets", bye: 10 },
  { abbr: "PHI", name: "Philadelphia Eagles", bye: 5 },
  { abbr: "PIT", name: "Pittsburgh Steelers", bye: 9 },
  { abbr: "SF", name: "San Francisco 49ers", bye: 6 },
  { abbr: "SEA", name: "Seattle Seahawks", bye: 11 },
  { abbr: "TB", name: "Tampa Bay Buccaneers", bye: 11 },
  { abbr: "TEN", name: "Tennessee Titans", bye: 11 },
  { abbr: "WAS", name: "Washington Commanders", bye: 10 },
];

/** Look up bye week by team abbreviation */
export function getByeWeek(abbr: string): number | null {
  return NFL_TEAMS.find((t) => t.abbr === abbr)?.bye ?? null;
}
