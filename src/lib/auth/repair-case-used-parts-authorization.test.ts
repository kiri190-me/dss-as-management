import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  USED_PARTS_CASE_LOCKED_MESSAGE,
  USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
  USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE,
  isUsedPartsBlockedByShipmentLock,
  resolveUsedPartsWriteGate,
} from "./repair-case-used-parts-authorization";
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

  test("🔴 거절 사유 셋이 서로 다른 안내다 — 사람이 할 일이 저마다 다르다", () => {
    const messages = [
      USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE,
      USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
      USED_PARTS_CASE_LOCKED_MESSAGE,
    ];
    assert.equal(new Set(messages).size, 3, "세 문구가 겹치지 않는다");
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

    // 업무 규칙 둘은 애초에 사람의 성질을 말하지 않는다 — 역할 이름이 아예 없어야 한다.
    for (const message of [
      USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
      USED_PARTS_CASE_LOCKED_MESSAGE,
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
    assert.match(mutationCode.replace(/\s+/g, " "), /resolveUsedPartsWriteGate\(\{ canWriteUsedParts,/);
    assert.ok(
      !/resolveUsedPartsWriteGate|hasPermission/.test(actionCode),
      "액션이 판정을 미리 흉내 내지 않는다 — 트랜잭션 밖에서 본 값은 바뀔 수 있다"
    );
  });

  test("🔴 조회와 저장이 같은 판정 함수를 부른다", () => {
    for (const code of [queryCode, mutationCode]) {
      assert.match(code, /resolveUsedPartsWriteGate\(\{/);
    }
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
