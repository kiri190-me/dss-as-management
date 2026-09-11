import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { domesticOrderTrashLabel, UNLABELED_DOMESTIC_ORDER } from "./domestic-order-trash-label";

/**
 * ============================================================================
 * 내자 정리 휴지통 — 화면이 규칙을 제자리에서 부르는가 (2026-09-11)
 * ============================================================================
 * 자료의 규칙(무엇이 지워지고 무엇이 되살아나는가)은 통합 시험이 실제 DB 로 본다
 * (mutations/domestic-orders-trash.integration.test.ts). 여기서 지키는 것은 화면
 * 쪽 약속이다:
 *  · 휴지통의 줄은 **지울 수 있는 세션에만** 서버가 읽어 보낸다(page.tsx).
 *  · 화면의 판정과 서버 액션의 판정이 **같은 수준**(MANAGE)이다.
 *  · 전환 단추 · `휴지통으로 보내기` · 확인 창이 canDelete 에만 매달려 있다.
 *  · 브라우저 confirm() 을 쓰지 않는다 — 공용 확인 창을 쓴다.
 *  · 휴지통 목록에 sr-only 를 새로 넣지 않는다(이 화면이 405px 을 흘린 함정).
 *
 * ── 왜 렌더하지 않고 원본을 읽는가 ──────────────────────────────────────
 * 목록 화면은 서버 액션을 import 하는 클라이언트 컴포넌트라, 그 사슬 끝의
 * `server-only` 때문에 react-server 조건 없이 도는 test:components 에서는
 * import 자체가 던진다. 이웃 시험(quotes/QuoteListScreen.test.ts)과 같은 방법으로
 * 원본을 글자로 읽는다.
 * ============================================================================
 */

const repoUrl = new URL("../../../", import.meta.url);
const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, repoUrl), "utf8").replace(/\r\n/g, "\n");
/** 줄바꿈·들여쓰기 차이로 시험이 깨지지 않도록 공백을 하나로 접는다. */
const flat = (source: string) => source.replace(/\s+/g, " ");

const sliceBetween = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `원본에서 '${startMarker}' 를 찾지 못했다`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `원본에서 '${endMarker}' 를 찾지 못했다`);
  return source.slice(start, end);
};

const pageSource = flat(read("src/app/(app)/domestic-orders/page.tsx"));
const screenSource = read("src/components/domestic-orders/DomesticOrderListScreen.tsx");
const formSource = read("src/components/domestic-orders/DomesticOrderEditForm.tsx");
const actionSource = read("src/lib/server/actions/domestic-orders.ts");

describe("domesticOrderTrashLabel — 확인 창에 나열할 한 줄", () => {
  test("있는 것만 이어 붙이고, 발주서번호에는 무슨 번호인지 붙인다", () => {
    assert.equal(
      domesticOrderTrashLabel({
        displayIntakeNumber: "D2609001",
        customerName: "교산",
        purchaseOrderNumber: "PO-77",
        modelName: "CFK300",
      }),
      "D2609001 · 교산 · 발주 PO-77 · CFK300"
    );
    assert.equal(
      domesticOrderTrashLabel({
        displayIntakeNumber: null,
        customerName: "교산",
        purchaseOrderNumber: null,
        modelName: null,
      }),
      "교산"
    );
  });

  test("공백만 적힌 칸은 없는 것으로 친다", () => {
    assert.equal(
      domesticOrderTrashLabel({
        displayIntakeNumber: "  ",
        customerName: " 교산 ",
        purchaseOrderNumber: "",
        modelName: null,
      }),
      "교산"
    );
  });

  test("넷 다 비어 있으면 빈 줄 대신 무엇이 비었는지 말한다", () => {
    assert.equal(
      domesticOrderTrashLabel({
        displayIntakeNumber: null,
        customerName: null,
        purchaseOrderNumber: "   ",
        modelName: null,
      }),
      UNLABELED_DOMESTIC_ORDER
    );
  });
});

