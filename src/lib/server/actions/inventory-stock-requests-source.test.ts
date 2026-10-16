import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * ============================================================================
 * 재고 관리 신청 액션의 **울타리가 제자리에 있는가** (2026-10-16)
 * ============================================================================
 * 이 파일은 `"use server"` 에 세션·DB·망을 모두 끌어오므로 이 환경에서 불러 볼 수 없다
 * (이웃 `app/api/v1/route-source.test.ts` 와 같은 사정 — 거기서도 라우트 대신 **원본 글자**를
 * 읽는다). 규칙 자체가 지켜지는가는 순수 쪽 시험이 재고(`lib/domain/inventory-gateway.test.ts`
 * 의 `stockRequestKeyBelongsToCase`), 통로를 어떻게 두드리는가는 `lib/server/
 * inventory-gateway.test.ts` 가 잰다. 여기서는 **액션이 그 울타리를 실제로 거치는가**만 본다.
 *
 * 붙잡는 것 셋 — 하나라도 빠지면 **남의 신청이 거둬진다**:
 *  ㉠ **포털 번호를 세션에서 꺼낸다.** 화면이 보낸 값을 쓰면 아무 번호나 적어 남의 신청을
 *     거둘 수 있다. 그래서 거두기 액션은 신청자를 **받는 칸 자체가 없다.**
 *  ㉡ **그 열쇠가 이 수리 건의 것인지 본다.** 거두는 통로는 `requestKey` 하나로 신청을 찾고
 *     수리 건을 받지 않는다 — 막을 수 있는 자리가 이쪽뿐이다.
 *  ㉢ **올리는 쪽과 같은 권한 축**(`inventory.requests` 쓰기)을 **액션이 직접** 묻는다.
 * ============================================================================
 */

const PATH = "src/lib/server/actions/inventory-stock-requests.ts";
const source = readFileSync(PATH, "utf8");
/**
 * 거두는 액션만 떼어 본다 — 올리는 액션의 같은 모양과 섞이지 않게.
 * 🔴 **채우는 액션이 그 뒤에 있어서** 거기서 끊는다. 안 끊으면 거두기의 단언이 채우기의
 *    같은 모양(세션에서 포털 번호를 꺼내는 줄 따위)에 걸려 **거두기가 망가져도 통과한다.**
 */
const cancelAction = source.slice(
  source.indexOf("export async function cancelInventoryStockRequestAction"),
  source.indexOf("export type FillPartCustomerNameActionResult")
);
/** 채우는 액션만 떼어 본다(2026-10-16 요청 E). */
const fillAction = source.slice(source.indexOf("export async function fillInventoryPartCustomerNameAction"));

describe("🔴 포털 번호는 서버가 세션에서 꺼낸다 — 화면 값을 믿지 않는다", () => {
  test("거두기 액션은 신청자를 **받지 않는다** — 받는 칸이 없어야 실수로 믿지 않는다", () => {
    const signature = cancelAction.slice(0, cancelAction.indexOf("): Promise<"));
    assert.match(signature, /repairCaseId: string;/);
    assert.match(signature, /requestKey: string;/);
    assert.doesNotMatch(signature, /sub|requester|portal/i, "화면이 보낸 신청자를 받고 있다");
  });

  test("세션의 사람으로 포털 번호를 읽어 그대로 통로에 넘긴다", () => {
    assert.match(cancelAction, /const sub = await getSsoSubjectForUser\(actingUser\.id\);/);
    assert.match(cancelAction, /if \(!sub\) return \{ ok: false, message: NO_PORTAL_ID_MESSAGE \};/);
    assert.match(cancelAction, /cancelInventoryStockRequest\(\{[^}]*requesterSub: sub[^}]*\}\)/);
    // 🔴 input 에서 꺼낸 값을 신청자로 쓰는 길이 남아 있으면 안 된다.
    assert.doesNotMatch(cancelAction, /requesterSub: input\./);
  });
});

