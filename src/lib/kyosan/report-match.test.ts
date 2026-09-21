import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  CARD_FIELDS,
  CARD_LISTS,
  type CardFieldKey,
  type CardFieldValue,
  type CardFields,
  type CardListKey,
  type CardListValue,
} from "./card-fields";
import {
  matchKyosanReport,
  normalizeKyosanIntakeNumber,
  readKyosanIdentity,
  type KyosanCaseCandidate,
} from "./report-match";

/**
 * ============================================================================
 * 🔴 시험 자료는 전부 손으로 지은 가짜다 — 실제 연락서도 실제 수리 건도 쓰지 않는다
 * ============================================================================
 * 짝짓기는 DB 를 모르는 순수 함수라, 후보를 손으로 지어 넘기면 끝이다. 덕분에
 * 이 시험은 DB 없이 돌고 `unit` 목록에 들어간다.
 * ============================================================================
 */

function cardOf(
  fields: Partial<Record<CardFieldKey, string>>,
  lists: Partial<Record<CardListKey, string[]>> = {}
): CardFields {
  const fieldMap = {} as Record<CardFieldKey, CardFieldValue>;
  for (const spec of CARD_FIELDS) {
    const value = fields[spec.key] ?? null;
    fieldMap[spec.key] = {
      value,
      labelAddress: value === null ? null : "A1",
      valueAddress: value === null ? null : "B1",
    };
  }
  const listMap = {} as Record<CardListKey, CardListValue>;
  for (const spec of CARD_LISTS) {
    const values = lists[spec.key] ?? [];
    listMap[spec.key] = { values, labelCount: values.length, usedLegacy: false };
  }
  return { fields: fieldMap, lists: listMap };
}

function caseOf(overrides: Partial<KyosanCaseCandidate> = {}): KyosanCaseCandidate {
  return {
    repairCaseId: "case-1",
    intakeNumber: "D210105",
    isDeleted: false,
    customerName: "가짜상사",
    modelName: "FAKE-100",
    serialNumber: "SN-0001",
    lotNumber: "LN-0001",
    ...overrides,
  };
}

const CARD = cardOf({
  intakeNumber: "D210105",
  model: "FAKE-100",
  serialNumber: "SN-0001",
  lotNumber: "LN-0001",
  customer: "가짜상사",
});

describe("접수번호 다듬기", () => {
  test("NFKC · 공백 · 대소문자를 눌러 같은 번호로 본다", () => {
    assert.equal(normalizeKyosanIntakeNumber("d210105"), "D210105");
    assert.equal(normalizeKyosanIntakeNumber(" D 210105 "), "D210105");
    assert.equal(normalizeKyosanIntakeNumber("Ｄ２１０１０５"), "D210105");
  });

  test("번호 꼴이 아니면 null — 「없다」가 아니라 「꼴이 아니다」를 상태가 나른다", () => {
    assert.equal(normalizeKyosanIntakeNumber("2021-0105"), null);
    assert.equal(normalizeKyosanIntakeNumber("D211305"), null, "13월은 번호가 아니다");
    assert.equal(normalizeKyosanIntakeNumber(null), null);
    assert.equal(normalizeKyosanIntakeNumber("   "), null);
  });
});

