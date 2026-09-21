import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MAX_ATTACHMENT_SIZE_BYTES } from "@/lib/domain/attachment-allowlist";
import type { KyosanCaseCandidate, KyosanIdentityCheck, KyosanMatch } from "@/lib/kyosan/report-match";
import type { KyosanCaseState } from "@/lib/kyosan/report-preview";
import {
  KYOSAN_CHOICE_CAUTION,
  KYOSAN_REPORT_UPLOAD_MAX_BYTES,
  buildKyosanReportTargets,
  canImportKyosanReport,
  checkKyosanReportFile,
  defaultKyosanReportSelection,
  kyosanReportSaveOffer,
  type KyosanReportPreviewReady,
  type KyosanReportTarget,
} from "./preview-view";

/**
 * ============================================================================
 * 🔴 연락서 한 장 넣기 — **저장 단추를 여는 규칙** (조각 S4)
 * ============================================================================
 * 이 화면을 통해 실제 업무 자료가 DB 에 들어간다. 그래서 이 시험이 못 박는 것은
 * 「넣을 수 있는가」보다 **「넣으면 안 될 때 단추가 없는가」** 쪽이다.
 *
 *  1. 🔴 짝이 없으면 저장 단추가 **없다**(`none`) — 수리 건을 새로 만드는 길도 없다.
 *  2. 🔴 짝이 여럿이면 **고르기 전에는 저장할 수 없다**.
 *  3. 휴지통의 건 · 이미 넣은 연락서는 고를 수 없다.
 *  4. 짝이 하나로 확정됐을 때만 미리 골라 둔다.
 * ============================================================================
 */

const ALL_AGREE: KyosanIdentityCheck = {
  model: "agree",
  serialNumber: "agree",
  lotNumber: "unknown",
  customer: "agree",
};

function candidate(overrides: Partial<KyosanCaseCandidate> = {}): KyosanCaseCandidate {
  return {
    repairCaseId: "11111111-1111-4111-8111-111111111111",
    intakeNumber: "D250101",
    isDeleted: false,
    customerName: "값-고객사",
    modelName: "값-모델",
    serialNumber: "값-시리얼",
    lotNumber: null,
    ...overrides,
  };
}

function target(overrides: Partial<KyosanReportTarget> = {}): KyosanReportTarget {
  return {
    repairCaseId: "11111111-1111-4111-8111-111111111111",
    intakeNumber: "D250101",
    isDeleted: false,
    customerName: "값-고객사",
    modelName: "값-모델",
    serialNumber: "값-시리얼",
    lotNumber: null,
    identity: ALL_AGREE,
    serviceReportCount: 0,
    hasReportedSymptom: false,
    alreadyImported: false,
    ...overrides,
  };
}

function preview(overrides: Partial<KyosanReportPreviewReady> = {}): KyosanReportPreviewReady {
  return {
    ok: true,
    sourceSha256: "a".repeat(64),
    formFamily: "card",
    intakeNumberStatus: "found",
    reportIdentity: {
      rawIntakeNumber: "D250101",
      intakeNumber: "D250101",
      model: "값-모델",
      serialNumber: "값-시리얼",
      lotNumber: null,
      customer: "값-고객사",
    },
    match: { kind: "matched" },
    targets: [target()],
    confirmedRepairCaseId: "11111111-1111-4111-8111-111111111111",
    content: {
      lines: [],
      parts: [],
      causeMarks: [],
      actionMarks: [],
      photoCount: 0,
      formAssetCount: 0,
    },
    blockers: [],
    warnings: [],
    problems: [],
    ...overrides,
  };
}

// ══════════════════════════════════════════════ 1. 짝이 없을 때

describe("🔴 짝이 없으면 저장 단추가 없다", () => {
  for (const reason of [
    "intake-number-missing",
    "intake-number-malformed",
    "intake-number-not-found",
  ] as const) {
    test(`unmatched(${reason}) — offer 는 none 이고 무엇을 골라도 넣을 수 없다`, () => {
      const unmatched = preview({
        match: { kind: "unmatched", reason },
        targets: [],
        confirmedRepairCaseId: null,
        blockers: ["짝이 없습니다 — 넣지 않습니다."],
      });

      assert.equal(kyosanReportSaveOffer(unmatched), "none");
      assert.equal(canImportKyosanReport(unmatched, null), false);
      // 사람이 주소창으로 아무 id 나 밀어 넣어도 화면은 열어 주지 않는다.
      assert.equal(canImportKyosanReport(unmatched, "11111111-1111-4111-8111-111111111111"), false);
      assert.equal(defaultKyosanReportSelection(unmatched), null);
    });
  }
});

// ══════════════════════════════════════════════ 2. 짝이 여럿일 때

