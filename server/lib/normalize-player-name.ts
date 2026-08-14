/**
 * Canonical player name normalizer — ONE function used by ALL upload APIs.
 *
 * Ensures that "C.J. Stroud", "CJ Stroud", "Chris Rodriguez Jr.",
 * "Chris Rodriguez Jr", and "Amon-Ra St. Brown" all resolve to the
 * same stored name so ON CONFLICT (name, position) never creates ghosts.
 *
 * Rules:
 * 1. Strip all periods        "A.J. Brown" → "AJ Brown"
 * 2. Collapse whitespace       "De'Von  Achane" → "De'Von Achane"
 * 3. Trim leading/trailing     "  Josh Jacobs " → "Josh Jacobs"
 *
 * Deliberately does NOT lowercase — we store display-ready names.
 * Deliberately does NOT strip apostrophes — "Ja'Marr" is correct.
 * Deliberately does NOT strip suffixes — "Jr", "III" are kept for display.
 */
export function normalizePlayerName(raw: string): string {
  return raw
    .replace(/\./g, "")      // strip all periods
    .replace(/\s+/g, " ")    // collapse whitespace
    .trim();
}