describe("휴지통의 줄은 지울 수 있는 세션에만 실어 보낸다", () => {
  test("🔴 page.tsx 는 canDelete 일 때만 휴지통을 읽는다", () => {
    assert.ok(
      pageSource.includes("canDelete ? listDeletedDomesticOrders() : Promise.resolve([])"),
      "휴지통 조회가 canDelete 로 감싸여 있지 않다"
    );
  });

  test("🔴 화면의 canDelete 와 서버 액션의 관문이 같은 수준(MANAGE)이다", () => {
    assert.ok(
      pageSource.includes('hasPermission(actingUser, "domesticOrders", "MANAGE")'),
      "page.tsx 의 canDelete 가 MANAGE 판정이 아니다"
    );
    const gate = flat(sliceBetween(actionSource, "async function resolveManagingActingUser()", "function validateTrashItems("));
    assert.ok(gate.includes('hasPermission(actingUser, "domesticOrders", "MANAGE")'), "휴지통 액션의 관문이 MANAGE 가 아니다");
  });

  test("🔴 휴지통 액션 셋이 모두 그 관문을 먼저 지난다", () => {
    for (const name of [
      "deleteDomesticOrdersAction",
      "restoreDomesticOrdersAction",
      "permanentlyDeleteDomesticOrdersAction",
    ]) {
      const body = flat(sliceBetween(actionSource, `export async function ${name}(`, "return { ok: true, results };"));
      const gateAt = body.indexOf("await resolveManagingActingUser()");
      const validateAt = body.indexOf("validateTrashItems(");
      assert.ok(gateAt >= 0, `${name} 이 관문을 부르지 않는다`);
      assert.ok(validateAt > gateAt, `${name} 이 관문보다 검증을 먼저 한다`);
    }
  });
});

describe("화면의 휴지통 조작은 canDelete 에만 매달려 있다", () => {
  const screen = flat(screenSource);

  test("보기 전환은 canDelete 일 때만 머리말에 넘어간다", () => {
    assert.ok(
      screen.includes("viewSwitch={ canDelete ? ( <ViewSwitch"),
      "보기 전환이 canDelete 로 감싸여 있지 않다"
    );
    assert.ok(screen.includes('const showTrash = canDelete && view === "trash";'), "휴지통 보기가 canDelete 를 보지 않는다");
  });

  test("`휴지통으로 보내기` 는 canDelete 인 세션의 폼에만 넘어간다", () => {
    assert.ok(
      screen.includes("onRequestDelete={ canDelete && editingRow ?"),
      "폼의 삭제 단추가 canDelete 로 감싸여 있지 않다"
    );
    assert.ok(
      flat(formSource).includes("{row && onRequestDelete && ("),
      "폼이 onRequestDelete 없이도 삭제 단추를 그린다"
    );
  });

  test("확인 창 셋은 canDelete 일 때만 그려진다", () => {
    const dialogs = sliceBetween(screen, "{canDelete && ( <> <MasterDataDeleteDialog", "</> )} </div> ); }");
    for (const dialog of ["MasterDataDeleteDialog", "MasterDataRestoreDialog", "MasterDataPermanentDeleteDialog"]) {
      assert.ok(dialogs.includes(dialog), `${dialog} 가 canDelete 묶음 밖에 있다`);
    }
  });

  test("🔴 브라우저 confirm() 을 쓰지 않는다", () => {
    for (const [name, source] of [
      ["DomesticOrderListScreen", screenSource],
      ["DomesticOrderEditForm", formSource],
    ] as const) {
      assert.equal(/\bconfirm\s*\(/.test(source), false, `${name} 이 confirm() 을 부른다`);
    }
  });

  test("🔴 휴지통 목록과 보기 전환에 sr-only 를 넣지 않는다 — 문서 바닥에 자리를 주장한다", () => {
    const trashPanel = sliceBetween(screenSource, "function DomesticOrderTrashPanel(", "function trashTarget(");
    const viewSwitch = sliceBetween(screenSource, "function ViewSwitch(", "const DELETED_AT_FORMAT");
    assert.equal(trashPanel.includes("sr-only"), false, "휴지통 목록에 sr-only 가 들어갔다");
    assert.equal(viewSwitch.includes("sr-only"), false, "보기 전환에 sr-only 가 들어갔다");
  });

  test("휴지통을 보는 동안 폼은 지우지 않고 감춘다 — 사용중 보기에서는 상자를 만들지 않는다", () => {
    assert.ok(
      screen.includes('<div className={showTrash ? "hidden" : "contents"}> <DomesticOrderEditForm'),
      "폼 감싸개가 contents/hidden 이 아니다 — 사용중 보기의 flex 배치가 바뀐다"
    );
  });
});