describe("🔴 짝이 여럿이면 고르기 전에는 저장할 수 없다", () => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  const many = preview({
    match: { kind: "ambiguous", reason: "identity-candidates" },
    targets: [
      target({ repairCaseId: first, intakeNumber: "D250101" }),
      target({ repairCaseId: second, intakeNumber: "D240707", identity: { ...ALL_AGREE, model: "differ" } }),
    ],
    confirmedRepairCaseId: null,
    blockers: ["사람이 골라야 합니다."],
  });

  test("offer 는 choose 다 — 단추는 그리되 고르기 전에는 못 누른다", () => {
    assert.equal(kyosanReportSaveOffer(many), "choose");
    assert.equal(canImportKyosanReport(many, null), false, "🔴 고르지 않았는데 넣을 수 있으면 안 된다");
  });

  test("🔴 미리 골라 두지 않는다 — 사람이 고르지 않고 누르는 것을 막는다", () => {
    assert.equal(defaultKyosanReportSelection(many), null);
  });

  test("고른 뒤에는 그 건만 넣을 수 있다", () => {
    assert.equal(canImportKyosanReport(many, first), true);
    assert.equal(canImportKyosanReport(many, second), true);
    // 후보에 없는 건은 고를 수 없다 — 화면이 보여 주지 않은 건이다.
    assert.equal(canImportKyosanReport(many, "33333333-3333-4333-8333-333333333333"), false);
  });

  test("후보가 전부 휴지통이면 고를 것이 없다 — offer 는 none", () => {
    const trashed = preview({
      match: { kind: "ambiguous", reason: "identity-candidates" },
      targets: [target({ isDeleted: true })],
      confirmedRepairCaseId: null,
    });
    assert.equal(kyosanReportSaveOffer(trashed), "none");
  });

  test("🔴 고르면 어떻게 되는지를 갈래마다 다르게 말한다(조각 S4b)", () => {
    // 후보에서 고른 것은 이제 저장까지 간다 — 다만 모델·S/N 을 다시 대조한다.
    assert.match(KYOSAN_CHOICE_CAUTION["identity-candidates"], /모델·S\/N/u);
    assert.ok(
      !/저장되지 않습니다/u.test(KYOSAN_CHOICE_CAUTION["identity-candidates"]),
      "후보 고르기는 이제 저장까지 받아들인다(2026-09-21 사용자 결정)"
    );
    // 번호가 틀린 것(conflict)은 여전히 골라도 저장되지 않는다 — 숨기지 않는다.
    assert.match(KYOSAN_CHOICE_CAUTION["identity-conflict"], /저장되지 않습니다/u);
  });

  test("접수번호가 맞아도 모델·S/N 이 둘 다 다르면 사람이 고른다(identity-conflict)", () => {
    const conflict = preview({
      match: { kind: "ambiguous", reason: "identity-conflict" },
      targets: [target({ identity: { model: "differ", serialNumber: "differ", lotNumber: "unknown", customer: "differ" } })],
      confirmedRepairCaseId: null,
    });
    assert.equal(kyosanReportSaveOffer(conflict), "choose");
    assert.equal(canImportKyosanReport(conflict, null), false);
  });
});

// ══════════════════════════════════════════════ 3. 고를 수 없는 건

describe("고를 수 없는 건", () => {
  test("휴지통의 건은 고를 수 없다", () => {
    const trashed = preview({ targets: [target({ isDeleted: true })], confirmedRepairCaseId: null });
    assert.equal(canImportKyosanReport(trashed, target().repairCaseId), false);
  });

  test("🔴 이미 넣은 연락서는 다시 넣을 수 없다", () => {
    const done = preview({
      match: { kind: "ambiguous", reason: "identity-candidates" },
      targets: [target({ alreadyImported: true })],
      confirmedRepairCaseId: null,
    });
    assert.equal(canImportKyosanReport(done, target().repairCaseId), false);
  });
});

// ══════════════════════════════════════════════ 4. 짝이 하나로 확정됐을 때

describe("짝이 하나로 확정됐을 때", () => {
  test("offer 는 confirm 이고 그 건이 미리 골라져 있다", () => {
    const one = preview();
    assert.equal(kyosanReportSaveOffer(one), "confirm");
    assert.equal(defaultKyosanReportSelection(one), one.confirmedRepairCaseId);
    assert.equal(canImportKyosanReport(one, one.confirmedRepairCaseId), true);
  });

  test("🔴 막는 것이 있으면(확정 id 가 없으면) 단추를 그리지 않는다", () => {
    // 휴지통 · 이미 넣은 연락서 · 상태를 못 읽음 — 전부 plan 이 null 로 온다.
    const blocked = preview({
      confirmedRepairCaseId: null,
      blockers: ["이미 넣은 연락서입니다(원본 파일이 같습니다) — 다시 넣지 않습니다."],
    });
    assert.equal(kyosanReportSaveOffer(blocked), "none");
    assert.equal(canImportKyosanReport(blocked, target().repairCaseId), false);
  });
});

// ══════════════════════════════════════════════ 후보 목록 만들기

