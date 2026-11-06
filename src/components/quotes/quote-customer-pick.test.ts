import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAX_QUOTE_CUSTOMER_SUGGESTIONS,
  quoteCustomerCreateNewPatch,
  quoteCustomerIntakePatch,
  quoteCustomerNameEditPatch,
  quoteCustomerPickState,
  quoteCustomerSaveFields,
  quoteCustomerSuggestions,
  type QuoteCustomerOption,
  type QuoteCustomerPick,
} from "./quote-customer-pick";

/**
 * ============================================================================
 * 견적서 공급처 고르개 — 값으로 재는 시험 (2026-11-06)
 * ============================================================================
 * 지키는 것 여섯:
 *  ① 정확히 맞으면 **잇는다**
 *  ② 부분만 맞으면 **안 붙는다**
 *  ③ 단추를 눌러야 **새로 만들자고 보낸다**(글자를 치는 것만으로는 안 보낸다)
 *  ④ 눌러 둔 것을 **취소할 수 있다**
 *  ⑤ 인수번호로 불러온 연결이 **이긴다**
 *  ⑥ 대소문자 · 공백만 다른 이름은 **만들지 않고 있는 것에 붙는다** —
 *     그 자가 DB 의 `customers_normalized_name_unique` 와 **같은 자**여야 한다.
 *
 * 🔵 **표본이 비어 공짜로 통과하지 않게** 못을 먼저 박는다 — 아래 `OPTIONS` 가
 *    비어 있으면 ①~⑥ 가운데 넷이 「아무것도 안 붙는다」로 그냥 통과한다.
 * ============================================================================
 */

/**
 * 고를 수 있는 고객사. 🔴 **실제 고객사 이름을 쓰지 않는다**(저장소가 공개다) —
 * 재는 것은 이름의 **모양**이지 누구인지가 아니다.
 */
const OPTIONS: QuoteCustomerOption[] = [
  { id: "c-1", name: "가나 테크" },
  { id: "c-2", name: "가나 테크 코리아" },
  { id: "c-3", name: "DARA Elec Co.,Ltd" },
  { id: "c-4", name: "마바 산업" },
];

/** 아무것도 적지 않은 빈 칸 — 폼이 새 견적서를 열었을 때의 상태 그대로. */
function blank(): QuoteCustomerPick {
  return { customerId: null, customerNameText: "", customerCreateNew: false };
}

test("🔵 못 — 표본이 비어 있지 않다(비면 아래 시험 절반이 공짜로 통과한다)", () => {
  assert.ok(OPTIONS.length >= 4, "고를 수 있는 고객사가 없다");
  // 🔴 ② 를 실제로 재려면 **한 이름이 다른 이름의 앞머리**인 짝이 있어야 한다.
  assert.ok(
    OPTIONS.some((a) => OPTIONS.some((b) => b !== a && b.name.startsWith(a.name))),
    "부분 일치를 재 볼 짝이 표본에 없다"
  );
  // 🔴 ⑥ 을 재려면 **대문자가 섞인 이름**이 있어야 한다.
  assert.ok(OPTIONS.some((option) => /[A-Z]/.test(option.name)), "대소문자를 재 볼 이름이 없다");
});

describe("① 정확히 맞으면 잇는다", () => {
  test("글자 그대로 맞는 이름을 치면 그 고객사의 id 가 붙는다", () => {
    const next = quoteCustomerNameEditPatch("가나 테크", OPTIONS);
    assert.equal(next.customerId, "c-1");
    assert.equal(next.customerNameText, "가나 테크");
    assert.equal(quoteCustomerPickState(next), "LINKED");
  });

  test("이었다가 글자를 고쳐 맞지 않게 되면 연결이 풀린다", () => {
    const linked = quoteCustomerNameEditPatch("가나 테크", OPTIONS);
    assert.equal(linked.customerId, "c-1");
    const loosened = quoteCustomerNameEditPatch("가나 테크놀", OPTIONS);
    assert.equal(loosened.customerId, null);
    assert.equal(quoteCustomerPickState(loosened), "UNLINKED");
  });

  test("🔴 칸을 비우면 아무것과도 맞지 않는다 — 빈 글자가 어느 줄에 붙으면 안 된다", () => {
    const next = quoteCustomerNameEditPatch("   ", [...OPTIONS, { id: "c-blank", name: "   " }]);
    assert.equal(next.customerId, null);
    assert.equal(quoteCustomerPickState(next), "EMPTY");
  });
});

