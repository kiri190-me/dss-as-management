import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INVENTORY_OH_LINE_FIELD, INVENTORY_STOCK_REQUEST_LINE_FIELDS } from "@/lib/domain/inventory-contract";
import {
  STOCK_REQUEST_CHARGE_TAG_CLASS,
  STOCK_REQUEST_OH_TAG_CLASS,
  STOCK_REQUEST_OH_TAG_VALUE,
  STOCK_REQUEST_OWNER_TAG_CLASS,
  parseInventoryStockRequestsResponse,
  parseStockRequestLines,
  stockRequestLineChargeTag,
  stockRequestLineOwnerTag,
  stockRequestOhTag,
} from "@/lib/domain/inventory-gateway";
import { validateStockRequestCart, type StockRequestCartLine } from "@/lib/domain/inventory-stock-request-cart";

/**
 * ============================================================================
 * 🔴 **O/H 부품이라는 표시가 줄마다 따라다니는가** (2026-10-22 쓰는 분 요청)
 * ============================================================================
 * 「A/S 의 [수리 건 상세]에서 **[O/H 부품 한 번에 담기]**를 하면, 그 부품이 **O/H 부품이라는
 * 표시**를 **부품을 요청하는 모든 과정에 부품마다** 띄워 줘.」
 *
 * 이 파일이 붙잡는 것 다섯 —
 *  ㉠ **담기는 그 순간에 찍는다**(스냅샷). [한 번에 담기]로 담긴 줄만 참이고, 손으로 담은 줄은
 *     거짓이다. 🔴 나중에 템플릿을 다시 보지 않는다 — 템플릿은 바뀌고, 바뀌면 **옛 신청의
 *     표시가 조용히 달라진다.**
 *  ㉡ **장바구니 → 올릴 줄**로 그대로 실려 간다. 중간에서 떨어지면 「담는 중에만 보이는」
 *     딱지가 된다.
 *  ㉢ 🔴 **칸 이름이 두 시스템이 정한 그 글자다**(`INVENTORY_OH_LINE_FIELD`). 어긋나면 **아무
 *     오류가 안 나고** 딱지만 영영 안 뜬다 — 이 시험이 글자를 손으로 다시 적지 않고 **그
 *     상수와 견주는** 까닭이다. 저쪽 저장소가 같은 글자를 쓰는지는 한 저장소 안에서는 잴 수
 *     없다: `scripts/check-inventory-contract.ts` 의 ㉢ 이 두 저장소를 맞댄다.
 *  ㉣ **되받을 때 없으면 「O/H 아님」**이다. 2026-10-22 전에 올라간 신청에는 칸이 아예 없고,
 *     그래도 깨지지 않아야 한다.
 *  ㉤ **딱지는 참일 때만 선다.** 🔴 「일반」 같은 딱지를 만들지 않는다 — 옛 신청이 「확인해
 *     보니 일반 부품」으로 단정돼 보인다.
 *
 * 🔵 **올리는 본문에 그 글자가 실제로 실리는가**는 통로를 **진짜로 불러** 재는 자리가 따로
 *    있다(`src/lib/server/inventory-gateway.test.ts` — 「올리기」 묶음).
 * ============================================================================
 */

/**
 * 🔴 **주석을 뗀다.** 안 떼면 머리말에 적힌 글자를 「코드가 그렇게 돼 있다」로 세어 헛통과한다 —
 * 이 저장소의 주석은 길고, 재려는 낱말이 거의 반드시 거기 적혀 있다.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/* 🔵 2026-10-27 에 `components/inventory/` 에서 수리 건 상세 폴더로 옮겨 왔다 — 옛 재고 화면을
   걷어내면서 그 폴더에 섞여 있던 **새 코드**만 건져 낸 것이다(그 화면들과 달리 이 칸은 재고
   관리 시스템의 통로를 쓴다). 여기서 바뀐 것은 읽어 오는 자리뿐이고 재는 것은 그대로다. */
