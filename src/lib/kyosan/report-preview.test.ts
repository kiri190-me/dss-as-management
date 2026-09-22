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
import type { KyosanReport } from "./kyosan-report";
import type { KyosanDetailPart } from "./parts-detail-sheet";
import { matchKyosanReport, readKyosanIdentity, type KyosanCaseCandidate } from "./report-match";
import { KYOSAN_FORM_ASSET_SHA256 } from "./report-photo-filter";
import type { KyosanPhoto } from "./report-photos";
import { buildKyosanReportPreview, type KyosanCaseState } from "./report-preview";

/** 🔴 실제 연락서도 실제 수리 건도 쓰지 않는다 — 전부 손으로 지은 가짜다. */

const SOURCE_SHA = "9".repeat(64);
const [FORM_ASSET_SHA] = [...KYOSAN_FORM_ASSET_SHA256];

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

function photoOf(sha256: string, bytes: number): KyosanPhoto {
  return { sha256, bytes, parts: ["xl/media/x.jpg"], sheets: ["参考写真"], placements: 1 };
}

function reportOf(overrides: Partial<KyosanReport> = {}): KyosanReport {
  return {
    formFamily: "card",
    cardSheetName: "Card",
    repairReportSheetName: "Repair_Report",
    sheetNames: ["Card", "Repair_Report"],
    sourceSha256: SOURCE_SHA,
    card: cardOf(
      {
        intakeNumber: "D210105",
        model: "FAKE-100",
        serialNumber: "SN-0001",
        customer: "가짜상사",
        situationDetail: "값-불량현상",
        notes: "값-비고",
      },
      {
        customerFaults: ["값-고객고장1", "값-고객고장2"],
        internalFindings: ["값-사내확인"],
        faultParts: ["값-부품A"],
        preventiveParts: ["값-부품B"],
      }
    ),
    cause: { sectionAddress: "C30", options: ["製作不良", "部品不良"], marked: ["部品不良"] },
    action: { sectionAddress: "C28", options: ["現品引取", "部品交換"], marked: ["部品交換"] },
    detailParts: [],
    photos: [photoOf("a".repeat(64), 30_000), photoOf("b".repeat(64), 1_161)],
    problems: [],
    ...overrides,
  };
}

function caseOf(overrides: Partial<KyosanCaseCandidate> = {}): KyosanCaseCandidate {
  return {
    repairCaseId: "case-1",
    intakeNumber: "D210105",
    isDeleted: false,
    customerName: "가짜상사",
    modelName: "FAKE-100",
    serialNumber: "SN-0001",
    lotNumber: null,
    ...overrides,
  };
}

function stateOf(overrides: Partial<KyosanCaseState> = {}): KyosanCaseState {
  return {
    repairCaseId: "case-1",
    serviceReportCount: 0,
    hasReportedSymptom: false,
    importedSourceSha256: [],
    ...overrides,
  };
}

function previewOf(
  report: KyosanReport,
  candidate: KyosanCaseCandidate | null,
  state: KyosanCaseState | null,
  identityCandidates: readonly KyosanCaseCandidate[] = []
) {
  const match = matchKyosanReport({
    identity: readKyosanIdentity(report.card),
    caseByIntakeNumber: candidate,
    identityCandidates,
  });
  return buildKyosanReportPreview(report, match, state);
}

