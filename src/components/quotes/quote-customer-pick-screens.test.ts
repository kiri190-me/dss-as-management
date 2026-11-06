import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 공급처 고르개 — **화면과 저장이 그 규칙을 제자리에서 쓰는가** (2026-11-06)
 * ============================================================================
 * 규칙 자체(무엇이 붙고 무엇이 안 붙는가)는 quote-customer-pick.test.ts 가 값으로
 * 잰다. 여기서 재는 것은 **자리**다 — 규칙이 아무리 옳아도 부르는 자리가 틀리면
 * 화면은 지금까지 그대로 굴러간다.
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * QuoteEditForm 은 **서버 액션을 직접 import 하는 클라이언트 컴포넌트**라, 그 사슬
 * 끝의 `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * import 자체가 던진다(react-server 조건으로 돌리면 이번에는 useState 가 없다).
 * 이웃 시험(quote-edit-work-scope-suppression.test.ts · quote-attachment-screens.ts)
 * 과 같은 방법으로 원본을 글자로 읽는다.
 *
 * 🔴 **주석을 걷어낸 뒤에 센다.** 이 저장소의 파일들은 「왜 그렇게 했는가」를 길게
 * 적어 두고, 그 글에 함수 이름이 그대로 들어 있다 — 주석째로 세면 「부르는 곳이
 * 하나다」가 주석 때문에 둘이 되고, 반대로 「있어야 한다」 쪽은 **주석만으로 영영
 * 통과한다.**
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");

/**
 * 🔴 주석을 걷어낸다 — 줄 주석(`//`)과 블록 주석(`/* … *\/`) 둘 다. 글자 안의 `//`
 * 까지 지우지 않도록 **따옴표 안은 건드리지 않는** 식으로 쓸 수도 있지만, 이 파일이
 * 세는 이름들은 전부 코드 토큰이라 그 정도까지 가지 않는다(지나치게 지우면 「없다」
 * 쪽으로 기울고, 그쪽이 안전한 방향이다).
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/[^\n]*$/gm, " ").replace(/\/\/[^\n]*$/gm, " ");

/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const indexOrFail = (source: string, marker: string) => {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `원본에서 '${marker}' 를 찾지 못했다`);
  return at;
};

const count = (source: string, needle: string) => source.split(needle).length - 1;

const formRaw = read("src/components/quotes/QuoteEditForm.tsx");
const form = flat(stripComments(formRaw));
const mutation = flat(stripComments(read("src/lib/db/mutations/quotes.ts")));
const validation = flat(stripComments(read("src/lib/validation/quote-input.ts")));

test("🔵 못 — 주석을 걷어낸 원본이 비어 있지 않다(비면 아래가 전부 거짓으로 통과한다)", () => {
  assert.ok(form.length > 10_000, `폼 원본이 너무 짧다(${form.length})`);
  assert.ok(mutation.length > 3_000, `저장 원본이 너무 짧다(${mutation.length})`);
  // 🔴 걷어내기가 실제로 **물었는지**를 값으로 확인한다 — 안 물면 아래 「부르는 곳이
  //    하나다」가 주석 때문에 틀린 수로 센다.
  assert.equal(count(stripComments("/* quoteCustomerSaveFields */ const a = 1;"), "quoteCustomerSaveFields"), 0);
  assert.equal(count(stripComments("  // quoteCustomerSaveFields\nconst a = 1;"), "quoteCustomerSaveFields"), 0);
  assert.equal(count(stripComments("const a = quoteCustomerSaveFields(b);"), "quoteCustomerSaveFields"), 1);
});