describe("연락서 ↔ 수리 건 짝짓기", () => {
  test("🔴 짝이 하나 — 접수번호로 찾고 신원이 다 맞는다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: caseOf(),
    });
    assert.equal(match.intakeNumberStatus, "found");
    assert.equal(match.outcome.kind, "matched");
    if (match.outcome.kind !== "matched") return;
    assert.equal(match.outcome.candidate.repairCaseId, "case-1");
    assert.deepEqual(match.outcome.identity, {
      model: "agree",
      serialNumber: "agree",
      lotNumber: "agree",
      customer: "agree",
    });
    assert.deepEqual(match.outcome.warnings, []);
  });

  test("접수번호로 찾은 건의 L/N 을 모르면 `unknown` 이다 — 「비었다」와 「다르다」를 가른다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: caseOf({ lotNumber: null }),
    });
    assert.equal(match.outcome.kind, "matched");
    if (match.outcome.kind !== "matched") return;
    assert.equal(match.outcome.identity.lotNumber, "unknown");
    assert.deepEqual(match.outcome.warnings, []);
  });

  test("한 항목만 어긋나면 짝은 지키고 경고만 낸다 — 🔴 경고에 값을 담지 않는다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: caseOf({ serialNumber: "SN-9999" }),
    });
    assert.equal(match.outcome.kind, "matched");
    if (match.outcome.kind !== "matched") return;
    assert.equal(match.outcome.identity.serialNumber, "differ");
    assert.equal(match.outcome.warnings.length, 1);
    assert.match(match.outcome.warnings[0], /S\/N/);
    assert.ok(!match.outcome.warnings[0].includes("SN-9999"), "경고 문구에 값이 들어가면 안 된다");
  });

  test("🔴 고객사만 다른 것으로는 짝을 깨지 않는다 — 연락서의 客先 은 교산의 고객이다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: caseOf({ customerName: "京三製作所" }),
    });
    assert.equal(match.outcome.kind, "matched");
    if (match.outcome.kind !== "matched") return;
    assert.equal(match.outcome.identity.customer, "differ");
    assert.equal(match.outcome.warnings.length, 1);
  });

  test("🔴 짝이 여럿(확인) — 번호는 찾았는데 모델도 S/N 도 다르면 사람에게 넘긴다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: caseOf({ modelName: "OTHER-9", serialNumber: "SN-9999" }),
    });
    assert.equal(match.intakeNumberStatus, "found");
    assert.equal(match.outcome.kind, "ambiguous");
    if (match.outcome.kind !== "ambiguous") return;
    assert.equal(match.outcome.reason, "identity-conflict");
    assert.equal(match.outcome.candidates.length, 1);
  });

  test("🔴 짝이 여럿 — 접수번호가 없고 S/N 후보가 둘이면 사람이 고른다", () => {
    const card = cardOf({ model: "FAKE-100", serialNumber: "SN-0001" });
    const match = matchKyosanReport({
      identity: readKyosanIdentity(card),
      caseByIntakeNumber: null,
      identityCandidates: [
        caseOf({ repairCaseId: "case-1", intakeNumber: "D210105" }),
        caseOf({ repairCaseId: "case-2", intakeNumber: "D230207" }),
      ],
    });
    assert.equal(match.intakeNumberStatus, "missing");
    assert.equal(match.outcome.kind, "ambiguous");
    if (match.outcome.kind !== "ambiguous") return;
    assert.equal(match.outcome.reason, "identity-candidates");
    assert.equal(match.outcome.candidates.length, 2);
  });

  test("🔴 S/N 후보가 하나뿐이어도 자동으로 짝짓지 않는다 — 같은 장비가 여러 번 수리를 온다", () => {
    const card = cardOf({ model: "FAKE-100", serialNumber: "SN-0001" });
    const match = matchKyosanReport({
      identity: readKyosanIdentity(card),
      caseByIntakeNumber: null,
      identityCandidates: [caseOf()],
    });
    assert.equal(match.outcome.kind, "ambiguous");
  });

  test("S/N 은 같은데 모델이 다른 후보는 후보로도 안 친다", () => {
    const card = cardOf({ model: "FAKE-100", serialNumber: "SN-0001" });
    const match = matchKyosanReport({
      identity: readKyosanIdentity(card),
      caseByIntakeNumber: null,
      identityCandidates: [caseOf({ modelName: "OTHER-9" })],
    });
    assert.equal(match.outcome.kind, "unmatched");
  });

  test("🔴 짝이 없음 — 접수번호를 못 읽었다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(cardOf({ model: "FAKE-100" })),
      caseByIntakeNumber: null,
    });
    assert.equal(match.intakeNumberStatus, "missing");
    assert.equal(match.outcome.kind, "unmatched");
    if (match.outcome.kind !== "unmatched") return;
    assert.equal(match.outcome.reason, "intake-number-missing");
  });

  test("🔴 짝이 없음 — 번호 꼴이 아니다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(cardOf({ intakeNumber: "2021-0105" })),
      caseByIntakeNumber: null,
    });
    assert.equal(match.intakeNumberStatus, "malformed");
    assert.equal(match.outcome.kind, "unmatched");
    if (match.outcome.kind !== "unmatched") return;
    assert.equal(match.outcome.reason, "intake-number-malformed");
    assert.equal(match.rawIntakeNumber, "2021-0105", "원문은 남겨 사람이 고칠 수 있게 한다");
    assert.equal(match.intakeNumber, null, "꼴이 아니면 질의 열쇠로 쓰지 않는다");
  });

  test("🔴 짝이 없음 — 번호는 멀쩡한데 그 번호의 건이 없다(수리 건을 만들지 않는다)", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: null,
    });
    assert.equal(match.intakeNumberStatus, "not-found");
    assert.equal(match.outcome.kind, "unmatched");
    if (match.outcome.kind !== "unmatched") return;
    assert.equal(match.outcome.reason, "intake-number-not-found");
  });

  test("휴지통의 건도 그대로 돌려준다 — 막는 것은 미리보기의 일이다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: caseOf({ isDeleted: true }),
    });
    assert.equal(match.outcome.kind, "matched");
    if (match.outcome.kind !== "matched") return;
    assert.equal(match.outcome.candidate.isDeleted, true);
  });
});