const SCREEN_PATH = "src/components/repair-cases/detail/PartRequestSection.tsx";
const screen = stripComments(readFileSync(SCREEN_PATH, "utf8"));

/** 화면의 함수 하나만 떼어 본다. 🔴 **빈 토막이면 아래 단언이 전부 거짓말을 한다.** */
function screenFunction(name: string): string {
  const start = screen.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 을 못 찾았다 — 이름이 바뀌었으면 이 시험도 함께 고쳐라`);
  const end = screen.indexOf("\n  }", start);
  assert.ok(end > start, `${name} 의 끝을 못 찾았다`);
  const cut = screen.slice(start, end);
  assert.ok(cut.length > 0, "잘라 낸 토막이 비어 있다");
  return cut;
}

const cartLine = (patch: Partial<StockRequestCartLine> = {}): StockRequestCartLine => ({
  no: 11,
  name: "부품-11",
  ownerLabel: "DSS",
  quantity: "1",
  chargeType: "PAID",
  fromOhTemplate: false,
  ...patch,
});

describe("㉠ 🔴 표시는 **담기는 그 순간**에 찍힌다 (스냅샷)", () => {
  test("[O/H 부품 한 번에 담기]로 담긴 줄만 참이다", () => {
    assert.match(screenFunction("addOhTemplateToCart"), /fromOhTemplate: true,/);
  });

  test("🔴 손으로 담은 줄은 거짓이다 — 같은 부품이 템플릿에 있어도", () => {
    assert.match(screenFunction("addToCart"), /fromOhTemplate: false,/);
  });

  test("🔴 담을 때 **템플릿을 다시 보지 않는다** — 손으로 담는 자리에 템플릿이 없다", () => {
    const manual = screenFunction("addToCart");
    assert.doesNotMatch(manual, /template|ohTemplate/, "손으로 담는 자리가 템플릿을 들여다본다");
  });

  test("🔴 [한 번에 담기]가 **이미 담긴 줄을 고치지 않는다** — 본 적 없는 표시가 붙으면 안 된다", () => {
    const bulk = screenFunction("addOhTemplateToCart");
    // 이미 담겨 있으면 건너뛰고(`skippedAlready`), 고치는 길(패치)은 아예 없다.
    assert.match(bulk, /skippedAlready\.push/);
    assert.doesNotMatch(bulk, /updateCartLine|applyStockRequestCartPatch/, "이미 담긴 줄을 덮어쓰고 있다");
  });
});

describe("㉡ 장바구니 → 올릴 줄로 **줄마다 제 값**이 실려 간다", () => {
  test("섞여 있어도 뒤바뀌지 않는다", () => {
    const result = validateStockRequestCart([
      cartLine({ no: 11, fromOhTemplate: true }),
      cartLine({ no: 12, fromOhTemplate: false }),
      cartLine({ no: 13, fromOhTemplate: true }),
    ]);
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.ok ? result.lines.map((l) => [l.no, l.fromOhTemplate]) : null,
      [
        [11, true],
        [12, false],
        [13, true],
      ]
    );
  });

  test("🔵 수량·유상무상을 고쳐도 표시는 그대로다 — 담은 자리가 정하는 값이다", () => {
    const result = validateStockRequestCart([cartLine({ fromOhTemplate: true, quantity: "7", chargeType: "FREE" })]);
    assert.equal(result.ok, true);
    assert.equal(result.ok ? result.lines[0].fromOhTemplate : null, true);
  });
});

describe("㉢ 🔴 칸 이름이 **두 시스템이 정한 그 글자**다", () => {
  test("올릴 줄이 그 이름의 칸을 들고 나간다 — 글자를 여기 다시 적지 않는다", () => {
    const result = parseStockRequestLines([{ no: 11, quantity: 1, chargeType: "PAID", fromOhTemplate: true }]);
    assert.equal(result.ok, true);
    const line = result.ok ? (result.lines[0] as unknown as Record<string, unknown>) : {};
    assert.ok(
      Object.hasOwn(line, INVENTORY_OH_LINE_FIELD),
      `올리는 줄에 「${INVENTORY_OH_LINE_FIELD}」 칸이 없다 — 저쪽은 못 읽고 조용히 거짓으로 눕힌다`
    );
    assert.equal(line[INVENTORY_OH_LINE_FIELD], true);
  });

  test("🔴 **거짓도 칸을 세워** 보낸다 — 「모른다」가 없는 값이다", () => {
    const result = parseStockRequestLines([{ no: 11, quantity: 1, chargeType: "PAID" }]);
    assert.equal(result.ok, true);
    const line = result.ok ? (result.lines[0] as unknown as Record<string, unknown>) : {};
    assert.ok(Object.hasOwn(line, INVENTORY_OH_LINE_FIELD));
    assert.equal(line[INVENTORY_OH_LINE_FIELD], false);
  });

  test("🔴 되받는 쪽도 **같은 글자**로 읽는다 — 보내는 이름과 읽는 이름이 하나다", () => {
    const parsed = parseInventoryStockRequestsResponse({
      requests: [{ id: "r1", lines: [{ no: 11, name: "부품", [INVENTORY_OH_LINE_FIELD]: true }] }],
    });
    assert.ok(parsed !== null);
    assert.equal(parsed[0].lines[0].fromOhTemplate, true, "저쪽이 보낸 그 글자를 못 읽었다");
  });

  test("🔴 그 글자가 **맞대어 보는 칸 목록**에 들어 있다 — 저쪽이 안 보내면 점검이 빨개진다", () => {
    assert.ok(
      (INVENTORY_STOCK_REQUEST_LINE_FIELDS as readonly string[]).includes(INVENTORY_OH_LINE_FIELD),
      "칸 목록에서 빠졌다 — 저쪽이 안 보내도 아무 말도 안 하게 된다"
    );
  });

  test("🔵 기술 계층 글자라 **ASCII** 다 — 머리말·주소에 섞여도 요청이 터지지 않는다", () => {
    assert.match(INVENTORY_OH_LINE_FIELD, /^[A-Za-z][A-Za-z0-9]*$/);
  });
});

describe("㉣ 🔴 되받을 때 **없으면 「O/H 아님」**이다 — 옛 신청이 깨지지 않는다", () => {
  const lineOf = (raw: Record<string, unknown>) => {
    const parsed = parseInventoryStockRequestsResponse({
      requests: [{ id: "r1", lines: [{ no: 11, name: "부품", ...raw }] }],
    });
    assert.ok(parsed !== null);
    return parsed[0].lines[0];
  };

  test("칸이 아예 없는 옛 줄", () => {
    assert.equal(lineOf({}).fromOhTemplate, false);
  });

  test("🔴 참이 아닌 것은 전부 거짓이다 — 글자 `\"true\"` 도 숫자 1 도 봐 주지 않는다", () => {
    for (const bad of ["true", "TRUE", 1, "1", {}, [], null] as unknown[]) {
      assert.equal(lineOf({ fromOhTemplate: bad }).fromOhTemplate, false, JSON.stringify(bad) ?? "undefined");
    }
  });

  test("🔵 칸이 없다고 그 줄이 사라지거나 다른 칸이 망가지지 않는다", () => {
    const line = lineOf({ quantity: 2, issued: 1, chargeType: { code: "PAID", label: "유상" } });
    assert.equal(line.quantity, 2);
    assert.equal(line.issued, 1);
    assert.equal(line.chargeType?.code, "PAID");
  });
});