describe("buildKyosanReportTargets", () => {
  const sha = "b".repeat(64);
  const base = {
    rawIntakeNumber: "D250101",
    intakeNumber: "D250101",
    intakeNumberStatus: "found" as const,
  };

  function state(overrides: Partial<KyosanCaseState> = {}): KyosanCaseState {
    return {
      repairCaseId: candidate().repairCaseId,
      serviceReportCount: 0,
      hasReportedSymptom: false,
      importedSourceSha256: [],
      ...overrides,
    };
  }

  test("matched — 한 건, 상태가 함께 실린다", () => {
    const match: KyosanMatch = {
      ...base,
      outcome: {
        kind: "matched",
        basis: "intake-number",
        candidate: candidate(),
        identity: ALL_AGREE,
        warnings: [],
      },
    };
    const built = buildKyosanReportTargets(
      match,
      [state({ serviceReportCount: 2, hasReportedSymptom: true })],
      sha
    );

    assert.equal(built.length, 1);
    assert.equal(built[0].serviceReportCount, 2);
    // 🔴 이식이 덮지 않는다는 것을 화면이 말할 수 있어야 한다.
    assert.equal(built[0].hasReportedSymptom, true);
    assert.equal(built[0].alreadyImported, false);
    assert.deepEqual(built[0].identity, ALL_AGREE);
  });

  test("🔴 같은 원본 해시가 그 건에 있으면 alreadyImported 다", () => {
    const match: KyosanMatch = {
      ...base,
      outcome: {
        kind: "matched",
        basis: "intake-number",
        candidate: candidate(),
        identity: ALL_AGREE,
        warnings: [],
      },
    };
    const built = buildKyosanReportTargets(match, [state({ importedSourceSha256: [sha] })], sha);
    assert.equal(built[0].alreadyImported, true);
  });

  test("ambiguous — 후보가 전부 실린다", () => {
    const other = candidate({ repairCaseId: "22222222-2222-4222-8222-222222222222", intakeNumber: "D240707" });
    const match: KyosanMatch = {
      ...base,
      intakeNumberStatus: "not-found",
      outcome: {
        kind: "ambiguous",
        reason: "identity-candidates",
        candidates: [
          { candidate: candidate(), identity: ALL_AGREE },
          { candidate: other, identity: { ...ALL_AGREE, customer: "differ" } },
        ],
      },
    };
    const built = buildKyosanReportTargets(match, [], sha);

    assert.deepEqual(
      built.map((item) => item.intakeNumber),
      ["D250101", "D240707"]
    );
    assert.equal(built[1].identity.customer, "differ");
    // 상태를 못 읽은 건은 0 · false 로 둔다(없는 것을 있는 것처럼 말하지 않는다).
    assert.equal(built[0].serviceReportCount, 0);
    assert.equal(built[0].hasReportedSymptom, false);
    assert.equal(built[0].alreadyImported, false);
  });

  test("unmatched — 후보가 하나도 없다", () => {
    const match: KyosanMatch = {
      rawIntakeNumber: null,
      intakeNumber: null,
      intakeNumberStatus: "missing",
      outcome: { kind: "unmatched", reason: "intake-number-missing" },
    };
    assert.deepEqual(buildKyosanReportTargets(match, [], sha), []);
  });

  test("L/N 을 모르는 후보는 null 로 온다", () => {
    const match: KyosanMatch = {
      ...base,
      outcome: {
        kind: "matched",
        basis: "intake-number",
        candidate: { ...candidate(), lotNumber: undefined },
        identity: ALL_AGREE,
        warnings: [],
      },
    };
    assert.equal(buildKyosanReportTargets(match, [], sha)[0].lotNumber, null);
  });
});

// ══════════════════════════════════════════════ 올릴 파일 거르기

describe("checkKyosanReportFile", () => {
  test("`.xlsm` · `.xlsx` 만 받는다", () => {
    assert.equal(checkKyosanReportFile({ name: "연락서.xlsm", size: 1000 }), null);
    assert.equal(checkKyosanReportFile({ name: "연락서.XLSX", size: 1000 }), null);
    assert.match(checkKyosanReportFile({ name: "연락서.xls", size: 1000 }) ?? "", /xlsm/);
    assert.match(checkKyosanReportFile({ name: "연락서.pdf", size: 1000 }) ?? "", /xlsm/);
  });

  test("빈 파일과 상한을 넘는 파일을 막는다", () => {
    assert.match(checkKyosanReportFile({ name: "a.xlsm", size: 0 }) ?? "", /빈 파일/);
    assert.match(
      checkKyosanReportFile({ name: "a.xlsm", size: KYOSAN_REPORT_UPLOAD_MAX_BYTES + 1 }) ?? "",
      /MB/
    );
    assert.equal(checkKyosanReportFile({ name: "a.xlsm", size: KYOSAN_REPORT_UPLOAD_MAX_BYTES }), null);
  });

  test("🔴 상한은 첨부 상한과 같은 값이다 — 원본이 그대로 첨부로 남는다", () => {
    assert.equal(KYOSAN_REPORT_UPLOAD_MAX_BYTES, MAX_ATTACHMENT_SIZE_BYTES);
  });
});
