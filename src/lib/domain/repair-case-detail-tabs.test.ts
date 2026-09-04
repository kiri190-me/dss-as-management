import { test } from "node:test";
import assert from "node:assert/strict";
import { repairCaseDetailHrefs, resolveActiveTabHref } from "./repair-case-detail-tabs";

const CASE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const HREFS_BY_NAME = repairCaseDetailHrefs(CASE_ID);
// DetailTabs가 그리는 순서 그대로. 루트가 첫 번째여야 아래 "접두사" 테스트들의
// slice(1)이 나머지 여섯을 가리킨다.
const HREFS = [
  HREFS_BY_NAME.root,
  HREFS_BY_NAME.execution,
  HREFS_BY_NAME.diagnosis,
  HREFS_BY_NAME.workHistory,
  HREFS_BY_NAME.files,
  HREFS_BY_NAME.report,
  HREFS_BY_NAME.quotes,
  HREFS_BY_NAME.approval,
];

test("헬퍼가 만드는 주소는 실제 라우트 폴더와 하나씩 맞아떨어진다", () => {
  // 여기서만 문자열을 손으로 적는다. 라우트 폴더 이름이 바뀌었는데 헬퍼를 고치지
  // 않으면(또는 그 반대면) 여기서 걸린다.
  // src/app/(app)/repair-cases/[id]/ : page.tsx, execution, diagnosis,
  // work-history, files, approval, report, quotes
  assert.deepEqual(repairCaseDetailHrefs(CASE_ID), {
    root: `/repair-cases/${CASE_ID}`,
    execution: `/repair-cases/${CASE_ID}/execution`,
    diagnosis: `/repair-cases/${CASE_ID}/diagnosis`,
    workHistory: `/repair-cases/${CASE_ID}/work-history`,
    files: `/repair-cases/${CASE_ID}/files`,
    approval: `/repair-cases/${CASE_ID}/approval`,
    report: `/repair-cases/${CASE_ID}/report`,
    quotes: `/repair-cases/${CASE_ID}/quotes`,
  });
});

test("여덟 개 주소는 서로 다르다", () => {
  // 복사·붙여넣기로 두 키가 같은 곳을 가리키게 되면 탭 두 개가 동시에 활성으로
  // 보이고 한 화면에는 영영 못 간다.
  assert.equal(new Set(HREFS).size, 8);
});

test("루트가 나머지 일곱의 접두사다 — resolveActiveTabHref의 최장 일치 규칙이 필요한 이유", () => {
  // 이 성질이 깨지는 날은 상세 화면 주소 구조가 바뀐 날이다. 그때 최장 일치
  // 규칙을 다시 볼 수 있게 여기서 붙잡아 둔다.
  for (const href of HREFS.slice(1)) {
    assert.ok(href.startsWith(`${HREFS_BY_NAME.root}/`), `${href}가 루트 아래에 있지 않다`);
    assert.ok(href.length > HREFS_BY_NAME.root.length);
  }
});

test("exact match wins for every ordinary tab", () => {
  for (const href of HREFS) {
    assert.equal(resolveActiveTabHref(href, HREFS), href);
  }
});

test("the diagnosis tab stays active on its nested [flowchartId] child route", () => {
  const pathname = `${HREFS_BY_NAME.diagnosis}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb`;
  assert.equal(resolveActiveTabHref(pathname, HREFS), HREFS_BY_NAME.diagnosis);
});

test("기본 정보's root href never wins on a sibling tab's route, despite being a string prefix of every one of them", () => {
  for (const href of HREFS.slice(1)) {
    assert.notEqual(resolveActiveTabHref(href, HREFS), HREFS_BY_NAME.root);
  }
});

test("an unrecognized nested path under the case still falls back to the case-root tab (it genuinely is a prefix)", () => {
  assert.equal(resolveActiveTabHref(`${HREFS_BY_NAME.root}/nonexistent-tab`, HREFS), HREFS_BY_NAME.root);
});

test("a completely unrelated pathname matches no tab", () => {
  assert.equal(resolveActiveTabHref("/dashboard", HREFS), undefined);
});

/**
 * ── 견적서 탭 ───────────────────────────────────────────────────────────────
 * 이 탭은 다른 일곱과 두 가지가 다르다: 주소가 `/quotes` 로 끝나 **PO/내자
 * 목록(`/quotes`)과 글자가 겹치고**, 볼 권한이 없는 세션에는 아예 그려지지
 * 않는다. 둘 다 조용히 깨질 수 있는 자리라 여기서 붙잡아 둔다.
 */
test("🔴 견적서 탭 주소에서 루트(기본 정보) 탭이 활성이 되지 않는다", () => {
  assert.equal(resolveActiveTabHref(HREFS_BY_NAME.quotes, HREFS), HREFS_BY_NAME.quotes);
  assert.notEqual(resolveActiveTabHref(HREFS_BY_NAME.quotes, HREFS), HREFS_BY_NAME.root);
});

test("접수 건의 견적서 탭과 PO/내자 견적서 목록은 서로 다른 주소다", () => {
  // `/quotes` 는 왼쪽 메뉴의 목록이고, `/repair-cases/{id}/quotes` 는 이 건의
  // 탭이다. 한쪽이 다른 쪽의 접두사가 되면 안 된다.
  assert.notEqual(HREFS_BY_NAME.quotes, "/quotes");
  assert.equal(HREFS_BY_NAME.quotes.startsWith(`${HREFS_BY_NAME.root}/`), true);
});

test("견적서를 못 보는 세션(탭이 빠진 목록)에서도 나머지 탭의 판정은 그대로다", () => {
  // DetailTabs 는 권한이 없으면 이 탭을 **그리지 않는다** — 그때 활성 판정에
  // 넘어가는 목록에도 이 주소가 없다. 그 상태에서 형제 탭이 흔들리면 안 된다.
  const withoutQuotes = HREFS.filter((href) => href !== HREFS_BY_NAME.quotes);
  for (const href of withoutQuotes) {
    assert.equal(resolveActiveTabHref(href, withoutQuotes), href);
  }
  // 주소를 직접 친 경우에는 루트로 떨어진다(그냥 알 수 없는 하위 경로다).
  // 막는 것은 탭 줄이 아니라 그 페이지 자신이다.
  assert.equal(resolveActiveTabHref(HREFS_BY_NAME.quotes, withoutQuotes), HREFS_BY_NAME.root);
});
