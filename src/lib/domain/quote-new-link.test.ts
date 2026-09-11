import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  newQuoteHrefForRepairCase,
  parseNewQuoteLink,
  quoteEditHref,
  quotePrintHref,
  returnHrefForEditQuote,
  returnHrefForNewQuote,
  returnHrefForQuotePrint,
  trustedLinkedRepairCaseId,
  type SearchParamsInput,
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

// ───────────────────────────── 견적서 인쇄 화면 → 수정 화면 → 다시 그 건

const QUOTE = { id: QUOTE_ID, repairCaseId: CASE_ID };
const PLAIN_EDIT = `/quotes/${QUOTE_ID}`;

test("🔴 접수 건이 없으면 인쇄 화면 주소는 지금까지의 그 주소 그대로다 — PO/내자 목록이 달라지지 않는다", () => {
  assert.equal(quotePrintHref({ quoteId: QUOTE_ID, repairCaseId: null }), `/quotes/${QUOTE_ID}/print`);
});

test("「견적서」 탭의 [미리보기 · PDF] 는 인쇄 화면에 그 건의 id 를 같은 이름으로 실어 보낸다", () => {
  const href = quotePrintHref({ quoteId: QUOTE_ID, repairCaseId: CASE_ID });
  assert.equal(href, `/quotes/${QUOTE_ID}/print?repairCaseId=${CASE_ID}`);
  const { pathname, searchParams } = editRoundTrip(href);
  assert.equal(pathname, `/quotes/${QUOTE_ID}/print`);
  assert.equal(searchParams.repairCaseId, CASE_ID);
});

test("🔴 같은 건에서 왔으면 인쇄 화면의 「돌아가기」는 그 건을 실은 수정 화면으로 간다", () => {
  const { searchParams } = editRoundTrip(quotePrintHref({ quoteId: QUOTE_ID, repairCaseId: CASE_ID }));
  assert.equal(
    returnHrefForQuotePrint(searchParams, QUOTE),
    quoteEditHref({ quoteId: QUOTE_ID, repairCaseId: CASE_ID })
  );
});

test("🔴 탭 → 인쇄 → 돌아가기 → [취소] 가 끝까지 그 건의 「견적서」 탭으로 이어진다", () => {
  // 사용자가 실제로 밟는 길 그대로 — 주소를 만들고 되읽기를 두 번 한다.
  const atPrint = editRoundTrip(quotePrintHref({ quoteId: QUOTE_ID, repairCaseId: CASE_ID }));
  const atEdit = editRoundTrip(returnHrefForQuotePrint(atPrint.searchParams, QUOTE));
  assert.equal(atEdit.pathname, `/quotes/${QUOTE_ID}`);
  assert.equal(returnHrefForEditQuote(atEdit.searchParams, QUOTE), repairCaseDetailHrefs(CASE_ID).quotes);
});

test("🔴 주소의 건과 견적서의 건이 다르면 맥락을 싣지 않는다 — 지금까지의 `/quotes/{id}`", () => {
  assert.equal(returnHrefForQuotePrint({ repairCaseId: OTHER_CASE_ID }, QUOTE), PLAIN_EDIT);
});

test("인쇄 화면: 견적서가 어느 건에도 붙어 있지 않으면 `/quotes/{id}`", () => {
  assert.equal(returnHrefForQuotePrint({ repairCaseId: CASE_ID }, { id: QUOTE_ID, repairCaseId: null }), PLAIN_EDIT);
});

test("인쇄 화면: PO/내자 목록에서 들어오면(파라미터 없음) 지금까지의 `/quotes/{id}` 그대로", () => {
  assert.equal(returnHrefForQuotePrint(undefined, QUOTE), PLAIN_EDIT);
  assert.equal(returnHrefForQuotePrint({}, QUOTE), PLAIN_EDIT);
  assert.equal(returnHrefForQuotePrint({ repairCaseId: "" }, QUOTE), PLAIN_EDIT);
});

test("🔴 인쇄 화면: UUID 가 아닌 값은 버린다 — 돌아가기 주소에 링크의 글자가 섞이지 않는다", () => {
  for (const forged of ["https://evil.example/steal", "//evil.example", "../../dashboard", "not-a-uuid"]) {
    assert.equal(returnHrefForQuotePrint({ repairCaseId: forged }, QUOTE), PLAIN_EDIT, `${forged} 가 통과했다`);
  }
});

