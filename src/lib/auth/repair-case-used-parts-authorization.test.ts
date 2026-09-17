import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  USED_PARTS_CASE_LOCKED_MESSAGE,
  USED_PARTS_PART_REQUEST_HISTORY_MESSAGE,
  isUsedPartsBlockedByShipmentLock,
  resolveUsedPartsWriteGate,
} from "./repair-case-used-parts-authorization";

/**
 * ============================================================================
 * 「사용 부품」 칸의 두 규칙 (B-2)
 * ============================================================================
 * 사용자가 정한 것은 이 표 하나다:
 *
 *   반출 이력   출하 잠금   가져온 건    →  적을 수 있나
 *   ─────────   ─────────   ──────────      ────────────
 *      있음        -            -           아니오 (PART_REQUEST_HISTORY_EXISTS)
 *      없음      안 걸림        -           예
 *      없음      걸림         아니오        아니오 (CASE_LOCKED)
 *      없음      걸림          예           예        ← 이 칸을 만든 까닭
 *
 * 그 표를 여기서 여덟 칸 전부 못 박는다. 서버 액션도 mutation 도 조회도 이 함수
 * 하나를 부르므로, 이 시험이 곧 세 곳의 시험이다.
 * ============================================================================
 */

function gate(facts: {
  hasPartRequestHistory: boolean;
  isShipmentLocked: boolean;
  isLegacyImportedCase: boolean;
}) {
  return resolveUsedPartsWriteGate(facts);
}

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