describe("② 부분 일치로는 안 붙는다", () => {
  test("앞머리만 같은 이름에는 붙지 않는다 — 치는 도중에 긴 쪽으로 끌려가지 않는다", () => {
    for (const typed of ["가나", "가나 ", "가나 테"]) {
      const next = quoteCustomerNameEditPatch(typed, OPTIONS);
      assert.equal(next.customerId, null, `'${typed}' 가 어딘가에 붙었다`);
    }
  });

  test("긴 이름을 다 치면 **그 긴 쪽**에 붙는다 — 짧은 쪽이 가로채지 않는다", () => {
    const next = quoteCustomerNameEditPatch("가나 테크 코리아", OPTIONS);
    assert.equal(next.customerId, "c-2");
  });

  test("일부만 같은 이름은 붙지 않되 **제안에는 나온다** — 고르는 길은 막지 않는다", () => {
    const suggestions = quoteCustomerSuggestions("가나", OPTIONS);
    assert.deepEqual(
      suggestions.map((option) => option.id),
      ["c-1", "c-2"]
    );
  });
});

describe("③ 단추를 눌러야 새로 만든다", () => {
  test("🔴 글자만 쳐서는 newCustomerName 이 실리지 않는다 — 한 글자씩 쳐도 끝까지 null", () => {
    const typed = "사아 정밀";
    for (let length = 1; length <= typed.length; length += 1) {
      const next = quoteCustomerNameEditPatch(typed.slice(0, length), OPTIONS);
      const save = quoteCustomerSaveFields(next);
      assert.equal(save.newCustomerName, null, `'${typed.slice(0, length)}' 에서 실렸다`);
      assert.equal(save.customerId, null);
    }
  });

  test("단추를 누르면 그때 비로소 실린다 — 앞뒤 공백은 떼고 보낸다", () => {
    const typed = quoteCustomerNameEditPatch("  사아 정밀  ", OPTIONS);
    assert.equal(quoteCustomerPickState(typed), "UNLINKED");
    const pressed = quoteCustomerCreateNewPatch(typed, true);
    assert.equal(quoteCustomerPickState(pressed), "CREATE_NEW");
    assert.deepEqual(quoteCustomerSaveFields(pressed), {
      customerId: null,
      // 🔴 종이에 찍히는 글자는 **친 그대로** 보낸다 — 접는 일은 검증이 한다.
      customerNameText: "  사아 정밀  ",
      newCustomerName: "사아 정밀",
    });
  });

  test("🔴 이미 이어진 칸에서는 켜지지 않는다 — 같은 이름을 한 번 더 만들러 가지 않는다", () => {
    const linked = quoteCustomerNameEditPatch("가나 테크", OPTIONS);
    const pressed = quoteCustomerCreateNewPatch(linked, true);
    assert.equal(pressed.customerCreateNew, false);
    assert.equal(quoteCustomerSaveFields(pressed).newCustomerName, null);
  });

  test("🔴 빈 칸에서도 켜지지 않는다 — 이름 없는 고객사를 만들 수 없다", () => {
    const pressed = quoteCustomerCreateNewPatch(blank(), true);
    assert.equal(pressed.customerCreateNew, false);
    assert.equal(quoteCustomerSaveFields(pressed).newCustomerName, null);
  });

  test("켜 둔 채 글자를 더 치면 꺼진다 — 그 의사는 그때 적힌 이름의 것이다", () => {
    const pressed = quoteCustomerCreateNewPatch(quoteCustomerNameEditPatch("사아 정밀", OPTIONS), true);
    assert.equal(pressed.customerCreateNew, true);
    const typedMore = quoteCustomerNameEditPatch("사아 정밀공업", OPTIONS);
    assert.equal(typedMore.customerCreateNew, false);
    assert.equal(quoteCustomerSaveFields(typedMore).newCustomerName, null);
  });
});

