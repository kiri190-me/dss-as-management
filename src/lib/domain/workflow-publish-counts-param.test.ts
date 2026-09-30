import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  MAX_PUBLISH_CASE_COUNT,
  workflowPublishCaseSentences,
  workflowPublishCaseSentencesFromParams,
  workflowPublishCountFromParam,
  workflowPublishDoneHref,
} from "./workflow-publish-counts-param";

/** 도착 화면이 실제로 그리는 한 줄 — 고정 문구 + 건수 문장. */
const FIXED = "초안을 발행했습니다. 아래 버전 이력에서 새 버전이 '현재'인지 확인하세요.";
function screenLine(params: { moved?: string | string[]; stranded?: string | string[] }): string {
  return [FIXED, ...workflowPublishCaseSentencesFromParams(params)].join(" ");
}

test("발행 편집기가 만드는 주소 — 말할 건수만 싣는다", () => {
  assert.equal(
    workflowPublishDoneHref("REPAIR", { migrated: 34, stranded: 2 }),
    "/workflows/REPAIR?done=published&moved=34&stranded=2"
  );
  assert.equal(
    workflowPublishDoneHref("REPAIR", { migrated: 34, stranded: 0 }),
    "/workflows/REPAIR?done=published&moved=34"
  );
  assert.equal(
    workflowPublishDoneHref("REPAIR", { migrated: 0, stranded: 2 }),
    "/workflows/REPAIR?done=published&stranded=2"
  );
  // 옮긴 것도 남은 것도 없으면 예전과 똑같은 주소다 — 새 장치를 덧붙인 것이 아니라
  // 이미 쓰던 `?done=published` 를 넓힌 것이다.
  assert.equal(workflowPublishDoneHref("REPAIR", { migrated: 0, stranded: 0 }), "/workflows/REPAIR?done=published");
  assert.equal(
    workflowPublishDoneHref("REPAIR", { migrated: null, stranded: undefined }),
    "/workflows/REPAIR?done=published"
  );
});

test("도착 화면의 문장 — 옮김만 · 둘 다 · 아무것도 없음", () => {
  assert.equal(
    screenLine({ moved: "34", stranded: "2" }),
    `${FIXED} 진행 중인 접수 건 34건을 새 버전으로 옮겼습니다. 현재 단계가 새 버전에 없는 2건은 이전 버전에 그대로 두었습니다.`
  );
  assert.equal(screenLine({ moved: "34" }), `${FIXED} 진행 중인 접수 건 34건을 새 버전으로 옮겼습니다.`);
  assert.equal(
    screenLine({ stranded: "2" }),
    `${FIXED} 현재 단계가 새 버전에 없는 2건은 이전 버전에 그대로 두었습니다.`
  );
  assert.equal(screenLine({}), FIXED);
});

test("⚠️ 0건은 말하지 않는다 — 옮길 것이 없었다는 뜻이라 문장만 길어진다", () => {
  assert.deepEqual(workflowPublishCaseSentences({ migrated: 0, stranded: 0 }), []);
  assert.equal(screenLine({ moved: "0", stranded: "0" }), FIXED);
  assert.equal(screenLine({ moved: "0", stranded: "2" }), `${FIXED} 현재 단계가 새 버전에 없는 2건은 이전 버전에 그대로 두었습니다.`);
});

test("🔴 주소창에 손으로 친 값은 통과하지 못한다 — 음수·글자·소수·공백·지수", () => {
  for (const bad of ["-3", "abc", "3.5", " 5", "5 ", "1e3", "0x10", "+5", "", "٣", "34건", "34,5"]) {
    assert.equal(workflowPublishCountFromParam(bad), null, bad);
  }
});

test("🔴 터무니없이 큰 값도 걸러낸다", () => {
  assert.equal(workflowPublishCountFromParam("99999999999"), null);
  assert.equal(workflowPublishCountFromParam(String(MAX_PUBLISH_CASE_COUNT + 1)), null);
  assert.equal(workflowPublishCountFromParam(String(MAX_PUBLISH_CASE_COUNT)), MAX_PUBLISH_CASE_COUNT);
  assert.equal(workflowPublishCountFromParam("1"), 1);
});

test("값이 여러 개 와도 터지지 않는다 — 어느 쪽을 고를 근거가 없어 버린다", () => {
  assert.equal(workflowPublishCountFromParam(["1", "2"]), null);
  assert.equal(workflowPublishCountFromParam([]), null);
  assert.equal(workflowPublishCountFromParam(undefined), null);
  assert.equal(workflowPublishCountFromParam(null), null);
});

test("🔴 이상한 값이 와도 고정 문구는 그대로 나온다 — 오류를 띄우지 않는다", () => {
  for (const bad of ["-3", "abc", "99999999999", "3.5", ""]) {
    assert.equal(screenLine({ moved: bad, stranded: bad }), FIXED, bad);
    // 한쪽만 이상해도 멀쩡한 쪽은 살아 남는다.
    assert.equal(screenLine({ moved: bad, stranded: "2" }), `${FIXED} 현재 단계가 새 버전에 없는 2건은 이전 버전에 그대로 두었습니다.`, bad);
  }
  assert.equal(screenLine({ moved: ["34", "99"], stranded: ["2"] }), FIXED);
});

test("🔴 건수 문장이 한 곳에만 있다 — 서버 액션과 도착 화면이 같은 함수를 부른다", () => {
  const action = readFileSync(join(process.cwd(), "src/lib/server/actions/workflow-drafts.ts"), "utf8");
  const page = readFileSync(join(process.cwd(), "src/app/(app)/workflows/[code]/page.tsx"), "utf8");
  assert.match(action, /workflowPublishCaseSentences\(/);
  assert.match(page, /workflowPublishCaseSentencesFromParams\(search\)/);
  // 문장을 베껴 적은 곳이 없어야 한다 — 한쪽만 고쳐지면 화면마다 다른 말을 한다.
  for (const [name, source] of [
    ["action", action],
    ["page", page],
    ["editor", readFileSync(join(process.cwd(), "src/components/workflows/WorkflowDraftEditor.tsx"), "utf8")],
  ] as const) {
    assert.doesNotMatch(source, /새 버전으로 옮겼습니다/, name);
    assert.doesNotMatch(source, /이전 버전에 그대로 두었습니다/, name);
  }
});

test("🔴 발행 액션이 숫자를 그대로 돌려준다 — 화면이 문자열에서 뽑아내지 않는다", () => {
  const action = readFileSync(join(process.cwd(), "src/lib/server/actions/workflow-drafts.ts"), "utf8");
  assert.match(action, /migratedCaseCount: result\.migratedCaseCount/);
  assert.match(action, /strandedCaseCount: result\.strandedCaseCount/);
  const editor = readFileSync(join(process.cwd(), "src/components/workflows/WorkflowDraftEditor.tsx"), "utf8");
  assert.match(editor, /migrated: result\.ok \? result\.migratedCaseCount : null/);
  assert.match(editor, /stranded: result\.ok \? result\.strandedCaseCount : null/);
});
