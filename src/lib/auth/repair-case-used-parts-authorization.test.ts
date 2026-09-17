import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  USED_PARTS_CASE_LOCKED_MESSAGE,
  USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
  USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE,
  USED_PARTS_WRITE_ROLES,
  canRoleWriteUsedParts,
  isUsedPartsBlockedByShipmentLock,
  resolveUsedPartsWriteGate,
} from "./repair-case-used-parts-authorization";
import { ROLE_CODES, type Role } from "@/lib/domain/types";

/**
 * ============================================================================
 * 「사용 부품」 칸의 규칙 셋 (B-2 의 둘 + B-3 의 역할)
 * ============================================================================
 * 사용자가 정한 것은 이 표 둘이다.
 *
 * ① 누가 적을 수 있나 (2026-09-17 확정)
 *
 *   SUPER_ADMIN · ADMIN · AS_ENGINEER  →  쓰기
 *   SALES · INVENTORY_MANAGER          →  못 씀
 *
 * ② 어느 건에 적을 수 있나
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

/** 역할을 적지 않은 시험은 「적을 수 있는 역할」을 뜻한다 — ② 표만 보는 시험이다. */
function gate(facts: {
  actorRole?: Role | null;
  hasPartRequestHistory: boolean;
  isShipmentLocked: boolean;
  isLegacyImportedCase: boolean;
}) {
  return resolveUsedPartsWriteGate({
    actorRole: facts.actorRole === undefined ? "AS_ENGINEER" : facts.actorRole,
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

describe("사용 부품 — 누가 적을 수 있나 (역할 다섯 전부)", () => {
  test("🔴 다섯 역할이 각각 정해진 대로다 — 하나도 빠뜨리지 않는다", () => {
    assert.equal(ROLE_CODES.length, 5, "역할이 늘거나 줄면 이 표부터 다시 정해야 한다");

    for (const role of ROLE_CODES) {
      const expected = CAN_WRITE_BY_ROLE[role];
      assert.equal(canRoleWriteUsedParts(role), expected, `${role} 의 쓰기 여부`);

      // 잠금도 이력도 없는 평범한 건에서, 역할 하나만으로 갈린다.
      const result = gate({
        actorRole: role,
        hasPartRequestHistory: false,
        isShipmentLocked: false,
        isLegacyImportedCase: false,
      });
      assert.equal(result.ok, expected, `${role} 의 판정`);
      if (!result.ok) {
        assert.equal(result.code, "ROLE_NOT_ALLOWED");
        assert.equal(result.message, USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE);
      }
    }
  });

  test("쓰기 역할 목록이 사용자가 정한 셋 그대로다", () => {
    assert.deepEqual([...USED_PARTS_WRITE_ROLES].sort(), ["ADMIN", "AS_ENGINEER", "SUPER_ADMIN"]);
  });

  test("🔴 역할을 읽지 못했으면 막는다 — 닫히는 쪽으로 떨어진다", () => {
    assert.equal(canRoleWriteUsedParts(null), false);
    const result = gate({
      actorRole: null,
      hasPartRequestHistory: false,
      isShipmentLocked: false,
      isLegacyImportedCase: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.code, "ROLE_NOT_ALLOWED");
  });

  test("🔴 권한 없는 역할은 건의 사정과 무관하게 막힌다 — 그리고 까닭이 역할이다", () => {
    for (const role of ROLE_CODES.filter((candidate) => !CAN_WRITE_BY_ROLE[candidate])) {
      for (const hasPartRequestHistory of [false, true]) {
        for (const isShipmentLocked of [false, true]) {
          for (const isLegacyImportedCase of [false, true]) {
            const result = gate({
              actorRole: role,
              hasPartRequestHistory,
              isShipmentLocked,
              isLegacyImportedCase,
            });
            assert.equal(result.ok, false);
            if (result.ok) throw new Error("unreachable");
            // 🔴 「반출 이력 때문」이라고 말하면 거짓 안내다 — 요청서를 지워도 이
            // 사람은 여전히 적을 수 없다.
            assert.equal(result.code, "ROLE_NOT_ALLOWED", `${role} / ${hasPartRequestHistory}`);
          }
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
    const asEngineer = gate({ actorRole: "AS_ENGINEER", ...locked });
    const sales = gate({ actorRole: "SALES", ...locked });
    assert.equal(asEngineer.ok, false);
    assert.equal(sales.ok, false);
    if (asEngineer.ok || sales.ok) throw new Error("unreachable");
    assert.equal(asEngineer.message, USED_PARTS_CASE_LOCKED_MESSAGE);
    assert.equal(sales.message, USED_PARTS_ROLE_NOT_ALLOWED_MESSAGE);
  });

  test("쓰기 역할 셋에게는 B-2 의 두 규칙이 그대로다", () => {
    for (const role of ROLE_CODES.filter((candidate) => CAN_WRITE_BY_ROLE[candidate])) {
      assert.deepEqual(
        gate({
          actorRole: role,
          hasPartRequestHistory: false,
          isShipmentLocked: true,
          isLegacyImportedCase: true,
        }),
        { ok: true },
        `${role} — 잠긴 가져온 건에는 적을 수 있다`
      );
      const blocked = gate({
        actorRole: role,
        hasPartRequestHistory: true,
        isShipmentLocked: false,
        isLegacyImportedCase: false,
      });
      assert.equal(blocked.ok, false);
      if (blocked.ok) throw new Error("unreachable");
      assert.equal(blocked.code, "PART_REQUEST_HISTORY_EXISTS", `${role} — 반출 이력은 여전히 막는다`);
    }
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

  test("🔴 역할 목록이 한 곳에만 있다 — 쓰는 쪽 어디에도 역할 이름이 없다", () => {
    // 이 파일(인가 모듈)에만 있어야 한다.
    const authCode = strip(read("src/lib/auth/repair-case-used-parts-authorization.ts"));
    assert.match(authCode, /export const USED_PARTS_WRITE_ROLES: readonly Role\[\] =/);

    const roleNames = /SUPER_ADMIN|AS_ENGINEER|INVENTORY_MANAGER|"ADMIN"|'ADMIN'|"SALES"|'SALES'/;
    const chain: [string, string][] = [
      ["queries/repair-case-used-parts.ts", queryCode],
      ["mutations/repair-case-used-parts.ts", mutationCode],
      ["actions/repair-case-used-parts.ts", actionCode],
      ["UsedPartsSection.tsx", sectionCode],
      ["UsedPartsEditForm.tsx", formCode],
      ["repair-cases/[id]/page.tsx", pageCode],
    ];
    for (const [label, code] of chain) {
      assert.ok(!roleNames.test(code), `${label} 이 역할 이름을 다시 적고 있다`);
    }

    // 그 목록을 쓰는 곳은 판정 함수 하나뿐이다 — 각 층이 제 손으로 역할을
    // 비교하지 않는다(그러면 차례와 예외가 층마다 갈린다).
    for (const [label, code] of chain) {
      assert.ok(
        !/canRoleWriteUsedParts|USED_PARTS_WRITE_ROLES/.test(code),
        `${label} 이 역할 판정을 따로 부르고 있다`
      );
    }
  });

  test("🔴 역할은 저장 쪽에서 다시 판정된다 — 주소로 직접 불러도 막힌다", () => {
    // 액션은 살아 있는 계정에서 읽은 역할을 나르기만 한다.
    assert.match(actionCode.replace(/\s+/g, " "), /actorRole: actingUser\.role,/);
    // 판정 자체는 트랜잭션 안(mutation)에서 조회와 같은 함수로 일어난다.
    assert.match(mutationCode.replace(/\s+/g, " "), /resolveUsedPartsWriteGate\(\{ actorRole: params\.actorRole,/);
    assert.ok(
      !/resolveUsedPartsWriteGate/.test(actionCode),
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