describe("🔴 거둘 신청이 **이 수리 건**의 것인가", () => {
  test("이 건의 인수번호로 목록을 다시 받아 그 안에 있는 열쇠일 때만 거두러 간다", () => {
    assert.match(cancelAction, /const intakeNumber = await getIntakeNumberForRepairCase\(input\.repairCaseId\);/);
    assert.match(cancelAction, /await fetchInventoryStockRequestsByIntake\(intakeNumber\)/);
    assert.match(
      cancelAction,
      /if \(!stockRequestKeyBelongsToCase\(requests\.value, input\.requestKey\)\) \{\s*return \{ ok: false, message: STOCK_REQUEST_NOT_IN_CASE_MESSAGE \};/
    );
  });

  test("🔴 확인 순서가 거꾸로가 아니다 — 확인한 **뒤에** 거두러 간다", () => {
    const guard = cancelAction.indexOf("stockRequestKeyBelongsToCase");
    const cancelCall = cancelAction.indexOf("return cancelInventoryStockRequest({");
    assert.ok(guard >= 0 && cancelCall > guard, "열쇠를 확인하기 전에 거두러 가고 있다");
  });

  test("🔴 목록을 못 받아 왔으면 거두지 않는다 — 확인하지 못한 것을 통과시키지 않는다", () => {
    assert.match(cancelAction, /if \(requests\.status !== "ok"\) \{/);
    const unreachable = cancelAction.slice(cancelAction.indexOf('if (requests.status !== "ok") {'));
    assert.match(unreachable.slice(0, 300), /ok: false/);
  });
});

describe("🔴 권한은 올리는 쪽과 같은 축으로 **액션이 직접** 묻는다", () => {
  test("`inventory.requests` 쓰기를 보고, 역할 이름을 비교하지 않는다", () => {
    assert.match(cancelAction, /await hasPermission\(actingUser, "inventory\.requests", "WRITE"\)/);
    assert.doesNotMatch(cancelAction, /role ===|roleCode|"ADMIN"/);
  });

  test("로그인·승인·저장 모드를 거친 뒤에야 권한을 묻는다", () => {
    const authSource = cancelAction.indexOf('getAuthSource() !== "database"');
    const session = cancelAction.indexOf("await readSession()");
    const approved = cancelAction.indexOf('session.approvalStatus !== "APPROVED"');
    const permission = cancelAction.indexOf("hasPermission(actingUser");
    assert.ok(authSource >= 0 && session > authSource && approved > session && permission > approved);
  });

  test("요청 번호와 수리 건 id 의 모양을 먼저 잰다", () => {
    assert.match(cancelAction, /if \(!isValidUuid\(input\.repairCaseId\)\)/);
    assert.match(cancelAction, /if \(!isValidRequestKey\(input\.requestKey\)\)/);
  });
});

/**
 * ============================================================================
 * 🔴 고객사 품명 채우기 — **A/S 가 재고 자료를 고치는 첫 액션** (2026-10-16 요청 E)
 * ============================================================================
 * 위 둘은 신청 표에 줄을 세우고 거둘 뿐이지만, 이 액션은 **정본인 부품 표의 칸 하나**를
 * 바꾼다. 그 값은 그대로 **고객사에 나가는 서류**에 찍힌다. 붙잡는 것 셋:
 *
 *  ㉠ **포털 번호를 세션에서 꺼낸다.** 저쪽 변경 이력에 「누가 채웠나」로 남는 값이라, 화면이
 *     적어 보낸 번호를 실어 주면 **남의 이름으로 자료가 고쳐진다.** 그래서 거두기와 같이
 *     신청자를 **받는 칸 자체가 없다.**
 *  ㉡ 🔴 **내용 규칙을 여기서 다시 적지 않는다.** 빈 값 · `-` 만 · 200자 초과를 저쪽이 각각
 *     다른 말로 거절하고, 그 글자를 그대로 올린다. 자가 두 벌이면 저쪽이 상한을 고치는 날
 *     화면만 옛 규칙으로 막는다. 여기서 재는 것은 **모양**뿐이다(번호가 정수인가).
 *  ㉢ **올리는 쪽과 같은 권한 축**(`inventory.requests` 쓰기)을 **액션이 직접** 묻는다.
 * ============================================================================
 */
describe("🔴 고객사 품명 채우기 — 울타리가 제자리에 있는가", () => {
  test("㉠ 채우는 사람을 **받지 않는다** — 받는 칸이 없어야 실수로 믿지 않는다", () => {
    const signature = fillAction.slice(0, fillAction.indexOf("): Promise<"));
    assert.match(signature, /no: number;/);
    assert.match(signature, /customerName: string;/);
    assert.doesNotMatch(signature, /sub|filledBy|portal/i, "화면이 보낸 채운 사람을 받고 있다");
  });

  test("㉠ 세션의 사람으로 포털 번호를 읽어 그대로 통로에 넘긴다", () => {
    assert.match(fillAction, /const sub = await getSsoSubjectForUser\(actingUser\.id\);/);
    assert.match(fillAction, /if \(!sub\) return \{ ok: false, message: NO_PORTAL_ID_MESSAGE \};/);
    assert.match(fillAction, /filledBy: \{ sub, name: actingUser\.name \}/);
    assert.doesNotMatch(fillAction, /sub: input\./, "화면이 보낸 번호를 싣는 길이 남아 있다");
  });

  test("㉡ 🔴 보낸 글자를 **그대로** 넘긴다 — 다듬거나 미리 거르지 않는다", () => {
    assert.match(fillAction, /customerName: input\.customerName,/);
    // 🔴 여기서 길이·`-`·빈 값을 재면 자가 두 벌이 된다. 그 말은 저쪽이 한다.
    assert.doesNotMatch(fillAction, /\.trim\(\)/, "글자를 손보고 있다");
    assert.doesNotMatch(fillAction, /length >|200|DASH|비어 있습니다/, "내용 규칙을 여기서 다시 적었다");
  });

  test("㉡ 🔴 **모양**은 잰다 — 번호가 주소에 박히기 때문이다", () => {
    assert.match(fillAction, /if \(!Number\.isInteger\(input\.no\) \|\| input\.no < 1\)/);
    assert.match(fillAction, /typeof input\.customerName !== "string"/);
  });

  test("㉢ 올리는 쪽과 **같은 권한 축**을 액션이 직접 묻는다", () => {
    assert.match(fillAction, /await hasPermission\(actingUser, "inventory\.requests", "WRITE"\)/);
    assert.doesNotMatch(fillAction, /role ===|roleCode|"ADMIN"/);
  });

  test("로그인·승인·저장 모드를 거친 뒤에야 권한을 묻고, 권한 뒤에야 통로를 부른다", () => {
    const authSource = fillAction.indexOf('getAuthSource() !== "database"');
    const session = fillAction.indexOf("await readSession()");
    const approved = fillAction.indexOf('session.approvalStatus !== "APPROVED"');
    const permission = fillAction.indexOf("hasPermission(actingUser");
    const call = fillAction.indexOf("return fillInventoryPartCustomerName({");
    assert.ok(authSource >= 0 && session > authSource && approved > session && permission > approved);
    assert.ok(call > permission, "권한을 묻기 전에 재고 자료를 고치러 간다");
  });

  test("🔵 수리 건 id 를 받지 않는다 — 부품은 건에 매이지 않은 공용 자료다", () => {
    // 받아 봐야 아무것도 가릴 수 없고, 받는 칸이 있으면 언젠가 그것으로 뭔가를 가린다고
    // 착각하게 된다(거두기는 「이 건의 신청인가」를 재야 해서 받는다 — 거기는 뜻이 있다).
    const signature = fillAction.slice(0, fillAction.indexOf("): Promise<"));
    assert.doesNotMatch(signature, /repairCaseId/);
  });

  test("🔴 이 통로는 **채우기만** 한다 — 지우거나 덮어쓰는 길을 만들지 않았다", () => {
    assert.doesNotMatch(source, /deletePart|updatePart|customerName: ""/);
    assert.equal(
      (source.match(/fillInventoryPartCustomerName\(/g) ?? []).length,
      1,
      "재고 자료를 고치러 가는 자리가 하나가 아니다 — 울타리를 안 거치는 길이 생겼다"
    );
  });
});