describe("㉤ 🔴 딱지는 **참일 때만** 선다 — 「일반」을 만들지 않는다", () => {
  test("아니면 아무것도 안 그린다", () => {
    assert.equal(stockRequestOhTag({ fromOhTemplate: false }), null);
  });

  test("맞으면 정해 둔 글자 하나 — 화면이 아니라 상수가 쥔다", () => {
    const tag = stockRequestOhTag({ fromOhTemplate: true });
    assert.ok(tag !== null);
    assert.equal(tag.key, "oh");
    assert.equal(tag.value, STOCK_REQUEST_OH_TAG_VALUE);
    assert.equal(tag.label, "", "「O/H」 앞에 이름표를 달면 같은 말이 두 번 나온다");
  });

  test("🔴 낱말이 「O/H」다 — 「오버홀」로 풀지 않는다 (두 저장소가 쓰는 말)", () => {
    assert.equal(STOCK_REQUEST_OH_TAG_VALUE, "O/H");
    assert.doesNotMatch(STOCK_REQUEST_OH_TAG_VALUE, /오버홀/);
  });

  test("🔴 이웃 딱지 둘과 **색 말고도** 갈린다 — 글자가 섞일 수 없다", () => {
    const oh = stockRequestOhTag({ fromOhTemplate: true })!;
    const owner = stockRequestLineOwnerTag({ owner: { code: "KYOSAN", label: "KYOSAN" } })!;
    const charge = stockRequestLineChargeTag({ chargeType: { code: "PAID", label: "유상" } })!;
    assert.notEqual(oh.value, owner.value);
    assert.notEqual(oh.value, charge.value);
    assert.notEqual(oh.className, STOCK_REQUEST_OWNER_TAG_CLASS);
    assert.notEqual(oh.className, STOCK_REQUEST_CHARGE_TAG_CLASS.PAID);
    assert.notEqual(oh.className, STOCK_REQUEST_CHARGE_TAG_CLASS.FREE);
  });

  test("🔴 **다크 짝이 붙어 있다** — 밝은 쪽만 적으면 어두운 화면에서 글자가 잠긴다", () => {
    for (const piece of ["dark:border-", "dark:bg-", "dark:text-"]) {
      assert.ok(STOCK_REQUEST_OH_TAG_CLASS.includes(piece), `${piece} 짝이 없다`);
    }
  });
});

