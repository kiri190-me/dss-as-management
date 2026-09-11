import { test } from "node:test";
import assert from "node:assert/strict";

import {
  newQuoteHrefForRepairCase,
  parseNewQuoteLink,
  quoteEditHref,
  returnHrefForEditQuote,
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

// ───────────────────────────── 기존 견적서 수정 → 다시 그 건

const QUOTE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_CASE_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/** 수정 화면 주소를 만든 뒤 다시 읽는다 — 브라우저가 그 주소로 들어오는 것 그대로. */
function editRoundTrip(href: string) {
  const url = new URL(href, "https://example.invalid");
  return { pathname: url.pathname, searchParams: Object.fromEntries(url.searchParams.entries()) };
}

test("🔴 접수 건이 없으면 수정 화면 주소는 지금까지의 그 주소 그대로다 — PO/내자 목록이 달라지지 않는다", () => {
  assert.equal(quoteEditHref({ quoteId: QUOTE_ID, repairCaseId: null }), `/quotes/${QUOTE_ID}`);
});

test("「견적서」 탭의 줄은 수정 화면에 그 건의 id 를 실어 보낸다 — 새 견적서와 같은 이름으로", () => {
  const href = quoteEditHref({ quoteId: QUOTE_ID, repairCaseId: CASE_ID });
  assert.equal(href, `/quotes/${QUOTE_ID}?repairCaseId=${CASE_ID}`);
  const { pathname, searchParams } = editRoundTrip(href);
  assert.equal(pathname, `/quotes/${QUOTE_ID}`);
  assert.equal(searchParams.repairCaseId, CASE_ID);
});

test("🔴 같은 건에서 왔으면 [취소]는 그 건의 「견적서」 탭으로 돌아간다", () => {
  const { searchParams } = editRoundTrip(quoteEditHref({ quoteId: QUOTE_ID, repairCaseId: CASE_ID }));
  assert.equal(
    returnHrefForEditQuote(searchParams, { repairCaseId: CASE_ID }),
    repairCaseDetailHrefs(CASE_ID).quotes
  );
});

test("🔴 주소의 건과 견적서의 건이 다르면 돌아가지 않는다 — 손으로 바꾼 링크, 그 사이 옮겨진 장", () => {
  // 남의 건 id 로 바꿔 친 주소도, 견적서가 다른 건으로 옮겨진 뒤의 옛 링크도 같은 모양이다.
  assert.equal(returnHrefForEditQuote({ repairCaseId: OTHER_CASE_ID }, { repairCaseId: CASE_ID }), null);
});

test("견적서가 어느 건에도 붙어 있지 않으면 돌아갈 건이 없다", () => {
  assert.equal(returnHrefForEditQuote({ repairCaseId: CASE_ID }, { repairCaseId: null }), null);
});

test("PO/내자 목록에서 들어오면(파라미터 없음) 돌아갈 건이 없다 — 지금까지처럼 /quotes", () => {
  assert.equal(returnHrefForEditQuote(undefined, { repairCaseId: CASE_ID }), null);
  assert.equal(returnHrefForEditQuote({}, { repairCaseId: CASE_ID }), null);
  assert.equal(returnHrefForEditQuote({ repairCaseId: "" }, { repairCaseId: CASE_ID }), null);
});

test("🔴 UUID 가 아닌 값은 버린다 — 견적서의 건 id 가 무엇이든", () => {
  for (const forged of ["https://evil.example/steal", "//evil.example", "../../dashboard", "not-a-uuid"]) {
    assert.equal(
      returnHrefForEditQuote({ repairCaseId: forged }, { repairCaseId: CASE_ID }),
      null,
      `${forged} 가 통과했다`
    );
  }
});

test("같은 이름이 두 번 실려 와도 첫 값 하나만 본다", () => {
  assert.equal(
    returnHrefForEditQuote({ repairCaseId: [CASE_ID, OTHER_CASE_ID] }, { repairCaseId: CASE_ID }),
    repairCaseDetailHrefs(CASE_ID).quotes
  );
  // 첫 값이 다른 건이면 뒤에 맞는 값이 있어도 돌아가지 않는다.
  assert.equal(
    returnHrefForEditQuote({ repairCaseId: [OTHER_CASE_ID, CASE_ID] }, { repairCaseId: CASE_ID }),
    null
  );
});

test("대문자로 적힌 같은 id 도 같은 건이다 — 돌아갈 주소는 DB 가 준 값으로 만든다", () => {
  assert.equal(
    returnHrefForEditQuote({ repairCaseId: ` ${CASE_ID.toUpperCase()} ` }, { repairCaseId: CASE_ID }),
    repairCaseDetailHrefs(CASE_ID).quotes
  );
});
