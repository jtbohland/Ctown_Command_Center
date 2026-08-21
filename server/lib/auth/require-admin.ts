/**
 * Centralized write authorization for C-Town WarRoom.
 *
 * Phase 4 (write safety) requires that EVERY mutating endpoint verifies the
 * caller before touching the database. Authorization is derived from
 * `ctx.user`, which the Superblocks runtime populates server-side from the
 * signed JWT. It is NOT derived from any client-supplied input, so it cannot
 * be spoofed by the frontend.
 *
 * Usage — call as the FIRST statement in `run()`, before any query/execute:
 *
 *   import { requireAdmin } from "../../lib/auth/require-admin.js";
 *
 *   async run(ctx, input) {
 *     requireAdmin(ctx, "save a trade");
 *     ...
 *   }
 */

/** Commissioner accounts permitted to perform writes. */
export const ADMIN_EMAILS: readonly string[] = ["jt.bohland@amplitude.com"];

/**
 * Thrown when a caller is not permitted to perform a mutating action.
 *
 * Distinct from a generic Error so callers and tests can tell an authorization
 * refusal apart from a genuine failure. Endpoints must let this propagate —
 * never swallow it and return an empty-success response.
 */
export class AuthorizationError extends Error {
  readonly code = "UNAUTHORIZED" as const;
  /** The action that was refused, e.g. "save a trade". */
  readonly action: string;
  /** Email of the caller that was refused, or null when unauthenticated. */
  readonly actorEmail: string | null;

  constructor(action: string, actorEmail: string | null) {
    super(
      actorEmail
        ? `Not authorized to ${action}. Only the commissioner can perform this action (signed in as ${actorEmail}).`
        : `Not authorized to ${action}. You must be signed in as the commissioner to perform this action.`
    );
    this.name = "AuthorizationError";
    this.action = action;
    this.actorEmail = actorEmail;
  }
}

/**
 * Minimal shape of the runtime-provided user context.
 * Kept structural so this helper does not couple to a specific SDK version.
 */
export interface AuthContext {
  user?: { email?: string | null } | null;
}

/** Normalized email of the current caller, or null when unauthenticated. */
export function actorEmail(ctx: AuthContext): string | null {
  const email = ctx.user?.email;
  return typeof email === "string" && email.length > 0 ? email.toLowerCase() : null;
}

/** True when the current caller is a commissioner. */
export function isAdmin(ctx: AuthContext): boolean {
  const email = actorEmail(ctx);
  if (email == null) return false;
  return ADMIN_EMAILS.some((allowed) => allowed.toLowerCase() === email);
}

/**
 * Assert the caller is a commissioner, or throw AuthorizationError.
 *
 * @param action Human-readable description of the attempted write, used in the
 *               error message shown to the user (e.g. "upload ADP data").
 * @returns The verified admin's email, for attribution on audit columns.
 */
export function requireAdmin(ctx: AuthContext, action: string): string {
  const email = actorEmail(ctx);
  if (email == null || !ADMIN_EMAILS.some((allowed) => allowed.toLowerCase() === email)) {
    throw new AuthorizationError(action, email);
  }
  return email;
}
