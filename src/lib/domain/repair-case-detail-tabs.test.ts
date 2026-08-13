import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveActiveTabHref } from "./repair-case-detail-tabs";

const CASE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const HREFS = [
  `/repair-cases/${CASE_ID}`,
  `/repair-cases/${CASE_ID}/execution`,
  `/repair-cases/${CASE_ID}/diagnosis`,
  `/repair-cases/${CASE_ID}/work-history`,
  `/repair-cases/${CASE_ID}/files`,
  `/repair-cases/${CASE_ID}/approval`,
  `/repair-cases/${CASE_ID}/report`,
];

test("exact match wins for every ordinary tab", () => {
  for (const href of HREFS) {
    assert.equal(resolveActiveTabHref(href, HREFS), href);
  }
});

test("the diagnosis tab stays active on its nested [flowchartId] child route", () => {
  const pathname = `/repair-cases/${CASE_ID}/diagnosis/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`;
  assert.equal(resolveActiveTabHref(pathname, HREFS), `/repair-cases/${CASE_ID}/diagnosis`);
});

test("기본 정보's root href never wins on a sibling tab's route, despite being a string prefix of every one of them", () => {
  for (const href of HREFS.slice(1)) {
    assert.notEqual(resolveActiveTabHref(href, HREFS), `/repair-cases/${CASE_ID}`);
  }
});

test("an unrecognized nested path under the case still falls back to the case-root tab (it genuinely is a prefix)", () => {
  assert.equal(resolveActiveTabHref(`/repair-cases/${CASE_ID}/nonexistent-tab`, HREFS), `/repair-cases/${CASE_ID}`);
});

test("a completely unrelated pathname matches no tab", () => {
  assert.equal(resolveActiveTabHref("/dashboard", HREFS), undefined);
});