describe("🔴 두 화면이 **같은 함수·같은 조각**으로 그린다 (담는 중 · 올린 뒤)", () => {
  test("딱지를 묻는 자리가 둘 다 순수 함수다", () => {
    const calls = [...screen.matchAll(/stockRequestOhTag\(/g)];
    assert.equal(calls.length, 2, `딱지를 묻는 자리가 둘이 아니다(${calls.length}) — 담는 중과 올린 뒤 둘이다`);
  });

  test("🔴 글자도 꾸밈도 화면에 손으로 적지 않았다", () => {
    assert.ok(!screen.includes(">O/H<"), "딱지 글자를 화면에 적었다 — 말이 바뀌는 날 이 줄만 옛말을 한다");
    /* 🔵 **꾸밈 글자 통째로** 견준다 — 「violet」 한 조각으로 재면 이 화면이 전부터 쓰던
       보류 사유 상자의 보라까지 걸려, 멀쩡한 코드가 빨개진다(금지를 넓게 적지 않는다). */
    assert.ok(
      !screen.includes(STOCK_REQUEST_OH_TAG_CLASS),
      "딱지 꾸밈을 화면에 베껴 적었다 — 한쪽만 고치는 날 두 화면이 다르게 보인다"
    );
  });

  test("🔴 딱지 markup 이 **한 조각**이다 — 두 벌로 적으면 담는 중과 올린 뒤가 갈린다", () => {
    assert.match(screen, /function LineTags\(/, "딱지를 그리는 조각이 없다");
    assert.equal([...screen.matchAll(/<LineTags /g)].length, 2, "조각을 쓰는 자리가 둘이 아니다");
  });

  test("🔵 아닌 줄에는 아무것도 안 그린다 — 「일반」 글자가 화면 어디에도 없다", () => {
    assert.ok(!screen.includes(">일반<"), "「일반」 딱지를 그리고 있다");
  });
});
