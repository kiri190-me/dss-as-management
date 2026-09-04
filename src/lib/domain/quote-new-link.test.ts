import { test } from "node:test";
import assert from "node:assert/strict";

import {
  newQuoteHrefForRepairCase,
  parseNewQuoteLink,
  returnHrefForNewQuote,
} from "./quote-new-link";
import { repairCaseDetailHrefs } from "./repair-case-detail-tabs";

const CASE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INTAKE_NUMBER = "D260706";

/** 주소를 만든 뒤 다시 읽는다 — 실제로 브라우저가 하는 일 그대로. */
function roundTrip(href: string) {
  const query = new URL(href, "https://example.invalid").searchParams;
  return parseNewQuoteLink(Object.fromEntries(query.entries()));
}

test("🔴 새 견적서 링크는 인수번호를 나른다 — 폼이 기존 「불러오기」 길을 그대로 타게", () => {
  // 이 값이 빠지면 폼은 빈 채로 열리고, 저장된 견적서에 repairCaseId 가 붙지
  // 않아 그 건의 탭에서 영영 보이지 않는다.
  const link = roundTrip(newQuoteHrefForRepairCase({ repairCaseId: CASE_ID, intakeNumber: INTAKE_NUMBER }));
  assert.equal(link.intakeNumber, INTAKE_NUMBER);
});

test("🔴 링크는 돌아갈 접수 건도 나른다 — 저장 뒤 그 건의 견적서 탭으로 돌아간다", () => {
  const link = roundTrip(newQuoteHrefForRepairCase({ repairCaseId: CASE_ID, intakeNumber: INTAKE_NUMBER }));
  assert.equal(link.repairCaseId, CASE_ID);
  // 돌아갈 주소는 링크가 실어 온 글자가 아니라 탭 헬퍼가 만든다.
  assert.equal(returnHrefForNewQuote(link), repairCaseDetailHrefs(CASE_ID).quotes);
});

test("그냥 /quotes/new 로 들어오면 채울 것도 돌아갈 곳도 없다 — 지금까지와 같은 동작", () => {
  const link = parseNewQuoteLink(undefined);
  assert.deepEqual(link, { intakeNumber: null, repairCaseId: null });
  assert.equal(returnHrefForNewQuote(link), null);
});

test("빈 값은 없는 것으로 친다", () => {
  const link = parseNewQuoteLink({ intakeNumber: "   ", repairCaseId: "" });
  assert.deepEqual(link, { intakeNumber: null, repairCaseId: null });
});

test("🔴 UUID 가 아닌 접수 건 id 는 버린다 — 남이 만든 링크가 바깥으로 보내지 못하게", () => {
  for (const forged of ["https://evil.example/steal", "//evil.example", "../../dashboard", "not-a-uuid"]) {
    const link = parseNewQuoteLink({ repairCaseId: forged });
    assert.equal(link.repairCaseId, null, `${forged} 가 통과했다`);
    assert.equal(returnHrefForNewQuote(link), null);
  }
});

test("인수번호는 앞뒤 공백을 걷어 낸다 — 그대로 조회에 들어가면 못 찾는다", () => {
  assert.equal(parseNewQuoteLink({ intakeNumber: "  D260706 " }).intakeNumber, "D260706");
});

test("같은 이름이 두 번 실려 와도 첫 값 하나만 쓴다", () => {
  const link = parseNewQuoteLink({ intakeNumber: ["D260706", "D260707"], repairCaseId: [CASE_ID] });
  assert.equal(link.intakeNumber, "D260706");
  assert.equal(link.repairCaseId, CASE_ID);
});

test("인수번호의 특수문자가 주소에서 깨지지 않는다", () => {
  // 인수번호는 사람이 적는 값이라 무엇이든 들어올 수 있다. 만든 주소를 되읽어
  // 같은 글자가 나와야 한다.
  const odd = "D26/07 06&x=1";
  const link = roundTrip(newQuoteHrefForRepairCase({ repairCaseId: CASE_ID, intakeNumber: odd }));
  assert.equal(link.intakeNumber, odd);
  assert.equal(link.repairCaseId, CASE_ID);
});
