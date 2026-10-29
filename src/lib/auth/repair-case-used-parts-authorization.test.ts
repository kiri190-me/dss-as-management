import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  USED_PARTS_CASE_LOCKED_MESSAGE,
  USED_PARTS_INVENTORY_UNREACHABLE_MESSAGE,
  USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
  USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE,
  hasUsedPartsPartRequestHistory,
  isUsedPartsBlockedByShipmentLock,
  resolveUsedPartsWriteGate,
  resolveUsedPartsWriteGateWithInventory,
} from "./repair-case-used-parts-authorization";
import {
  parseInventoryStockRequestsResponse,
  resolveInventoryIssuedPartsTrace,
  type InventoryIssuedPartsTrace,
} from "@/lib/domain/inventory-gateway";
import { baselineLeafLevel } from "./permission-baseline";
import { isPermissionLeafKey, isSettingsEnforced, selectableLevelsOfLeaf } from "./permission-features";
import { ROLE_CODES, roleLabels, type Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 「사용 부품」 칸의 규칙 셋 (B-2 의 둘 + 권한)
 * ============================================================================
 * 사용자가 정한 것은 이 표 둘이다.
 *
 * ① 누가 적을 수 있나 — 2026-09-17 부터 **[역할별 접근 권한] 설정이 정한다.**
 *    코드의 역할 목록은 걷어냈고, 아래 표는 그 설정의 **기본값**이다
 *    (permission-baseline.ts 의 `repairCases.usedParts`).
 *
 *   SUPER_ADMIN · ADMIN · AS_ENGINEER  →  쓰기
 *   SALES · INVENTORY_MANAGER          →  없음
 *
 * ② 어느 건에 적을 수 있나 (권한과 무관한 **건의 사정** — 설정으로 빼지 않는다)
 *
 *   반출 이력   출하 잠금   가져온 건    →  적을 수 있나
 *   ─────────   ─────────   ──────────      ────────────
 *      있음        -            -           아니오 (PART_REQUEST_HISTORY_EXISTS)
 *      없음      안 걸림        -           예
 *      없음      걸림         아니오        아니오 (CASE_LOCKED)
 *      없음      걸림          예           예        ← 이 칸을 만든 까닭
 *
 * 그 두 표를 여기서 칸마다 전부 못 박는다. 서버 액션도 mutation 도 조회도 이 함수
 * 하나를 부르므로, 이 시험이 곧 세 곳의 시험이다.
 * ============================================================================
 */

/** 권한을 적지 않은 시험은 「적을 수 있는 사람」을 뜻한다 — ② 표만 보는 시험이다. */
function gate(facts: {
  canWriteUsedParts?: boolean;
  hasPartRequestHistory: boolean;
  isShipmentLocked: boolean;
  isLegacyImportedCase: boolean;
}) {
  return resolveUsedPartsWriteGate({
    canWriteUsedParts: facts.canWriteUsedParts ?? true,
    hasPartRequestHistory: facts.hasPartRequestHistory,
    isShipmentLocked: facts.isShipmentLocked,
    isLegacyImportedCase: facts.isLegacyImportedCase,
  });
}

/**
 * 🔴 사용자가 정한 표 ① 을 **시험이 따로 한 벌 적는다.** 제품 코드의 목록을
 * 가져다 쓰면 그 목록이 바뀌어도 시험이 함께 따라 바뀌어 아무것도 못 잡는다.
 * `Record<Role, ...>` 이므로 역할이 하나 늘면 tsc 가 먼저 멈춘다 — 역할이 조용히
 * 빠질 길이 없다.
 */
const CAN_WRITE_BY_ROLE: Record<Role, boolean> = {
  SUPER_ADMIN: true,
  ADMIN: true,
  AS_ENGINEER: true,
  SALES: false,
  INVENTORY_MANAGER: false,
};

describe("사용 부품 — 누가 적을 수 있나 (설정이 정한다)", () => {
  test("🔴 기본값이 종전 동작 그대로다 — 다섯 역할을 하나도 빠뜨리지 않는다", () => {
    assert.equal(ROLE_CODES.length, 5, "역할이 늘거나 줄면 이 표부터 다시 정해야 한다");
    assert.ok(isPermissionLeafKey("repairCases.usedParts"), "설정 노드가 있어야 한다");

    for (const role of ROLE_CODES) {
      // 아무도 설정을 만지지 않았을 때의 실효 권한 = 기본값. 이 칸을 설정으로
      // 옮기기 전 코드가 판정하던 것과 같아야 한다.
      assert.equal(
        baselineLeafLevel("repairCases.usedParts", role),
        CAN_WRITE_BY_ROLE[role] ? "WRITE" : "NONE",
        `${role} 의 기본값`
      );
    }
  });

  test("🔴 설정이 유일한 관문이다 — 넓히면 열리고 좁히면 막힌다", () => {
    // 설정을 넓힌 사람(예: 영업에게 쓰기를 준 경우)에게는 실제로 열린다.
    assert.deepEqual(
      gate({
        canWriteUsedParts: true,
        hasPartRequestHistory: false,
        isShipmentLocked: false,
        isLegacyImportedCase: false,
      }),
      { ok: true }
    );

    // 좁힌 사람에게는 막힌다 — 기본값이 쓰기였던 역할이라도 마찬가지다.
    const narrowed = gate({
      canWriteUsedParts: false,
      hasPartRequestHistory: false,
      isShipmentLocked: false,
      isLegacyImportedCase: false,
    });
    assert.equal(narrowed.ok, false);
    if (narrowed.ok) throw new Error("unreachable");
    assert.equal(narrowed.code, "ROLE_NOT_ALLOWED");
    assert.equal(narrowed.message, USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE);
  });

  test("🔴 노드는 「쓴다 / 못 쓴다」 둘뿐이다 — 고를 수 없는 칸을 내밀지 않는다", () => {
    assert.deepEqual(selectableLevelsOfLeaf("repairCases.usedParts"), ["NONE", "WRITE"]);
  });

  test("🔴 설정이 최종 판정인 노드로 표시돼 있다 — 화면이 사실대로 말한다", () => {
    // 여기 없으면 권한 설정 화면이 "아직 코드가 최종 판정"이라고 말한다. 반대로
    // 역할 함수를 남겨 둔 채 넣으면 "넓히면 열립니다"가 거짓말이 된다.
    assert.equal(isSettingsEnforced("repairCases.usedParts"), true);
  });

  test("🔴 권한을 물을 수 없으면 막는다 — 닫히는 쪽으로 떨어진다", () => {
    // 계정을 읽지 못한 요청(삭제 · 정지 · 세션 끊김)은 부르는 쪽이 false 를 넘긴다.
    const result = gate({
      canWriteUsedParts: false,
      hasPartRequestHistory: false,
      isShipmentLocked: false,
      isLegacyImportedCase: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "ROLE_NOT_ALLOWED");
  });

  test("🔴 권한 없는 사람은 건의 사정과 무관하게 막힌다 — 그리고 까닭이 권한이다", () => {
    for (const hasPartRequestHistory of [false, true]) {
      for (const isShipmentLocked of [false, true]) {
        for (const isLegacyImportedCase of [false, true]) {
          const result = gate({
            canWriteUsedParts: false,
            hasPartRequestHistory,
            isShipmentLocked,
            isLegacyImportedCase,
          });
          assert.equal(result.ok, false);
          if (result.ok) throw new Error("unreachable");
          // 🔴 「반출 이력 때문」이라고 말하면 거짓 안내다 — 요청서를 지워도 이
          // 사람은 여전히 적을 수 없다.
          assert.equal(result.code, "ROLE_NOT_ALLOWED", `${hasPartRequestHistory}`);
        }
      }
    }
  });

  test("🔴 거절 사유 넷이 서로 다른 안내다 — 사람이 할 일이 저마다 다르다", () => {
    const messages = [
      USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE,
      USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
      USED_PARTS_CASE_LOCKED_MESSAGE,
      // 🔴 2026-10-29 에 넷째가 생겼다 — 「못 물어봤다」. 셋과 **같은 말이면 안 된다**
      //    (특히 「권한이 없습니다」와 섞이면 사람이 관리자를 찾아가고, 그 사람도 못 연다).
      USED_PARTS_INVENTORY_UNREACHABLE_MESSAGE,
    ];
    assert.equal(new Set(messages).size, 4, "네 문구가 겹치지 않는다");
    for (const message of messages) {
      assert.ok(message.trim().length > 0);
    }

    // 같은 건, 같은 사정 — 사람만 바꾸면 안내가 바뀐다.
    const locked = { hasPartRequestHistory: false, isShipmentLocked: true, isLegacyImportedCase: false };
    const permitted = gate({ canWriteUsedParts: true, ...locked });
    const denied = gate({ canWriteUsedParts: false, ...locked });
    assert.equal(permitted.ok, false);
    assert.equal(denied.ok, false);
    if (permitted.ok || denied.ok) throw new Error("unreachable");
    assert.equal(permitted.message, USED_PARTS_CASE_LOCKED_MESSAGE);
    assert.equal(denied.message, USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE);
  });

  /**
   * 🔴 **거절 문구에 역할 이름이 박혀 있지 않다** (2026-09-17)
   *
   * 위 시험들은 전부 `assert.equal(result.message, USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE)`
   * — **상수를 상수와 견준다.** 그래서 문구를 아무렇게 고쳐도 하나도 안 잡힌다.
   * 실제로 예전 문구 「사용 부품은 A/S 엔지니어와 관리자만 적을 수 있습니다」는 이
   * 칸의 판정이 [역할별 접근 권한] 설정으로 옮겨 온 순간 **거짓말이 되었는데도**
   * 시험이 전부 초록이었다 — 최고관리자가 영업에게 열어 주면 영업도 적을 수 있는데
   * 화면은 여전히 둘만 적을 수 있다고 말한다.
   *
   * 그래서 여기서 그 자리를 지킨다: **누가 적을 수 있는가를 말하는 앞부분**에는
   * roleLabels 다섯 중 하나도 나오지 않아야 한다. `ROLE_CODES` 를 돌므로 역할이
   * 하나 늘면 그 이름표도 저절로 함께 막힌다.
   *
   * 선례를 그대로 따른 것이다 — domain/quote-document-support.test.ts 가 같은
   * 방식으로 「거절 문장에 견적서 종류 이름이 박혀 있지 않다」를 quoteKindLabels
   * 전체로 확인한다.
   *
   * 🔴 뒤 문장의 「관리자」 하나만 예외다. 그것은 *적을 수 있는 역할*이 아니라
   * **권한을 열어 줄 사람**(요청을 받을 곳)이라 설정을 어떻게 바꿔도 틀리지 않는다.
   * 그 한 문장을 떼어 낸 나머지를 보는 까닭이 이것이다.
   */
  test("🔴 거절 문구가 역할 이름을 말하지 않는다 — 설정을 넓혀도 거짓말이 되지 않는다", () => {
    const REQUEST_SENTENCE = "관리자에게 요청해 주세요.";
    assert.ok(
      USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE.endsWith(REQUEST_SENTENCE),
      "요청할 곳을 알려 주지 않으면 거절당한 사람이 다음에 할 일을 모른다"
    );

    // 요청처 한 문장을 떼어 낸 나머지 = 「누가 적을 수 있는가」를 말하는 자리.
    const claim = USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE.slice(0, -REQUEST_SENTENCE.length);
    assert.ok(claim.trim().length > 0, "거절 사유 자체는 말해야 한다");

    for (const role of ROLE_CODES) {
      assert.ok(
        !claim.includes(roleLabels[role]),
        `거절 문구가 「${roleLabels[role]}」 를 박아 두었다 — 설정을 넓히는 날 거짓말이 된다`
      );
    }

    // 업무 규칙 셋은 애초에 사람의 성질을 말하지 않는다 — 역할 이름이 아예 없어야 한다.
    for (const message of [
      USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
      USED_PARTS_CASE_LOCKED_MESSAGE,
      USED_PARTS_INVENTORY_UNREACHABLE_MESSAGE,
    ]) {
      for (const role of ROLE_CODES) {
        assert.ok(
          !message.includes(roleLabels[role]),
          `건의 사정을 말하는 문구에 「${roleLabels[role]}」 가 들어갔다`
        );
      }
    }
  });

  test("🔴 권한을 넓혀도 B-2 의 두 규칙은 그대로다 — 업무 규칙은 설정으로 빠지지 않았다", () => {
    assert.deepEqual(
      gate({
        canWriteUsedParts: true,
        hasPartRequestHistory: false,
        isShipmentLocked: true,
        isLegacyImportedCase: true,
      }),
      { ok: true },
      "잠긴 가져온 건에는 적을 수 있다"
    );
    const blocked = gate({
      canWriteUsedParts: true,
      hasPartRequestHistory: true,
      isShipmentLocked: false,
      isLegacyImportedCase: false,
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) throw new Error("unreachable");
    assert.equal(blocked.code, "PART_REQUEST_HISTORY_EXISTS", "반출 이력은 여전히 막는다");
  });
});

describe("사용 부품 — 적을 수 있는 건인가", () => {
  test("잠금도 이력도 없으면 평소대로 적을 수 있다", () => {
    assert.deepEqual(
      gate({ hasPartRequestHistory: false, isShipmentLocked: false, isLegacyImportedCase: false }),
      { ok: true }
    );
    assert.deepEqual(
      gate({ hasPartRequestHistory: false, isShipmentLocked: false, isLegacyImportedCase: true }),
      { ok: true }
    );
  });

  test("🔴 반출 이력이 있으면 거절한다 — 잠금·가져오기와 무관하게", () => {
    for (const isShipmentLocked of [false, true]) {
      for (const isLegacyImportedCase of [false, true]) {
        const result = gate({ hasPartRequestHistory: true, isShipmentLocked, isLegacyImportedCase });
        assert.equal(result.ok, false);
        if (result.ok) throw new Error("unreachable");
        assert.equal(result.code, "PART_REQUEST_HISTORY_EXISTS");
        assert.equal(result.message, USED_PARTS_PART_REQUEST_HISTORY_MESSAGE);
      }
    }
  });

  test("🔴 출하 잠금 + 가져온 건 → 적을 수 있다", () => {
    assert.deepEqual(
      gate({ hasPartRequestHistory: false, isShipmentLocked: true, isLegacyImportedCase: true }),
      { ok: true }
    );
  });

  test("🔴 출하 잠금 + 가져온 건이 아님 → 막힌다", () => {
    const result = gate({
      hasPartRequestHistory: false,
      isShipmentLocked: true,
      isLegacyImportedCase: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "CASE_LOCKED");
    assert.equal(result.message, USED_PARTS_CASE_LOCKED_MESSAGE);
  });

  test("🔴 잠금을 모든 건에서 푸는 것이 아니다 — 가져온 건에만 푼다", () => {
    assert.equal(isUsedPartsBlockedByShipmentLock(true, false), true);
    assert.equal(isUsedPartsBlockedByShipmentLock(true, true), false);
    // 잠기지 않은 건은 가져온 건이든 아니든 이 규칙에 걸리지 않는다.
    assert.equal(isUsedPartsBlockedByShipmentLock(false, false), false);
    assert.equal(isUsedPartsBlockedByShipmentLock(false, true), false);
  });

  test("둘 다 걸리면 반출 이력을 먼저 말한다 — 더 쓸모 있는 안내다", () => {
    const result = gate({
      hasPartRequestHistory: true,
      isShipmentLocked: true,
      isLegacyImportedCase: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PART_REQUEST_HISTORY_EXISTS");
  });
});

/**
 * ============================================================================
 * 🔴 반출 흔적을 **두 시스템에서** 본다 (2026-10-29)
 * ============================================================================
 * 옛 표(`inventory_part_requests`)는 2026-10-16 부터 한 줄도 늘지 않고, 새 반출 신청은
 * 전부 재고 관리로 올라간다. 그래서 **옛 표만 보던 동안 반출이 끝난 건에도 이 칸이
 * 열려 있었다** — 같은 부품을 손으로 또 적으면 [고장 부품] 그래프가 두 번 센다.
 *
 * 🔴 재고 관리 쪽이 재는 것은 **「실제로 나간 것이 있나」**다(2026-10-29 사용자 결정) —
 *    「신청이 있나」가 아니다. 반려·취소만 되고 한 개도 안 나간 건은 **열어 준다**
 *    (`domain/inventory-gateway.ts` 의 `resolveInventoryIssuedPartsTrace`). 이 파일이
 *    받는 값은 이미 그 자로 잰 답이라, 여기서는 **셋 갈래의 쓰임**만 못 박는다.
 *
 * 여기서 못 박는 표가 이것이다 —
 *
 *   옛 표   재고 관리(나간 것)  →  적을 수 있나
 *   ─────   ────────────────      ────────────
 *   없음    없다                  예   ← 반려·취소만 된 건이 여기로 떨어진다
 *   없음    있다                  아니오 (PART_REQUEST_HISTORY_EXISTS)  ← 2026-10-29 에 메운 구멍
 *   있음    없다                  아니오 (PART_REQUEST_HISTORY_EXISTS)  ← 그 시절 건
 *   있음    있다                  아니오 (PART_REQUEST_HISTORY_EXISTS)
 *   없음    **모른다**            아니오 (INVENTORY_UNREACHABLE)        ← 다른 말이어야 한다
 *   있음    **모른다**            아니오 (PART_REQUEST_HISTORY_EXISTS)  ← 더 확실한 쪽
 * ============================================================================
 */
describe("사용 부품 — 반출 흔적은 두 시스템에 나뉘어 있다", () => {
  const PRESENT: InventoryIssuedPartsTrace = { kind: "present", issuedLineCount: 1 };
  const ABSENT: InventoryIssuedPartsTrace = { kind: "absent" };
  const UNKNOWN: InventoryIssuedPartsTrace = { kind: "unknown", reason: "api_closed" };

  /** 권한 · 잠금을 적지 않은 시험은 「적을 수 있는 사람 + 평범한 건」을 뜻한다. */
  function gateWith(facts: {
    canWriteUsedParts?: boolean;
    hasLegacyPartRequest: boolean;
    inventoryIssuedPartsTrace: InventoryIssuedPartsTrace;
    isShipmentLocked?: boolean;
    isLegacyImportedCase?: boolean;
  }) {
    return resolveUsedPartsWriteGateWithInventory({
      canWriteUsedParts: facts.canWriteUsedParts ?? true,
      hasLegacyPartRequest: facts.hasLegacyPartRequest,
      inventoryIssuedPartsTrace: facts.inventoryIssuedPartsTrace,
      isShipmentLocked: facts.isShipmentLocked ?? false,
      isLegacyImportedCase: facts.isLegacyImportedCase ?? false,
    });
  }

  test("🔴 둘 중 하나라도 있으면 흔적이 있다 — 네 칸을 하나도 빠뜨리지 않는다", () => {
    assert.equal(hasUsedPartsPartRequestHistory(false, ABSENT), false);
    assert.equal(hasUsedPartsPartRequestHistory(false, PRESENT), true, "재고 관리 쪽만 있어도");
    assert.equal(hasUsedPartsPartRequestHistory(true, ABSENT), true, "옛 표 쪽만 있어도");
    assert.equal(hasUsedPartsPartRequestHistory(true, PRESENT), true);
    // 🔴 「모른다」는 **흔적이 아니다** — 여기서 참으로 세면 화면이 「부품 요청에서
    //    잡힙니다」라고 근거 없는 말을 한다. 막는 일은 게이트가 따로 한다.
    assert.equal(hasUsedPartsPartRequestHistory(false, UNKNOWN), false);
    assert.equal(hasUsedPartsPartRequestHistory(true, UNKNOWN), true, "옛 표 쪽은 그대로 센다");
  });

  test("🔴 재고 관리에만 흔적이 있어도 막힌다 — 2026-10-16 뒤의 건이 그렇다", () => {
    const result = gateWith({ hasLegacyPartRequest: false, inventoryIssuedPartsTrace: PRESENT });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PART_REQUEST_HISTORY_EXISTS");
    assert.equal(result.message, USED_PARTS_PART_REQUEST_HISTORY_MESSAGE);
  });

  test("🔴 옛 표에만 흔적이 있어도 막힌다 — 옛 판정을 걷어내지 않았다", () => {
    const result = gateWith({ hasLegacyPartRequest: true, inventoryIssuedPartsTrace: ABSENT });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PART_REQUEST_HISTORY_EXISTS");
  });

  test("둘 다 없으면 적을 수 있다 — 종전 그대로", () => {
    assert.deepEqual(
      gateWith({ hasLegacyPartRequest: false, inventoryIssuedPartsTrace: ABSENT }),
      { ok: true }
    );
  });

  test("🔴 못 물어봤으면 막힌다 — 그리고 「흔적이 있어서」와 다른 말이다", () => {
    const result = gateWith({ hasLegacyPartRequest: false, inventoryIssuedPartsTrace: UNKNOWN });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVENTORY_UNREACHABLE");
    assert.equal(result.message, USED_PARTS_INVENTORY_UNREACHABLE_MESSAGE);
    // 🔴 「모른다」를 「없다」로 눕히면 이 단언이 깨진다 — 그 순간 이미 반출된 부품을
    //    손으로 또 적는 길이 열린다.
    assert.notEqual(result.message, USED_PARTS_PART_REQUEST_HISTORY_MESSAGE);
    assert.notEqual(result.message, USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE);
  });

  test("🔴 못 물어봤어도 **더 확실한 까닭**이 먼저 나온다 — 권한 · 흔적 · 잠금", () => {
    // 권한이 없는 사람에게 「재고 관리에 물어볼 수 없어서」라고 하면 거짓 안내다 —
    // 저쪽이 돌아와도 그 사람은 여전히 못 적는다.
    const denied = gateWith({
      canWriteUsedParts: false,
      hasLegacyPartRequest: false,
      inventoryIssuedPartsTrace: UNKNOWN,
    });
    assert.equal(denied.ok, false);
    if (denied.ok) throw new Error("unreachable");
    assert.equal(denied.code, "ROLE_NOT_ALLOWED");

    // 옛 표에 흔적이 있으면 그쪽이 더 확실하고 더 쓸모 있는 안내다(기다려도 안 열린다).
    const legacy = gateWith({ hasLegacyPartRequest: true, inventoryIssuedPartsTrace: UNKNOWN });
    assert.equal(legacy.ok, false);
    if (legacy.ok) throw new Error("unreachable");
    assert.equal(legacy.code, "PART_REQUEST_HISTORY_EXISTS");

    // 잠긴 건(가져온 건이 아님)도 마찬가지다.
    const locked = gateWith({
      hasLegacyPartRequest: false,
      inventoryIssuedPartsTrace: UNKNOWN,
      isShipmentLocked: true,
    });
    assert.equal(locked.ok, false);
    if (locked.ok) throw new Error("unreachable");
    assert.equal(locked.code, "CASE_LOCKED");
  });

  test("🔴 업무 규칙 둘은 그대로다 — 재고 관리의 답이 잠금을 풀지 않는다", () => {
    // 잠긴 가져온 건은 여전히 열린다(이 칸을 만든 까닭).
    assert.deepEqual(
      gateWith({
        hasLegacyPartRequest: false,
        inventoryIssuedPartsTrace: ABSENT,
        isShipmentLocked: true,
        isLegacyImportedCase: true,
      }),
      { ok: true }
    );
    // 그 건이라도 재고 관리에 흔적이 있으면 막힌다.
    const withTrace = gateWith({
      hasLegacyPartRequest: false,
      inventoryIssuedPartsTrace: PRESENT,
      isShipmentLocked: true,
      isLegacyImportedCase: true,
    });
    assert.equal(withTrace.ok, false);
    if (withTrace.ok) throw new Error("unreachable");
    assert.equal(withTrace.code, "PART_REQUEST_HISTORY_EXISTS");
  });

  test("🔴 감싸개일 뿐이다 — 차례를 베껴 적지 않았다", () => {
    // 재고 관리 쪽 답을 빼면 **옛 함수와 글자 하나 다르지 않은 답**이 나와야 한다.
    for (const canWriteUsedParts of [false, true]) {
      for (const hasLegacyPartRequest of [false, true]) {
        for (const isShipmentLocked of [false, true]) {
          for (const isLegacyImportedCase of [false, true]) {
            assert.deepEqual(
              resolveUsedPartsWriteGateWithInventory({
                canWriteUsedParts,
                hasLegacyPartRequest,
                inventoryIssuedPartsTrace: ABSENT,
                isShipmentLocked,
                isLegacyImportedCase,
              }),
              resolveUsedPartsWriteGate({
                canWriteUsedParts,
                hasPartRequestHistory: hasLegacyPartRequest,
                isShipmentLocked,
                isLegacyImportedCase,
              }),
              `${canWriteUsedParts}/${hasLegacyPartRequest}/${isShipmentLocked}/${isLegacyImportedCase}`
            );
          }
        }
      }
    }
  });
});

/**
 * ============================================================================
 * 🔴 재고 관리 쪽 잣대는 **「실제로 나간 것」**이다 (2026-10-29 사용자 결정)
 * ============================================================================
 * 2026-10-29 **아침까지는** 「신청이 한 건이라도 있으면 막는다」였다. 그 잣대는 **반려·취소만
 * 되고 한 개도 안 나간 건**까지 막았고, 그러면 그 건의 부품은 —
 *   · [고장 부품] 그래프의 반출 입력에 **안 들어가고**(그쪽은 `issued >= 1` 인 줄만 센다), ·
 *   · [사용 부품] 칸에 **손으로도 못 적는다.**
 * 즉 **어디에도 안 잡히고 적을 자리도 없는 구멍**이 된다. A/S 옛 표 쪽 판정이 `REJECTED` ·
 * `CANCELLED` 를 빼는 까닭이 처음부터 그 구멍이었고, 이제 **두 쪽 잣대가 같아졌다.**
 *
 * 🔵 **트레이스를 손으로 지어내지 않는다** — 저쪽 응답(JSON)을 제품 코드의 파서와 제품
 *    코드의 판정(`resolveInventoryIssuedPartsTrace`)에 그대로 태운다. 손으로 지은 트레이스만
 *    재면 「판정 함수가 그 응답에서 무엇을 뽑는가」가 영영 안 잡힌다.
 * ============================================================================
 */
describe("사용 부품 — 재고 관리 쪽은 「실제로 나간 것」만 센다", () => {
  /** 🔵 **가짜 값만 쓴다** — 인수번호 · 품명 · 요청 번호 전부 지어낸 것이다. */
  function traceOf(
    requests: readonly {
      status: string;
      lines: readonly { name: string; quantity: number; issued: number }[];
    }[]
  ): InventoryIssuedPartsTrace {
    const parsed = parseInventoryStockRequestsResponse({
      count: requests.length,
      requests: requests.map((request, index) => ({
        requestKey: `AS-FAKE-${index + 1}`,
        id: `fake-request-${index + 1}`,
        intakeNumber: "D990101",
        status: { code: request.status, label: request.status },
        closed: false,
        requestedAt: "2099-01-01T00:00:00.000Z",
        lines: request.lines.map((line, lineIndex) => ({
          no: lineIndex + 1,
          name: line.name,
          quantity: line.quantity,
          issued: line.issued,
        })),
      })),
      notFound: [],
    });
    // 🔵 **표본이 진짜 그 표본인지** 먼저 센다 — 파서가 줄을 버리면 아래 단언이 공짜로
    //    통과한다(줄이 0개면 무엇을 세든 「안 나갔다」다).
    assert.ok(parsed, "표본이 저쪽 응답 모양이어야 한다");
    assert.equal(parsed.length, requests.length);
    assert.deepEqual(
      parsed.map((request) => request.lines.map((line) => line.issued)),
      requests.map((request) => request.lines.map((line) => line.issued)),
      "불출 수량이 파서를 지나며 사라지지 않았다"
    );
    return resolveInventoryIssuedPartsTrace({ status: "ok", value: parsed });
  }

  function gateFor(trace: InventoryIssuedPartsTrace) {
    return resolveUsedPartsWriteGateWithInventory({
      canWriteUsedParts: true,
      hasLegacyPartRequest: false,
      inventoryIssuedPartsTrace: trace,
      isShipmentLocked: false,
      isLegacyImportedCase: false,
    });
  }

  test("🔴 반려·취소만 되고 한 개도 안 나갔으면 **적을 수 있다**", () => {
    const trace = traceOf([
      { status: "REJECTED", lines: [{ name: "가짜부품-ㄱ", quantity: 2, issued: 0 }] },
      { status: "CANCELLED", lines: [{ name: "가짜부품-ㄴ", quantity: 1, issued: 0 }] },
    ]);
    assert.deepEqual(trace, { kind: "absent" }, "나간 줄이 없으니 「없다」다");
    // 🔴 **「모른다」가 아니다** — 저쪽은 멀쩡히 답했고, 답의 내용이 「안 나갔다」다.
    assert.notEqual(trace.kind, "unknown");
    assert.equal(hasUsedPartsPartRequestHistory(false, trace), false);
    assert.deepEqual(gateFor(trace), { ok: true });
  });

  test("🔴 한 줄이라도 나갔으면 막힌다 — **요청 상태가 무엇이든**", () => {
    // 🔵 여덟 상태를 다 돌 까닭이 없다. 못 박을 것은 「상태를 안 본다」이므로, 나간 줄이
    //    있는데도 상태만 보면 빠질 법한 둘(취소됨 · 반려됨)을 **일부러** 넣는다.
    const statuses = ["CONFIRMED", "PARTIAL", "PENDING", "CANCELLED", "REJECTED"];
    assert.equal(statuses.length, 5, "표본이 비면 이 시험은 공짜로 통과한다");
    for (const status of statuses) {
      const trace = traceOf([{ status, lines: [{ name: "가짜부품-ㄷ", quantity: 1, issued: 1 }] }]);
      assert.deepEqual(trace, { kind: "present", issuedLineCount: 1 }, status);
      assert.equal(hasUsedPartsPartRequestHistory(false, trace), true, status);
      const result = gateFor(trace);
      assert.equal(result.ok, false, status);
      if (result.ok) throw new Error("unreachable");
      assert.equal(result.code, "PART_REQUEST_HISTORY_EXISTS", status);
      assert.equal(result.message, USED_PARTS_PART_REQUEST_HISTORY_MESSAGE);
    }
  });

  test("🔴 「일부 나감」 — 한 신청 안에 섞여 있어도 나간 줄이 있으면 막힌다", () => {
    const trace = traceOf([
      {
        status: "PARTIAL",
        lines: [
          { name: "가짜부품-ㄹ", quantity: 3, issued: 0 },
          { name: "가짜부품-ㅁ", quantity: 2, issued: 2 },
        ],
      },
    ]);
    // 🔴 **줄 수**다(나간 수량의 합이 아니다) — 2개가 나간 한 줄이라 1 이다.
    assert.deepEqual(trace, { kind: "present", issuedLineCount: 1 });
    const result = gateFor(trace);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PART_REQUEST_HISTORY_EXISTS");
  });

  test("🔴 아직 안 나간 신청만 있으면 적을 수 있다 — 기다리는 중인 건", () => {
    // 🔵 이 갈래가 2026-10-29 **아침과 달라진** 자리다. 종전에는 「신청이 있다」로 막혔다.
    const trace = traceOf([
      { status: "PENDING", lines: [{ name: "가짜부품-ㅂ", quantity: 1, issued: 0 }] },
    ]);
    assert.deepEqual(trace, { kind: "absent" });
    assert.deepEqual(gateFor(trace), { ok: true });
  });

  test("🔴 못 물어봤으면 여전히 막힌다 — 그 결정은 안 바뀌었다", () => {
    const trace = resolveInventoryIssuedPartsTrace({ status: "unreachable", reason: "timeout" });
    assert.deepEqual(trace, { kind: "unknown", reason: "timeout" });
    const result = gateFor(trace);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "INVENTORY_UNREACHABLE");
    assert.equal(result.message, USED_PARTS_INVENTORY_UNREACHABLE_MESSAGE);
  });

  test("🔴 옛 표에만 흔적이 있으면 재고 관리가 「안 나갔다」고 해도 막힌다", () => {
    const trace = traceOf([
      { status: "REJECTED", lines: [{ name: "가짜부품-ㅅ", quantity: 1, issued: 0 }] },
    ]);
    assert.deepEqual(trace, { kind: "absent" });
    const result = resolveUsedPartsWriteGateWithInventory({
      canWriteUsedParts: true,
      hasLegacyPartRequest: true,
      inventoryIssuedPartsTrace: trace,
      isShipmentLocked: false,
      isLegacyImportedCase: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "PART_REQUEST_HISTORY_EXISTS");
  });
});

describe("사용 부품 — 판정이 한 벌뿐이다", () => {
  const repoUrl = new URL("../../../", import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, repoUrl), "utf8");
  const strip = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const queryCode = strip(read("src/lib/db/queries/repair-case-used-parts.ts"));
  const mutationCode = strip(read("src/lib/db/mutations/repair-case-used-parts.ts"));
  const sectionCode = strip(read("src/components/repair-cases/detail/UsedPartsSection.tsx"));
  const actionCode = strip(read("src/lib/server/actions/repair-case-used-parts.ts"));
  const formCode = strip(read("src/components/repair-cases/detail/edit/UsedPartsEditForm.tsx"));
  const pageCode = strip(read("src/app/(app)/repair-cases/[id]/page.tsx"));

  test("🔴 반출 이력 판정은 조회 모듈 한 곳에만 있다 — 저장 쪽이 그것을 가져다 쓴다", () => {
    assert.match(queryCode, /export function livePartRequestCondition\(/);
    assert.match(queryCode, /export async function hasLivePartRequest\(/);
    assert.match(
      mutationCode.replace(/\s+/g, " "),
      /hasLivePartRequest,[\s\S]*?\} from "\.\.\/queries\/repair-case-used-parts";/
    );
    // 저장 쪽이 상태 목록을 제 손으로 다시 적지 않는다.
    assert.ok(
      !/REJECTED|CANCELLED|inventoryPartRequests/.test(mutationCode),
      "반출 이력 판정을 두 벌로 적지 않는다"
    );
  });

  /**
   * 🔴 **트랜잭션 안에서 바깥 통로를 부르지 않는다** (2026-10-29)
   *
   * `saveRepairCaseUsedParts` 는 첫 줄부터 마지막 줄까지 `db.transaction` 안이다. 거기서
   * 재고 관리를 두드리면 `SELECT … FOR UPDATE` 로 잡아 둔 행 잠금이 **저쪽 응답만큼**
   * 길어진다(읽기 제한 5초). 그래서 답은 **값으로 받아서** 들어온다.
   *
   * 🔵 시험으로 「부르지 않는다」를 재기 어려워 **구조로** 못 박는다 — ① 통로 모듈을
   *    import 하는 줄이 없고 ② 받는 칸의 타입이 **값**이다(약속도 함수도 아니다).
   *    둘 중 하나라도 깨지면 여기서 멈춘다.
   */
  test("🔴 저장은 트랜잭션 안에서 재고 관리를 부르지 않는다 — 답을 받아서 들어간다", () => {
    /* 🔴 **probe 이름을 하나만 적지 않는다**(2026-10-29) — 2026-10-29 에 둘이 되었고
       (`probeInventoryPartRequestTrace` · `probeInventoryIssuedPartsTrace`), 이름을 하나만
       막아 두면 **다른 하나로 트랜잭션 안에서 부르는 줄**이 조용히 통과한다. */
    assert.ok(
      !/server\/inventory-gateway|probeInventory|fetch\(/.test(mutationCode),
      "mutation 이 트랜잭션 안에서 바깥 통로를 부르고 있다"
    );
    assert.match(
      mutationCode.replace(/\s+/g, " "),
      /issuedPartsTrace: InventoryIssuedPartsTrace;/,
      "받는 칸이 **이미 받아 온 값**이어야 한다(Promise 도 함수도 아니다)"
    );
    /* 🔴 **묻는 자는 「실제로 나갔나」 쪽이다**(2026-10-29 사용자 결정). 「요청이 있나」 쪽
       (`probeInventoryPartRequestTrace` — 연락서 이식 · 백필이 쓴다)을 여기에 끼우면
       반려·취소만 된 건이 다시 막힌다. */
    assert.match(
      actionCode.replace(/\s+/g, " "),
      /const issuedPartsTrace = await probeInventoryIssuedPartsTrace\(caseKey\.intakeNumber\);/
    );
    assert.ok(
      !/probeInventoryPartRequestTrace/.test(actionCode),
      "액션이 「요청이 있나」 쪽 자를 쓰고 있다 — 화면 쪽과 잣대가 갈린다"
    );
    const actionFlat = actionCode.replace(/\s+/g, " ");
    assert.ok(
      actionFlat.indexOf("probeInventoryIssuedPartsTrace(caseKey.intakeNumber)") <
        actionFlat.indexOf("saveRepairCaseUsedParts("),
      "트랜잭션을 열기 전에 물어야 한다"
    );
    // 🔴 액션은 **나르기만** 한다 — 받아 온 답을 가리거나 접지 않는다.
    assert.ok(
      !/kind === "unknown"|kind === "present"|kind === "absent"/.test(actionCode),
      "액션이 트레이스를 제 손으로 가리고 있다 — 판정이 두 벌이 된다"
    );
  });

  test("🔴 「가져온 건」 판정도 한 곳에만 있다 — 글자를 다시 적지 않는다", () => {
    assert.match(queryCode, /export function importedFromKyosanIntakeCondition\(/);
    assert.match(queryCode, /KYOSAN_INTAKE_LIST_SOURCE/);
    assert.match(
      queryCode.replace(/\s+/g, " "),
      /import \{ KYOSAN_INTAKE_LIST_SOURCE \} from "\.\/kyosan-intake-import";/
    );
    assert.ok(
      !/"KYOSAN_INTAKE_LIST"|'KYOSAN_INTAKE_LIST'/.test(queryCode),
      "상수를 가져다 쓴다 — 글자를 다시 적지 않는다"
    );
    assert.ok(
      !/LEGACY_IMPORT_STATE_SET/.test(mutationCode),
      "가져오기 판정을 두 벌로 적지 않는다"
    );
  });

  test("🔴 사용 부품용 역할 목록이 코드 어디에도 없다 — 설정이 유일한 관문이다", () => {
    // 인가 모듈 자신부터 비어 있어야 한다. 코드 목록과 설정을 둘 다 남기면
    // 권한 설정 화면이 "넓히면 실제로 열립니다"라고 거짓말을 한다.
    const authCode = strip(read("src/lib/auth/repair-case-used-parts-authorization.ts"));
    assert.ok(
      !/USED_PARTS_WRITE_ROLES|canRoleWriteUsedParts/.test(authCode),
      "걷어낸 역할 목록이 되살아났다"
    );

    const roleNames = /SUPER_ADMIN|AS_ENGINEER|INVENTORY_MANAGER|"ADMIN"|'ADMIN'|"SALES"|'SALES'/;
    const chain: [string, string][] = [
      ["repair-case-used-parts-authorization.ts", authCode],
      ["queries/repair-case-used-parts.ts", queryCode],
      ["mutations/repair-case-used-parts.ts", mutationCode],
      ["actions/repair-case-used-parts.ts", actionCode],
      ["UsedPartsSection.tsx", sectionCode],
      ["UsedPartsEditForm.tsx", formCode],
      ["repair-cases/[id]/page.tsx", pageCode],
    ];
    for (const [label, code] of chain) {
      assert.ok(!roleNames.test(code), `${label} 이 역할 이름을 적고 있다`);
      assert.ok(
        !/USED_PARTS_WRITE_ROLES|canRoleWriteUsedParts/.test(code),
        `${label} 이 걷어낸 역할 목록을 부르고 있다`
      );
    }

    // 🔴 그 목록이 마지막으로 남는 자리는 permission-baseline.ts 의 **기본값**
    // 하나뿐이고, 그것은 관문이 아니다(저장된 설정이 있으면 쓰이지 않는다).
    // export 하지 않으므로 밖에서 두 번째 관문으로 쓸 수 없다.
    const baselineCode = strip(read("src/lib/auth/permission-baseline.ts"));
    assert.match(baselineCode, /function writesUsedPartsByDefault\(role: Role\): boolean \{/);
    assert.ok(
      !/export function writesUsedPartsByDefault/.test(baselineCode),
      "기본값 함수를 export 하면 두 번째 관문이 된다"
    );
  });

  test("🔴 조회도 저장도 설정 노드 하나를 묻는다 — 같은 키다", () => {
    for (const [label, code] of [
      ["queries/repair-case-used-parts.ts", queryCode],
      ["mutations/repair-case-used-parts.ts", mutationCode],
    ] as const) {
      assert.match(
        code.replace(/\s+/g, " "),
        /hasPermission\([^)]*"repairCases\.usedParts", "WRITE"\)/,
        `${label} 이 설정을 묻지 않는다`
      );
    }
  });

  test("🔴 권한은 저장 쪽에서 다시 판정된다 — 주소로 직접 불러도 막힌다", () => {
    // 액션은 살아 있는 계정을 나르기만 한다.
    assert.match(actionCode.replace(/\s+/g, " "), /actor: actingUser,/);
    // 판정 자체는 트랜잭션 안(mutation)에서 조회와 같은 함수로 일어난다.
    assert.match(
      mutationCode.replace(/\s+/g, " "),
      /const canWriteUsedParts = await hasPermission\(params\.actor, "repairCases\.usedParts", "WRITE"\);/
    );
    assert.match(
      mutationCode.replace(/\s+/g, " "),
      /resolveUsedPartsWriteGateWithInventory\(\{ canWriteUsedParts,/
    );
    assert.ok(
      !/resolveUsedPartsWriteGate|hasPermission/.test(actionCode),
      "액션이 판정을 미리 흉내 내지 않는다 — 트랜잭션 밖에서 본 값은 바뀔 수 있다"
    );
  });

  test("🔴 조회와 저장이 같은 판정 함수를 부른다", () => {
    for (const code of [queryCode, mutationCode]) {
      assert.match(code, /resolveUsedPartsWriteGateWithInventory\(\{/);
    }
    // 🔴 그 함수는 **옛 함수를 감싸는 것**이라 차례가 여전히 한 곳에만 있다 —
    //    감싸개가 제 손으로 권한 · 흔적 · 잠금을 다시 적으면 판정이 두 벌이 된다.
    const authCode = strip(read("src/lib/auth/repair-case-used-parts-authorization.ts"));
    assert.match(
      authCode.replace(/\s+/g, " "),
      /export function resolveUsedPartsWriteGateWithInventory\([\s\S]*?const gate = resolveUsedPartsWriteGate\(\{/
    );
  });

  test("🔴 화면은 스스로 판정하지 않는다 — 서버가 준 writeGate 만 본다", () => {
    assert.match(sectionCode, /writeGate/);
    assert.ok(
      !/resolveUsedPartsWriteGate|isUsedPartsBlockedByShipmentLock|isLocked/.test(sectionCode),
      "화면이 판정을 다시 하지 않는다"
    );
    // hasPartRequestHistory 는 안내 문구를 고르는 데만 쓴다 — 편집 가능 여부는
    // canEdit(= writeGate.ok) 하나로 정해진다.
    assert.match(sectionCode.replace(/\s+/g, " "), /const canEdit = writeGate\.ok;/);
  });
});