describe("④ 취소가 된다", () => {
  test("[취소]를 누르면 다시 「등록 안 함」으로 돌아간다 — 적은 글자는 그대로다", () => {
    const pressed = quoteCustomerCreateNewPatch(quoteCustomerNameEditPatch("사아 정밀", OPTIONS), true);
    const cancelled = quoteCustomerCreateNewPatch(pressed, false);
    assert.equal(cancelled.customerCreateNew, false);
    assert.equal(cancelled.customerNameText, "사아 정밀");
    assert.equal(quoteCustomerPickState(cancelled), "UNLINKED");
    assert.equal(quoteCustomerSaveFields(cancelled).newCustomerName, null);
  });
});

describe("⑤ 인수번호로 불러온 연결이 이긴다", () => {
  test("🔴 고를 수 있는 목록에 **없는** 고객사여도 id 가 그대로 붙는다", () => {
    // 휴지통에 든 고객사는 목록에 오지 않는다 — 이름으로 되짚으면 여기서 풀린다.
    const patch = quoteCustomerIntakePatch({ customerId: "c-deleted", customerName: "지워진 고객사" });
    assert.equal(patch.customerId, "c-deleted");
    assert.equal(patch.customerNameText, "지워진 고객사");
    assert.equal(
      quoteCustomerPickState({
        customerId: patch.customerId,
        customerNameText: patch.customerNameText ?? "",
        customerCreateNew: patch.customerCreateNew,
      }),
      "LINKED"
    );
  });

  test("🔴 이름을 못 받아 왔으면 칸의 글자를 **건드리지 않는다**(null = 그대로 둠)", () => {
    const patch = quoteCustomerIntakePatch({ customerId: "c-1", customerName: null });
    assert.equal(patch.customerNameText, null);
    assert.equal(patch.customerId, "c-1");
  });

  test("눌러 둔 「새로 등록」은 꺼진다 — 공급처를 갈아 끼운 것이다", () => {
    const patch = quoteCustomerIntakePatch({ customerId: "c-1", customerName: "가나 테크" });
    assert.equal(patch.customerCreateNew, false);
  });

  test("🔴 불러온 뒤 **글자를 안 건드리면** 저장에도 그 id 가 그대로 실린다", () => {
    const patch = quoteCustomerIntakePatch({ customerId: "c-deleted", customerName: "지워진 고객사" });
    const pick: QuoteCustomerPick = {
      customerId: patch.customerId,
      customerNameText: patch.customerNameText ?? "",
      customerCreateNew: patch.customerCreateNew,
    };
    assert.deepEqual(quoteCustomerSaveFields(pick), {
      customerId: "c-deleted",
      customerNameText: "지워진 고객사",
      newCustomerName: null,
    });
  });
});

