import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

function integrationTestFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...integrationTestFiles(path));
    else if (entry.name.endsWith(".integration.test.ts")) files.push(path);
  }
  return files;
}

const sources = integrationTestFiles(join(process.cwd(), "src"))
  .map((file) => ({ file, source: readFileSync(file, "utf8") }));

test("integration cleanup never constructs an unscoped where(undefined)", () => {
  const offenders = sources.filter(({ source }) =>
    /\.where\(\s*undefined\s*\)/.test(source) || /\?\s*undefined\s*:\s*undefined/.test(source)
  );
  assert.deepEqual(offenders.map(({ file }) => file), []);
});

test("known catastrophic cleanup forms cannot return", () => {
  const forbidden = [
    /delete\(repairCaseIdempotencyKeys\)(?:(?!;)[\s\S])*?\.where\(eq\(repairCaseIdempotencyKeys\.requesterUserId/,
    /delete\(auditLogs\)(?:(?!;)[\s\S])*?\.where\(eq\(auditLogs\.targetRecordId/,
    /delete\(auditLogs\)(?:(?!;)[\s\S])*?\.where\(inArray\(auditLogs\.targetRecordId/,
  ];
  const offenders = sources.filter(({ source }) => forbidden.some((pattern) => pattern.test(source)));
  assert.deepEqual(offenders.map(({ file }) => file), []);
});
