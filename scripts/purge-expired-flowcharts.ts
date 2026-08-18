import "./load-env";

import { pgClient } from "../src/lib/db/connection";
import { runFlowchartPurgeSweep } from "../src/lib/db/mutations/repair-case-flowchart-purge";

/**
 * Manual/scheduled entry point for the automatic 15-day diagnosis-flowchart
 * purge. Not wired to any OS scheduler yet (Windows Task Scheduler setup is
 * a separate, later step) — this is the command that scheduler will
 * eventually invoke, and can already be run by hand via `npm run
 * purge:flowcharts`. Never touches page requests or an in-process timer —
 * CLI-only, matching this checkpoint's explicit design.
 */
async function main() {
  console.log("Running diagnosis-flowchart purge sweep...");
  const summary = await runFlowchartPurgeSweep();

  console.log(`  eligible: ${summary.eligible}`);
  console.log(`  purged: ${summary.purged}`);
  console.log(`  skipped (restored): ${summary.skippedRestored}`);
  console.log(`  skipped (not yet eligible): ${summary.skippedNotEligible}`);
  console.log(`  skipped (already gone): ${summary.skippedAlreadyGone}`);
  console.log(`  errored: ${summary.errored}`);

  if (summary.errored > 0) {
    console.error("Per-flowchart errors:");
    for (const { flowchartId, message } of summary.errors) {
      console.error(`  - ${flowchartId}: ${message}`);
    }
  }

  console.log("Purge sweep complete.");
  return summary;
}

main()
  .then(async (summary) => {
    await pgClient.end({ timeout: 5 });
    // Non-zero exit when any individual flowchart errored, even though the
    // sweep itself completed — lets a scheduler flag a degraded run without
    // needing to parse stdout.
    process.exit(summary.errored > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("Purge sweep failed:", err instanceof Error ? err.message : String(err));
    await pgClient.end({ timeout: 5 });
    process.exit(1);
  });
