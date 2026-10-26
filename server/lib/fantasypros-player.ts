/**
 * Shared parser for the FantasyPros PPR leaderboard "PLAYER" cell.
 *
 * FantasyPros has shipped two formats:
 *   Old: "Christian McCaffrey   CAR"  (2+ spaces before team)
 *   New: "Christian McCaffrey CAR"    (single space before team)
 *
 * We only strip a trailing token when it is an exact, case-sensitive NFL team
 * code, so suffixes like "II", "III", "Jr." are never mistaken for teams:
 *   "Patrick Mahomes II KC"     → { name: "Patrick Mahomes II", team: "KC" }
 *   "Kenneth Walker III SEA"    → { name: "Kenneth Walker III", team: "SEA" }
 *   "Marvin Harrison Jr. ARI"   → { name: "Marvin Harrison Jr.", team: "ARI" }
 */
export const FANTASYPROS_TEAM_CODES = new Set([
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAC", "JAX",
  "KC", "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO",
  "NYG", "NYJ", "OAK", "PHI", "PIT", "SEA", "SF", "TB",
  "TEN", "WAS", "WSH", "FA",
]);

export function parseFantasyProsPlayer(raw: string): { name: string; team: string } {
  const cleaned = raw.replace(/^"|"$/g, "").trim();

  // Old format: name and team separated by 2+ spaces
  const parts = cleaned.split(/\s{2,}/);
  if (parts.length >= 2) {
    return { name: parts[0].trim(), team: parts[parts.length - 1].trim() };
  }

  // New format: trailing single-space team code
  const match = cleaned.match(/^(.*\S)\s+([A-Z]{2,3})$/);
  if (match && FANTASYPROS_TEAM_CODES.has(match[2])) {
    return { name: match[1].trim(), team: match[2] };
  }

  return { name: cleaned, team: "" };
}