describe("🔴 화면 — 공급처 칸이 고르개가 됐다", () => {
  const field = sliceBetween(form, 'label="공급처"', "</Field>");

  test("칸에 치는 길은 editCustomerName 하나 — datalist 와 제안이 함께 선다", () => {
    assert.ok(field.includes("onChange={(e) => editCustomerName(e.target.value)}"), field);
    assert.ok(field.includes('list="quoteCustomerName-suggestions"'), field);
    assert.ok(field.includes('<datalist id="quoteCustomerName-suggestions">'), field);
    assert.ok(field.includes("{customerSuggestions.map((option) => ("), field);
  });

  test("🔴 제안은 규칙 함수가 추린 것이다 — 화면이 따로 거르지 않는다", () => {
    assert.ok(form.includes("quoteCustomerSuggestions(customerNameText, customerOptions)"), form);
    // 🔵 `import` 줄에는 괄호가 없어 세어지지 않는다 — 여기서 1 은 **부르는 곳 하나**다.
    assert.equal(count(form, "quoteCustomerSuggestions("), 1, "제안을 만드는 곳이 둘이 됐다");
  });

  test("🔴 칸 아래에 무엇을 보일지도 규칙이 정한다 — 화면이 조건을 다시 적지 않는다", () => {
    assert.ok(form.includes("const customerPickState = quoteCustomerPickState(customerPick);"), form);
    for (const state of ["LINKED", "CREATE_NEW", "UNLINKED"]) {
      assert.ok(field.includes(`customerPickState === "${state}"`), `${state} 갈래가 없다`);
    }
    // 🔴 「등록 안 함」 갈래에는 **단추가 있다** — 누르기 전에는 아무것도 만들지 않는다.
    assert.ok(field.includes("onClick={() => toggleCustomerCreateNew(true)}"), field);
    // 🔴 켠 뒤에는 **취소**가 있다.
    assert.ok(field.includes("onClick={() => toggleCustomerCreateNew(false)}"), field);
  });

  test("🔴 단추 둘 다 type=\"button\" 이다 — 폼 안이라 빠뜨리면 눌렀을 때 저장이 돈다", () => {
    const buttons = field.split("<button").slice(1);
    assert.equal(buttons.length, 2, field);
    for (const button of buttons) {
      assert.ok(button.slice(0, button.indexOf(">")).includes('type="button"'), button.slice(0, 200));
    }
  });

  test("🔵 「누르지 않아도 저장된다」를 말해 둔다 — 자유 입력을 걷어낸 것이 아니다", () => {
    assert.ok(field.includes("누르지 않아도 저장됩니다"), field);
  });
});

describe("🔴 화면 — 공급처를 바꾸는 길", () => {
  test("editCustomerName 은 규칙을 부르고, 셋을 한 번에 붓는다", () => {
    const edit = sliceBetween(form, "function editCustomerName(", "function toggleCustomerCreateNew(");
    assert.ok(edit.includes("applyCustomerPick(quoteCustomerNameEditPatch(value, customerOptions));"), edit);
  });

  test("🔴 칸 셋을 건드리는 자리가 applyCustomerPick · 불러오기 둘뿐이다", () => {
    // 세 setter 가 폼 여기저기에서 따로 불리면 「이름은 바뀌었는데 연결은 옛 회사를
    // 가리키는」 중간 상태가 만들어진다.
    // 🔵 `useState` 선언 줄은 `setCustomerId]` 라 괄호가 없어 세어지지 않는다 —
    //    여기서 2 는 **applyCustomerPick 과 불러오기 갈래 둘**이다.
    assert.equal(count(form, "setCustomerId("), 2, "setCustomerId 를 부르는 곳이 늘었다");
    assert.equal(count(form, "setCustomerCreateNew("), 2, "setCustomerCreateNew 를 부르는 곳이 늘었다");
    assert.equal(count(form, "setCustomerNameText("), 2, "setCustomerNameText 를 부르는 곳이 늘었다");
  });

  test("🔴 [엑셀 값으로 바꾸기]도 칸에 치는 것과 **같은 길**이다(견적서 ①b)", () => {
    const apply = sliceBetween(form, "function applyExcelValue(", "function collectFields(): QuoteComparableFields {");
    assert.ok(apply.includes("customerNameText: editCustomerName,"), apply);
    assert.ok(!apply.includes("setCustomerNameText"), apply);
  });
});