describe("⑥ 「같다」의 자가 DB 의 고유 제약과 같은가", () => {
  const migration = readFileSync(
    new URL("../../../drizzle/0022_customer_end_user_free_entry_foundation.sql", import.meta.url),
    "utf8"
  ).replace(/\r\n/g, "\n");

  test("🔴 0022 의 식을 **글자로** 확인한다 — 식이 바뀌면 아래 전부를 다시 재야 한다", () => {
    assert.ok(
      migration.includes(
        String.raw`CREATE UNIQUE INDEX "customers_normalized_name_unique" ON "customers" USING btree (lower(regexp_replace(btrim("name"), '\s+', ' ', 'g'))) WHERE is_deleted = false;`
      ),
      migration
    );
  });

  /**
   * 0022 의 식을 TypeScript 로 그대로 옮긴 것. `btrim` → 양끝 떼기,
   * `regexp_replace('\s+',' ','g')` → 가운데 공백 하나로, `lower` → 소문자.
   */
  const byIndexExpression = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

  /** 🔴 세 접기(앞뒤 · 가운데 · 대소문자)를 **전부** 건드리는 표본이어야 한다. */
  const SAMPLES = [
    "  가나 테크  ",
    "가나  테크",
    "DARA ELEC CO.,LTD",
    "dara elec co.,ltd",
    " DARA   Elec  Co.,Ltd ",
    "마바 산업",
  ];

  test("🔵 못 — 표본이 세 접기를 다 건드린다(안 건드리면 아래가 공짜로 통과한다)", () => {
    assert.ok(SAMPLES.some((name) => name !== name.trim()), "앞뒤 공백 표본이 없다");
    assert.ok(SAMPLES.some((name) => /\s\s/.test(name)), "가운데 겹공백 표본이 없다");
    assert.ok(SAMPLES.some((name) => name !== name.toLowerCase()), "대문자 표본이 없다");
  });

  test("🔴 고르개가 쓰는 자와 색인의 식이 **같은 답**을 낸다", () => {
    for (const name of SAMPLES) {
      // 고르개의 자는 「이 글자가 저 이름과 같은가」로만 드러난다 — 그 답으로 잰다.
      const linkedId = quoteCustomerNameEditPatch(name, OPTIONS).customerId;
      const expected =
        OPTIONS.find((option) => byIndexExpression(option.name) === byIndexExpression(name))?.id ?? null;
      assert.equal(linkedId, expected, `'${name}' 에서 갈렸다`);
    }
  });

  test("🔴 대소문자 · 공백만 다른 이름은 **새로 만들자고 보내지 않는다** — 있는 것에 붙는다", () => {
    for (const name of [" 가나  테크 ", "DARA ELEC CO.,LTD", "dara elec co.,ltd"]) {
      const next = quoteCustomerNameEditPatch(name, OPTIONS);
      assert.notEqual(next.customerId, null, `'${name}' 가 안 붙었다 — 눌러 저장하면 제약에 걸린다`);
      assert.equal(quoteCustomerPickState(next), "LINKED");
      // 이어졌으니 단추가 켜지지도 않고, 켜려 해도 안 켜진다(③).
      assert.equal(quoteCustomerSaveFields(quoteCustomerCreateNewPatch(next, true)).newCustomerName, null);
    }
  });
});

describe("제안 목록", () => {
  test("여덟 줄까지만 내민다", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      id: `m-${index}`,
      name: `표본 ${String(index).padStart(2, "0")}`,
    }));
    assert.equal(MAX_QUOTE_CUSTOMER_SUGGESTIONS, 8);
    assert.equal(quoteCustomerSuggestions("표본", many).length, 8);
  });

  test("빈 칸에는 전체가 이름순으로 온다 — 처음 열었을 때 훑어볼 것이 있어야 한다", () => {
    const names = quoteCustomerSuggestions("", OPTIONS).map((option) => option.name);
    // 🔴 **차례를 글자로 적어 두지 않는다** — 한글과 라틴 글자의 앞뒤는 그 PC 의
    //    ICU 자료가 정해서, 적어 두면 Node 를 올리는 날 까닭 없이 빨개진다. 재는 것은
    //    ① 하나도 빠지지 않는가 ② 이름순으로 **정렬돼 있는가** 둘이다.
    assert.deepEqual([...names].sort(), [...OPTIONS.map((option) => option.name)].sort());
    for (let index = 1; index < names.length; index += 1) {
      assert.ok(
        names[index - 1].localeCompare(names[index]) <= 0,
        `${names[index - 1]} 다음에 ${names[index]} 가 왔다`
      );
    }
  });
});
