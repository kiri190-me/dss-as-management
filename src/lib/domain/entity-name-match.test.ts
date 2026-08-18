import { test } from "node:test";
import assert from "node:assert/strict";
import { isExactNormalizedMatch, normalizeEntityName, rankSimilarNames } from "./entity-name-match";

test("normalizeEntityName trims, collapses internal whitespace, and lowercases", () => {
  assert.equal(normalizeEntityName("  Acme   Co  "), "acme co");
  assert.equal(normalizeEntityName("ACME CO"), "acme co");
  assert.equal(normalizeEntityName("acme co"), "acme co");
});

test("isExactNormalizedMatch treats whitespace/case variants as the same name", () => {
  assert.equal(isExactNormalizedMatch("Acme Co", "  acme   co "), true);
  assert.equal(isExactNormalizedMatch("Acme Co", "Acme Corp"), false);
});

test("rankSimilarNames: normalized-exact match sorts first", () => {
  const candidates = [{ id: "1", name: "Acme Corp" }, { id: "2", name: "acme co" }];
  const result = rankSimilarNames("Acme Co", candidates);
  assert.equal(result[0]?.id, "2");
});

test("rankSimilarNames: prefix matches rank above substring-only matches", () => {
  const candidates = [
    { id: "prefix", name: "Acme Electronics" },
    { id: "substring", name: "New Acme Group" },
  ];
  const result = rankSimilarNames("Acme", candidates);
  assert.equal(result[0]?.id, "prefix");
  assert.equal(result[1]?.id, "substring");
});

test("rankSimilarNames: excludes candidates that don't contain the query anywhere", () => {
  const candidates = [{ id: "1", name: "Acme Corp" }, { id: "2", name: "Globex Inc" }];
  const result = rankSimilarNames("acme", candidates);
  assert.equal(result.length, 1);
  assert.equal(result[0]?.id, "1");
});

test("rankSimilarNames: empty query returns every candidate, alphabetically", () => {
  const candidates = [{ id: "1", name: "Zeta" }, { id: "2", name: "Alpha" }];
  const result = rankSimilarNames("", candidates);
  assert.deepEqual(result.map((c) => c.id), ["2", "1"]);
});

test("rankSimilarNames: within a tier, shorter normalized names sort first", () => {
  const candidates = [
    { id: "long", name: "Acme Electronics Group" },
    { id: "short", name: "Acme Co" },
  ];
  const result = rankSimilarNames("Acme", candidates);
  assert.equal(result[0]?.id, "short");
  assert.equal(result[1]?.id, "long");
});
