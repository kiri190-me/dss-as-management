import { test } from "node:test";
import assert from "node:assert/strict";
import { getFlowchartRetentionStatus, FLOWCHART_TRASH_RETENTION_DAYS } from "./repair-case-flowchart-retention";

test("at the moment of deletion, 15 whole days remain and it is not expired", () => {
  const deletedAt = "2026-08-01T00:00:00.000Z";
  const status = getFlowchartRetentionStatus(deletedAt, new Date(deletedAt));
  assert.equal(status.daysRemaining, FLOWCHART_TRASH_RETENTION_DAYS);
  assert.equal(status.isExpired, false);
  assert.equal(status.expiresAt, "2026-08-16T00:00:00.000Z");
});

test("14 days after deletion, 1 day remains", () => {
  const deletedAt = "2026-08-01T00:00:00.000Z";
  const now = new Date("2026-08-15T00:00:00.000Z");
  const status = getFlowchartRetentionStatus(deletedAt, now);
  assert.equal(status.daysRemaining, 1);
  assert.equal(status.isExpired, false);
});

test("exactly at the expiry instant, it is expired with 0 days remaining", () => {
  const deletedAt = "2026-08-01T00:00:00.000Z";
  const now = new Date("2026-08-16T00:00:00.000Z");
  const status = getFlowchartRetentionStatus(deletedAt, now);
  assert.equal(status.daysRemaining, 0);
  assert.equal(status.isExpired, true);
});

test("past expiry, daysRemaining goes negative but is never clamped (retention eligibility only, no purge here)", () => {
  const deletedAt = "2026-08-01T00:00:00.000Z";
  const now = new Date("2026-08-21T00:00:00.000Z");
  const status = getFlowchartRetentionStatus(deletedAt, now);
  assert.equal(status.daysRemaining, -5);
  assert.equal(status.isExpired, true);
});

test("a few hours before expiry still rounds up to 1 day remaining, not 0", () => {
  const deletedAt = "2026-08-01T00:00:00.000Z";
  const now = new Date("2026-08-15T18:00:00.000Z"); // 6 hours before the 15-day mark
  const status = getFlowchartRetentionStatus(deletedAt, now);
  assert.equal(status.daysRemaining, 1);
  assert.equal(status.isExpired, false);
});