test("인쇄 화면: 대문자로 적힌 같은 id 도 같은 건이다 — 실어 보내는 값은 DB 가 준 값이다", () => {
  assert.equal(
    returnHrefForQuotePrint({ repairCaseId: ` ${CASE_ID.toUpperCase()} ` }, QUOTE),
    quoteEditHref({ quoteId: QUOTE_ID, repairCaseId: CASE_ID })
  );
});

// ───────────────────────────── 🔴 판정은 한 벌이다

/** 수정 화면과 인쇄 화면이 똑같이 받아야 하는 주소들 — 통과·거절 모두. */
const JUDGED_CASES: { name: string; searchParams: SearchParamsInput | undefined; quote: { id: string; repairCaseId: string | null } }[] = [
  { name: "같은 건", searchParams: { repairCaseId: CASE_ID }, quote: QUOTE },
  { name: "대문자·공백", searchParams: { repairCaseId: ` ${CASE_ID.toUpperCase()} ` }, quote: QUOTE },
  { name: "첫 값이 같은 건", searchParams: { repairCaseId: [CASE_ID, OTHER_CASE_ID] }, quote: QUOTE },
  { name: "첫 값이 다른 건", searchParams: { repairCaseId: [OTHER_CASE_ID, CASE_ID] }, quote: QUOTE },
  { name: "다른 건", searchParams: { repairCaseId: OTHER_CASE_ID }, quote: QUOTE },
  { name: "견적서 건 NULL", searchParams: { repairCaseId: CASE_ID }, quote: { id: QUOTE_ID, repairCaseId: null } },
  { name: "UUID 아님", searchParams: { repairCaseId: "not-a-uuid" }, quote: QUOTE },
  { name: "빈 값", searchParams: { repairCaseId: "" }, quote: QUOTE },
  { name: "파라미터 없음", searchParams: {}, quote: QUOTE },
  { name: "searchParams 없음", searchParams: undefined, quote: QUOTE },
];

test("🔴 수정 화면과 인쇄 화면은 같은 주소에 같은 판정을 내린다", () => {
  for (const { name, searchParams, quote } of JUDGED_CASES) {
    const trusted = trustedLinkedRepairCaseId(searchParams, quote);
    assert.equal(
      returnHrefForEditQuote(searchParams, quote),
      trusted === null ? null : repairCaseDetailHrefs(trusted).quotes,
      `수정 화면이 판정과 어긋난다: ${name}`
    );
    assert.equal(
      returnHrefForQuotePrint(searchParams, quote),
      quoteEditHref({ quoteId: quote.id, repairCaseId: trusted }),
      `인쇄 화면이 판정과 어긋난다: ${name}`
    );
  }
});

test("🔴 판정 조건은 한 함수에만 적혀 있다 — 두 화면의 함수는 그것을 부르기만 한다", () => {
  // 행동이 지금 같아도, 조건을 두 벌로 적어 두면 언젠가 한쪽만 느슨해진다.
  // CRLF 로 받아 둔 저장소에서도 아래 끝 표지("\n}\n")가 맞도록 LF 로 맞춘다.
  const source = readFileSync(new URL("./quote-new-link.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const body = (name: string) => {
    const start = source.indexOf(`export function ${name}(`);
    assert.ok(start >= 0, `원본에서 ${name} 를 찾지 못했다`);
    const end = source.indexOf("\n}\n", start);
    assert.ok(end > start, `원본에서 ${name} 의 끝을 찾지 못했다`);
    return source.slice(start, end);
  };
  for (const name of ["returnHrefForEditQuote", "returnHrefForQuotePrint"]) {
    const fn = body(name);
    assert.ok(fn.includes("trustedLinkedRepairCaseId("), `${name} 가 판정 함수를 부르지 않는다`);
    for (const condition of ["UUID_PATTERN", "toLowerCase", "firstValue("]) {
      assert.ok(!fn.includes(condition), `${name} 가 판정 조건(${condition})을 따로 적었다`);
    }
  }
});
