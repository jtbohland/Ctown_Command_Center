/**
 * Roster Completion Tracking
 * 
 * Determines pick status for color-coded mock draft board tiles:
 * - "starter"          → 📋 yellow (filling one of the 8 starting slots)
 * - "bench"            → 🪑 grey  (bench pick — starters complete or not)
 * - "completes_lineup" → 🏈 orange (the pick that fills all 8 starters)
 * - "team_done"        → ✅ green  (the team's very last pick — 11 total across board)
 * - "keeper"           → 📋 yellow (keeper pick — treated same as starter visually)
 *
 * Starting lineup: QB, WR, WR, RB, RB, TE, W/T (WR|TE), W/R (WR|RB) = 8 starters
 */

export type PickStatus = "keeper" | "starter" | "completes_lineup" | "bench" | "team_done";
export type TeamDraftStatus = {
  startersFilled: boolean;
  pickStatuses: Map<number, PickStatus>; // overallPick -> status
  desperationAlert: boolean; // needs a starter with ≤2 picks left
  missingPositions: string[]; // positions still needed for starters
  starterCount: number; // how many starting slots are filled (0-8)
};

/**
 * Check if a given set of positions can fill the 8 starting slots.
 * Returns { filled: boolean, count: number (slots filled 0-8), missing: string[] }
 */
export function checkStarterCompletion(positions: string[]): {
  filled: boolean;
  count: number;
  missing: string[];
} {
  let qb = 0, rb = 0, wr = 0, te = 0;
  for (const p of positions) {
    if (p === "QB") qb++;
    else if (p === "RB") rb++;
    else if (p === "WR") wr++;
    else if (p === "TE") te++;
  }

  const missing: string[] = [];
  let filled = 0;

  // Base slots: 1 QB, 2 WR, 2 RB, 1 TE
  const usedQB = Math.min(qb, 1);
  const usedRB = Math.min(rb, 2);
  const usedWR = Math.min(wr, 2);
  const usedTE = Math.min(te, 1);
  filled += usedQB + usedRB + usedWR + usedTE;

  if (usedQB < 1) missing.push("QB");
  if (usedRB < 2) { missing.push("RB"); if (usedRB < 1) missing.push("RB"); }
  if (usedWR < 2) { missing.push("WR"); if (usedWR < 1) missing.push("WR"); }
  if (usedTE < 1) missing.push("TE");

  // Remaining players available for flex
  const remRB = rb - usedRB;
  const remWR = wr - usedWR;
  const remTE = te - usedTE;

  // W/T flex (WR or TE)
  if (remWR + remTE >= 1) {
    filled++;
    // Prefer WR for W/T since WR is more common
    const usedForWT = remWR > 0 ? "WR" : "TE";
    const remWR2 = usedForWT === "WR" ? remWR - 1 : remWR;
    const remTE2 = usedForWT === "TE" ? remTE - 1 : remTE;

    // W/R flex (WR or RB)
    if (remWR2 + remRB >= 1) {
      filled++;
    } else {
      missing.push("W/R");
    }
  } else {
    missing.push("W/T");
    // Can't fill W/T, check W/R anyway
    if (remRB >= 1) {
      filled++;
    } else {
      missing.push("W/R");
    }
  }

  return { filled: filled >= 8, count: Math.min(filled, 8), missing };
}

/**
 * Determine if adding a specific position to the current roster
 * would fill a starter slot or go to bench.
 */
function isStarterPick(currentPositions: string[], newPosition: string): boolean {
  const before = checkStarterCompletion(currentPositions);
  const after = checkStarterCompletion([...currentPositions, newPosition]);
  return after.count > before.count;
}

/**
 * Compute roster completion status for a team given their picks in order.
 * 
 * @param keeperPositions - positions of the team's keepers
 * @param draftedInOrder - positions drafted IN ORDER (earliest pick first)
 * @param totalPicks - total picks this team has in the draft
 * @param picksRemaining - how many picks the team still has (for desperation calc)
 * @param keeperOverallPicks - overall pick numbers for keeper assignments (optional)
 */
export function computeTeamDraftStatus(
  keeperPositions: string[],
  draftedInOrder: Array<{ overallPick: number; position: string; isKeeper?: boolean }>,
  totalPicks: number,
  picksRemaining: number,
  keeperOverallPicks?: Set<number>,
): TeamDraftStatus {
  const pickStatuses = new Map<number, PickStatus>();
  let startersFilled = false;

  // Accumulate positions as picks come in (start with keeper positions)
  const accumulated = [...keeperPositions];

  // First pass: determine base statuses
  for (let i = 0; i < draftedInOrder.length; i++) {
    const { overallPick, position, isKeeper } = draftedInOrder[i];

    // Check if this is a keeper pick
    if (isKeeper || keeperOverallPicks?.has(overallPick)) {
      pickStatuses.set(overallPick, "keeper");
      accumulated.push(position);
      if (!startersFilled) {
        const check = checkStarterCompletion(accumulated);
        if (check.filled) startersFilled = true;
      }
      continue;
    }

    accumulated.push(position);

    if (!startersFilled) {
      const check = checkStarterCompletion(accumulated);
      if (check.filled) {
        startersFilled = true;
        pickStatuses.set(overallPick, "completes_lineup");
      } else {
        // Is this pick filling a starter slot or going to bench?
        const positionsBefore = accumulated.slice(0, -1);
        if (isStarterPick(positionsBefore, position)) {
          pickStatuses.set(overallPick, "starter");
        } else {
          pickStatuses.set(overallPick, "bench");
        }
      }
    } else {
      // Starters already filled — this is a bench pick
      pickStatuses.set(overallPick, "bench");
    }
  }

  // Second pass: mark the team's very last pick as "team_done"
  // Only if the team has used ALL their picks (no picks remaining)
  if (picksRemaining === 0 && draftedInOrder.length > 0) {
    const lastPick = draftedInOrder[draftedInOrder.length - 1];
    pickStatuses.set(lastPick.overallPick, "team_done");
  }

  // Current state check
  const currentCheck = checkStarterCompletion(accumulated);
  const desperationAlert = !currentCheck.filled && picksRemaining <= 2 && picksRemaining > 0;

  return {
    startersFilled: currentCheck.filled,
    pickStatuses,
    desperationAlert,
    missingPositions: currentCheck.missing,
    starterCount: currentCheck.count,
  };
}

/** Get the emoji for a pick status */
export function getPickStatusEmoji(status: PickStatus): string {
  switch (status) {
    case "keeper": return "📋";
    case "starter": return "📋";
    case "completes_lineup": return "🏈";
    case "bench": return "🪑";
    case "team_done": return "✅";
  }
}

/** Get the label for a pick status */
export function getPickStatusLabel(status: PickStatus): string {
  switch (status) {
    case "keeper": return "Keeper pick";
    case "starter": return "Starter slot";
    case "completes_lineup": return "Starting lineup complete!";
    case "bench": return "Bench";
    case "team_done": return "Draft complete";
  }
}

/** Get the Tailwind background class for a pick status tile */
export function getPickStatusTileClass(status: PickStatus | undefined): string {
  switch (status) {
    case "keeper": return "bg-yellow-500/15 border-yellow-500/30";
    case "starter": return "bg-yellow-500/15 border-yellow-500/30";
    case "completes_lineup": return "bg-orange-500/15 border-orange-500/30";
    case "bench": return "bg-zinc-500/15 border-zinc-500/30";
    case "team_done": return "bg-green-500/15 border-green-500/30";
    default: return "";
  }
}