/**
 * ============================================================================
 * 🔴 사람이 고른 것을 받아들인다 (조각 S4b)
 * ============================================================================
 * 사용자 결정(2026-09-21): 「짝이 여럿일 때 사람이 고르면 저장까지 받아들인다.」
 * 여기서 못 박는 것은 **받아들이는 범위**다 — 후보 목록 안의 건만, 그리고 자동
 * 으로 정해진 짝과 **구별할 수 있게**(`basis`). 저장 직전 검사가 그 구별에 기댄다.
 * ============================================================================
 */
describe("🔴 후보 중에서 사람이 고른 것", () => {
  const CHOOSE_CARD = cardOf({ model: "FAKE-100", serialNumber: "SN-0001" });
  const CANDIDATES = [
    caseOf({ repairCaseId: "case-1", intakeNumber: "D210105" }),
    caseOf({ repairCaseId: "case-2", intakeNumber: "D230207" }),
  ];

  test("고른 건이 후보 목록 안에 있으면 `matched` 가 된다 — basis 는 human-choice", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CHOOSE_CARD),
      caseByIntakeNumber: null,
      identityCandidates: CANDIDATES,
      chosenRepairCaseId: "case-2",
    });
    assert.equal(match.outcome.kind, "matched");
    if (match.outcome.kind !== "matched") return;
    assert.equal(match.outcome.candidate.repairCaseId, "case-2");
    assert.equal(match.outcome.basis, "human-choice", "🔴 자동으로 정해진 짝과 구별돼야 한다");
    assert.equal(match.outcome.identity.serialNumber, "agree");
  });

  test("🔴 후보 목록 **밖**의 건을 고르면 받지 않는다 — 화면이 보여 준 적 없는 건이다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CHOOSE_CARD),
      caseByIntakeNumber: null,
      identityCandidates: CANDIDATES,
      chosenRepairCaseId: "case-밖에있는것",
    });
    assert.equal(match.outcome.kind, "ambiguous");
    if (match.outcome.kind !== "ambiguous") return;
    assert.equal(match.outcome.reason, "identity-candidates");
    assert.equal(match.outcome.candidates.length, 2);
  });

  test("🔴 S/N 이 달라 후보로도 안 친 건은 골라도 받지 않는다", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CHOOSE_CARD),
      caseByIntakeNumber: null,
      // 목록으로 넘어오기는 했지만 모델이 달라 후보에서 걸러지는 건이다.
      identityCandidates: [caseOf({ repairCaseId: "case-3", modelName: "OTHER-9" })],
      chosenRepairCaseId: "case-3",
    });
    assert.equal(match.outcome.kind, "unmatched", "후보가 아닌 것은 고르기로도 살아나지 않는다");
  });

  test("🔴 접수번호로 정해진 짝에는 고르기가 끼어들지 않는다 — basis 는 intake-number", () => {
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: caseOf(),
      chosenRepairCaseId: "case-2",
    });
    assert.equal(match.outcome.kind, "matched");
    if (match.outcome.kind !== "matched") return;
    assert.equal(match.outcome.candidate.repairCaseId, "case-1", "고르기가 짝을 바꾸면 안 된다");
    assert.equal(match.outcome.basis, "intake-number");
  });

  test("🔴 identity-conflict 는 골라도 올라가지 않는다 — 「번호가 틀렸다」는 신호다", () => {
    const conflicting = caseOf({ modelName: "OTHER-9", serialNumber: "SN-9999" });
    const match = matchKyosanReport({
      identity: readKyosanIdentity(CARD),
      caseByIntakeNumber: conflicting,
      chosenRepairCaseId: conflicting.repairCaseId,
    });
    assert.equal(match.outcome.kind, "ambiguous");
    if (match.outcome.kind !== "ambiguous") return;
    assert.equal(match.outcome.reason, "identity-conflict");
  });

  test("고르지 않으면(빈 값) 그대로 `ambiguous` 다", () => {
    for (const chosen of [null, undefined]) {
      const match = matchKyosanReport({
        identity: readKyosanIdentity(CHOOSE_CARD),
        caseByIntakeNumber: null,
        identityCandidates: CANDIDATES,
        chosenRepairCaseId: chosen,
      });
      assert.equal(match.outcome.kind, "ambiguous", `chosen=${String(chosen)}`);
    }
  });
});
