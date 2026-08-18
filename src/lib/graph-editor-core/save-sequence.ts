/**
 * Generic graph-editor-core — sequential save-step execution (5C-6D-1A).
 * Domain-free: no React, no DB, no repair-case/procedure-template concept,
 * no opinion on what a "step" or a "token" is. Extracted from the Repair
 * Case Flowchart domain's own `runSaveSequence` (repair-case-flowchart-
 * editor-save-state.ts) — that module's `planSaveSteps` (what a pending
 * change is, how steps are ordered, how each step is constructed) and its
 * post-outcome id-reconciliation (`fullySucceededNodeIds` etc.) remain
 * there, entirely domain-specific; this module is only the sequencing loop
 * those functions feed into and read the result of.
 *
 * A future Procedure editor save-state adapter is expected to use this
 * exact same primitive with its own step union and its own token type
 * (both domains currently use a string `updatedAt`, but nothing here
 * assumes that).
 */

export type SaveStepResult<TToken> = { ok: true; token: TToken } | { ok: false; message: string };

export type SaveSequenceOutcome<TStep, TToken> = {
  succeededSteps: TStep[];
  failedAtStep: TStep | null;
  failureMessage: string | null;
  /** The latest token actually confirmed by a successful step — equals `initialToken` if nothing succeeded yet, whether the sequence never started, failed on its first step, or was empty. */
  finalToken: TToken;
};

/**
 * Runs `steps` strictly in order, feeding each successful step's returned
 * token into the next step's `expectedToken` argument — never invokes
 * `executeStep` for two steps concurrently, and never reuses a token a
 * later successful step has already superseded. Stops at the FIRST
 * failure: every step from that point on is left un-run, and this
 * function never inspects, mutates, or clears anything about `steps`
 * itself or any caller-owned state — that is entirely the domain-specific
 * planner/caller's responsibility (e.g. which pending-draft map entries to
 * delete). An empty `steps` array succeeds immediately with an empty
 * `succeededSteps` and `finalToken === initialToken`.
 */
export async function runSaveSequence<TStep, TToken>(
  steps: TStep[],
  initialToken: TToken,
  executeStep: (step: TStep, expectedToken: TToken) => Promise<SaveStepResult<TToken>>
): Promise<SaveSequenceOutcome<TStep, TToken>> {
  let token = initialToken;
  const succeededSteps: TStep[] = [];
  for (const step of steps) {
    const result = await executeStep(step, token);
    if (!result.ok) {
      return { succeededSteps, failedAtStep: step, failureMessage: result.message, finalToken: token };
    }
    token = result.token;
    succeededSteps.push(step);
  }
  return { succeededSteps, failedAtStep: null, failureMessage: null, finalToken: token };
}