describe("연락서 미리보기", () => {
  test("🔴 짝이 하나면 무엇이 들어갈지 보여 준다 — 줄 · 부품 · 사진", () => {
    const preview = previewOf(reportOf(), caseOf(), stateOf());
    assert.deepEqual(preview.blockers, []);
    assert.ok(preview.plan);
    if (!preview.plan) return;

    assert.equal(preview.plan.repairCaseId, "case-1");
    assert.equal(preview.plan.intakeNumber, "D210105");

    const findings = preview.plan.lines.filter((line) => line.section === "FINDINGS").map((line) => line.text);
    assert.deepEqual(findings, ["값-고객고장1", "값-고객고장2", "값-사내확인", "값-불량현상", "部品不良"]);

    const actions = preview.plan.lines.filter((line) => line.section === "ACTIONS").map((line) => line.text);
    assert.deepEqual(actions, ["部品交換"]);

    const remarks = preview.plan.lines.filter((line) => line.section === "REMARK").map((line) => line.text);
    assert.deepEqual(remarks, ["값-비고"]);

    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-부품A" },
      { kind: "preventive", text: "값-부품B" },
    ]);
    assert.deepEqual(preview.plan.causeMarks, ["部品不良"]);
    assert.deepEqual(preview.plan.actionMarks, ["部品交換"]);
  });

  test("🔴 사진은 양식 아이콘·도장을 뺀 실제 사진만 센다", () => {
    const report = reportOf({
      photos: [
        photoOf("a".repeat(64), 30_000),
        photoOf("b".repeat(64), 1_161),
        photoOf(FORM_ASSET_SHA, 125_425),
        photoOf("c".repeat(64), 250_000),
      ],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.equal(preview.plan.photoCount, 2);
    assert.equal(preview.plan.formAssetCount, 2);
  });

  test("같은 글자는 한 구역에 한 번만 · 빈 글자는 줄이 되지 않는다", () => {
    const report = reportOf({
      card: cardOf(
        { intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001", situationDetail: "값-같은글자" },
        { customerFaults: ["값-같은글자", "   "], internalFindings: ["값-같은글자"] }
      ),
      cause: { sectionAddress: null, options: [], marked: [] },
      action: { sectionAddress: null, options: [], marked: [] },
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(
      preview.plan.lines.map((line) => line.text),
      ["값-같은글자"]
    );
  });

  test("🔴 짝이 없으면 아무것도 넣지 않는다 — plan 이 null 이고 까닭이 적힌다(사용자 정책)", () => {
    const preview = previewOf(reportOf(), null, null);
    assert.equal(preview.plan, null);
    assert.equal(preview.blockers.length, 1);
    assert.match(preview.blockers[0], /짝이 없습니다/);
    assert.match(preview.blockers[0], /수리 건을 새로 만들지 않습니다/);
  });

  test("🔴 접수번호를 못 읽은 것과 그 번호의 건이 없는 것을 가려서 알린다", () => {
    const noNumber = previewOf(reportOf({ card: cardOf({ model: "FAKE-100" }) }), null, null);
    assert.equal(noNumber.plan, null);
    assert.match(noNumber.blockers[0], /접수번호를 읽지 못했습니다/);

    const notFound = previewOf(reportOf(), null, null);
    assert.match(notFound.blockers[0], /등록된 수리 건이 없습니다/);
  });

  test("🔴 짝이 여럿이면 넣지 않는다 — 사람이 골라야 한다", () => {
    const report = reportOf({ card: cardOf({ model: "FAKE-100", serialNumber: "SN-0001" }) });
    const preview = previewOf(report, null, null, [
      caseOf({ repairCaseId: "case-1" }),
      caseOf({ repairCaseId: "case-2", intakeNumber: "D230207" }),
    ]);
    assert.equal(preview.plan, null);
    assert.match(preview.blockers[0], /후보가 2건/);
    assert.match(preview.blockers[0], /사람이 골라야 합니다/);
  });

  test("🔴 같은 원본 해시가 이미 있으면 「이미 넣은 연락서」로 막는다", () => {
    const preview = previewOf(
      reportOf(),
      caseOf(),
      stateOf({ importedSourceSha256: ["0".repeat(64), SOURCE_SHA] })
    );
    assert.equal(preview.plan, null);
    assert.ok(preview.blockers.some((blocker) => /이미 넣은 연락서/.test(blocker)));
  });

  test("다른 원본 해시만 있으면 막지 않는다", () => {
    const preview = previewOf(reportOf(), caseOf(), stateOf({ importedSourceSha256: ["0".repeat(64)] }));
    assert.deepEqual(preview.blockers, []);
    assert.ok(preview.plan);
  });

  test("🔴 신고 증상에 이미 값이 있으면 알린다 — 막지는 않는다(덮지 않고 작업 기록으로)", () => {
    const preview = previewOf(reportOf(), caseOf(), stateOf({ hasReportedSymptom: true }));
    assert.ok(preview.plan, "신고 증상이 차 있다고 막지는 않는다");
    assert.ok(preview.warnings.some((warning) => /신고 증상 칸에 이미 값이 있습니다/.test(warning)));
    assert.ok(preview.warnings.some((warning) => /작업 기록으로 넣습니다/.test(warning)));
  });

  test("🔴 보고서가 있어도 더 이상 알리지 않는다 — 이식이 보고서를 만들지 않기 때문이다", () => {
    const preview = previewOf(reportOf(), caseOf(), stateOf({ serviceReportCount: 2 }));
    assert.ok(preview.plan);
    assert.equal(
      preview.warnings.some((warning) => /보고서/.test(warning)),
      false,
      "이식이 보고서를 만들지 않으므로 「한 장이 더 쌓인다」는 문장은 거짓말이다"
    );
  });

  test("🔴 휴지통의 건에는 넣지 않는다", () => {
    const preview = previewOf(reportOf(), caseOf({ isDeleted: true }), stateOf());
    assert.equal(preview.plan, null);
    assert.ok(preview.blockers.some((blocker) => /휴지통/.test(blocker)));
  });

  test("🔴 건의 상태를 못 읽었으면 넣지 않는다 — 중복 확인이 통째로 빠진다", () => {
    const preview = previewOf(reportOf(), caseOf(), null);
    assert.equal(preview.plan, null);
    assert.ok(preview.blockers.some((blocker) => /현재 상태를 읽지 못했습니다/.test(blocker)));
  });

  test("신원 경고는 미리보기로 그대로 흘러나온다 — 막지는 않는다", () => {
    const preview = previewOf(reportOf(), caseOf({ serialNumber: "SN-9999" }), stateOf());
    assert.ok(preview.plan);
    assert.ok(preview.warnings.some((warning) => /S\/N/.test(warning)));
  });

  test("뽑은 내용이 하나도 없으면 알린다", () => {
    const report = reportOf({
      card: cardOf({ intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" }),
      cause: { sectionAddress: null, options: [], marked: [] },
      action: { sectionAddress: null, options: [], marked: [] },
      photos: [],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.lines, []);
    assert.ok(preview.warnings.some((warning) => /하나도 뽑지 못했습니다/.test(warning)));
  });

  test("미리보기는 원본 해시를 그대로 달고 다닌다 — S3b 가 중복을 막을 열쇠다", () => {
    const preview = previewOf(reportOf(), caseOf(), stateOf());
    assert.equal(preview.sourceSha256, SOURCE_SHA);
  });
});

/**
 * 🔴 실측(2026-09-22, 연락서 472장): Card 시트와 `交換部品詳細` 시트에 **같은
 * 부품을 둘 다 적는 일이 흔하다** — 281장이 그렇고 겹친 짝이 929건이다. 그리고
 * **45장은 Card 가 텅 비었는데 詳細에만 부품이 있었다**(그 장들은 부품이 하나도
 * 안 들어가고 있었다). 아래 시험이 그 두 가지를 값으로 못 박는다.
 */
function detailPartOf(overrides: Partial<KyosanDetailPart> = {}): KyosanDetailPart {
  return {
    name: "값-부품A",
    spec: null,
    kind: "fault",
    quantity: null,
    status: null,
    measure: null,
    sheetName: "交換部品詳細",
    address: "C8",
    ...overrides,
  };
}

describe("교체 부품 — Card 시트와 交換部品詳細 시트를 합친다", () => {
  test("🔴 두 시트에 같은 부품이 있으면 두 번 들어가지 않는다 — 수량만 詳細에서 온다", () => {
    const report = reportOf({
      detailParts: [detailPartOf({ name: "값-부품A", quantity: 4 })],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-부품A", quantity: 4 },
      { kind: "preventive", text: "값-부품B" },
    ]);
  });

  test("🔴 詳細 시트에만 있는 부품이 뒤에 이어 붙는다", () => {
    const report = reportOf({
      detailParts: [
        detailPartOf({ name: "값-부품C", quantity: 2, kind: "fault" }),
        detailPartOf({ name: "값-부품D", quantity: 1, kind: "preventive", sheetName: "交換部品詳細(DC)" }),
      ],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-부품A" },
      { kind: "preventive", text: "값-부품B" },
      { kind: "fault", text: "값-부품C", quantity: 2 },
      { kind: "preventive", text: "값-부품D", quantity: 1 },
    ]);
  });

  test("🔴 Card 가 텅 비어도 詳細 시트만으로 부품이 들어간다 — 실측 45장이 그 꼴이다", () => {
    const report = reportOf({
      card: cardOf({ intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" }),
      detailParts: [detailPartOf({ name: "값-호스", quantity: 1 })],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-호스", quantity: 1 }]);
  });

  test("🔴 같은 이름이 詳細 시트에 두 줄이면 한 번만, 수량은 첫 줄에서", () => {
    const report = reportOf({
      card: cardOf({ intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" }),
      detailParts: [
        detailPartOf({ name: "값-부품E", quantity: 3, sheetName: "交換部品詳細(RF)" }),
        detailPartOf({ name: "값-부품E", quantity: 9, sheetName: "交換部品詳細(DC)" }),
      ],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-부품E", quantity: 3 }]);
  });

  test("🔴 수량이 없는 줄은 열쇠가 아예 없다 — 넣는 쪽이 1 로 본다", () => {
    const report = reportOf({
      card: cardOf({ intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" }),
      detailParts: [detailPartOf({ name: "값-부품F", quantity: null })],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-부품F" }]);
  });

  test("詳細 시트가 비면 지금까지와 똑같다 — Card 시트만으로 뽑는다", () => {
    const preview = previewOf(reportOf({ detailParts: [] }), caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-부품A" },
      { kind: "preventive", text: "값-부품B" },
    ]);
  });
});
