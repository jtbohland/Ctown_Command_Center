/**
 * Valuation spec parity gate.
 *
 * The canonical valuation spec is mirrored into two files because the client
 * and server TypeScript projects cannot import each other:
 *
 *   server/lib/valuation/valuation-spec.ts
 *   client/lib/valuation/valuation-spec.ts
 *
 * Silent drift between them would mean the Exchange and the trade ledger price
 * the same asset differently — exactly the class of bug this gate exists to
 * prevent. This script fails loudly if the copies diverge.
 *
 * Two independent checks:
 *   1. Byte equality of the two source files.
 *   2. Runtime equality of each copy's independently computed
 *      VALUATION_SPEC_FINGERPRINT, which samples every curve in the spec (so a
 *      change to formula shape is caught even if named constants are untouched).
 *
 * Run:  npm run check   (or: npx tsx scripts/check-valuation-parity.ts)
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.cwd();
const SERVER_SPEC = path.join(ROOT, "server/lib/valuation/valuation-spec.ts");
const CLIENT_SPEC = path.join(ROOT, "client/lib/valuation/valuation-spec.ts");

function fail(message: string, detail?: string): never {
  console.error(`\n\u001b[31m\u2717 VALUATION PARITY CHECK FAILED\u001b[0m\n`);
  console.error(`  ${message}\n`);
  if (detail) console.error(`${detail}\n`);
  console.error(
    `  Fix: make the two mirrored copies identical again.\n` +
      `       cp server/lib/valuation/valuation-spec.ts client/lib/valuation/valuation-spec.ts\n` +
      `       (or the reverse, whichever copy holds the intended change)\n`,
  );
  process.exit(1);
}

function firstDifference(a: string, b: string): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      return (
        `  First difference at line ${i + 1}:\n` +
        `    server: ${aLines[i] === undefined ? "<missing>" : JSON.stringify(aLines[i])}\n` +
        `    client: ${bLines[i] === undefined ? "<missing>" : JSON.stringify(bLines[i])}`
      );
    }
  }
  return "  Files differ only in trailing bytes.";
}

// ── Check 1: byte equality ───────────────────────────────────────────────────

let serverSource: string;
let clientSource: string;

try {
  serverSource = readFileSync(SERVER_SPEC, "utf8");
} catch {
  fail(`Missing canonical spec: server/lib/valuation/valuation-spec.ts`);
}
try {
  clientSource = readFileSync(CLIENT_SPEC, "utf8");
} catch {
  fail(`Missing mirrored spec: client/lib/valuation/valuation-spec.ts`);
}

if (serverSource !== clientSource) {
  fail(
    "The mirrored valuation spec copies are not identical.",
    firstDifference(serverSource, clientSource),
  );
}

// ── Check 2: independently computed fingerprints ─────────────────────────────
//
// Built at runtime so TypeScript does not statically resolve across the
// client/server project boundary.

interface SpecModule {
  VALUATION_SPEC_FINGERPRINT: string;
  VALUATION_SPEC_VERSION: string;
}

async function loadSpec(absPath: string): Promise<SpecModule> {
  const specifier = pathToFileURL(absPath).href;
  return (await import(/* @vite-ignore */ specifier)) as SpecModule;
}

const serverSpec = await loadSpec(SERVER_SPEC);
const clientSpec = await loadSpec(CLIENT_SPEC);

if (serverSpec.VALUATION_SPEC_FINGERPRINT !== clientSpec.VALUATION_SPEC_FINGERPRINT) {
  fail(
    "The two spec copies computed different fingerprints.",
    `    server: ${serverSpec.VALUATION_SPEC_FINGERPRINT}\n` +
      `    client: ${clientSpec.VALUATION_SPEC_FINGERPRINT}`,
  );
}

console.log(
  `\u001b[32m\u2713\u001b[0m valuation spec parity OK ` +
    `(${serverSpec.VALUATION_SPEC_VERSION}, fingerprint ${serverSpec.VALUATION_SPEC_FINGERPRINT})`,
);