describe("🔴 화면 — 인수번호로 불러온 연결이 이긴다", () => {
  const lookup = sliceBetween(form, "const found = result.found;", "setUsedParts(found.usedParts);");

  test("불러오기 갈래는 intake 쪽 규칙을 쓴다 — 이름 편집 길을 타지 않는다", () => {
    assert.ok(lookup.includes("quoteCustomerIntakePatch({ customerId: found.customerId, customerName: found.customerName, })"), lookup);
    // 🔴 여기서 editCustomerName / quoteCustomerNameEditPatch 를 타면 **고를 수 있는
    //    목록으로 되짚는** 것이 되고, 휴지통에 든 고객사의 연결이 조용히 풀린다.
    assert.ok(!lookup.includes("editCustomerName("), lookup);
    assert.ok(!lookup.includes("quoteCustomerNameEditPatch("), lookup);
  });

  test("🔴 받아 온 id 를 그대로 꽂는다 — 목록에서 찾지 않는다", () => {
    assert.ok(lookup.includes("setCustomerId(intakeCustomer.customerId);"), lookup);
    assert.ok(lookup.includes("setCustomerCreateNew(intakeCustomer.customerCreateNew);"), lookup);
  });

  test("🔵 이름은 **지금 칸의 값**을 받아 접는다 — 기다리는 동안 친 글자를 되돌리지 않는다", () => {
    assert.ok(
      lookup.includes("setCustomerNameText((current) => intakeCustomer.customerNameText ?? current);"),
      lookup
    );
  });
});

describe("🔴 저장 — 무엇을 보내고 어디서 만드는가", () => {
  test("폼이 싣는 자리는 quoteCustomerSaveFields 하나다", () => {
    const collect = sliceBetween(form, "function collectFields(): QuoteComparableFields {", "async function handleSubmit(");
    assert.ok(collect.includes("...quoteCustomerSaveFields(customerPick),"), collect);
    // 🔴 그 바깥에서 공급처 칸을 따로 적어 보내면 규칙을 우회하는 길이 생긴다.
    assert.ok(!collect.includes("newCustomerName:"), collect);
    assert.equal(count(form, "quoteCustomerSaveFields("), 1, "싣는 곳이 둘이 됐다");
  });

  test("🔴 검증은 연결이 이미 있으면 「새로 만들라」를 접는다", () => {
    assert.ok(
      validation.includes("const newCustomerName = customerId === null ? newCustomerNameText : null;"),
      validation
    );
  });

  test("🔴 고객사를 만드는 곳은 저장 트랜잭션 안 **한 곳**뿐이다", () => {
    // 🔵 `import { resolveOrCreateCustomerByName }` 에는 괄호가 없다 — 1 이 곧 부르는 곳 하나다.
    assert.equal(count(mutation, "resolveOrCreateCustomerByName("), 1, "고객사를 만드는 곳이 둘이 됐다");
    const resolver = sliceBetween(mutation, "async function withResolvedCustomer(", "function duplicateNumberResult(");
    // 🔴 이미 이어졌거나 보내지 않았으면 **아무 일도 하지 않는다**.
    assert.ok(
      resolver.includes("if (fields.customerId !== null || name === null) return { ok: true, fields };"),
      resolver
    );
  });

  test("🔴 만들기 · 고치기 둘 다 이 길을 지난다", () => {
    assert.equal(count(mutation, "await withResolvedCustomer(tx, params.fields);"), 2, mutation.slice(0, 200));
  });

  test("🔴 고치기는 「안 바뀜」을 재기 **전에** 해소한다 — 뒤면 단추를 눌러도 아무 일이 없다", () => {
    const update = sliceBetween(mutation, "export async function updateQuote(", "const [updated] = await tx");
    assert.ok(
      indexOrFail(update, "await withResolvedCustomer(tx, params.fields);") <
        indexOrFail(update, "isQuoteContentUnchanged(incomingSnapshot(fields), stored)"),
      update
    );
  });

  test("🔴 해소한 뒤에는 **그 값**으로 쓴다 — params.fields 로 되돌아가지 않는다", () => {
    const create = sliceBetween(mutation, "export async function createQuote(", "function excelOnlyViolationResult(");
    const update = sliceBetween(mutation, "export async function updateQuote(", "} catch (err) {");
    for (const [name, body] of [["createQuote", create], ["updateQuote", update]] as const) {
      const resolvedAt = indexOrFail(body, "const fields = withCustomer.fields;");
      const after = body.slice(resolvedAt);
      assert.ok(!after.includes("params.fields"), `${name} 가 해소 뒤에도 params.fields 를 쓴다: ${after.slice(0, 300)}`);
      assert.ok(after.includes("toColumnValues(fields)"), name);
    }
  });
});
