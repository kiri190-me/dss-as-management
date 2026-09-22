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
import {
  buildKyosanReportPreview,
  mergeKyosanPartsForUsedParts,
  type KyosanCaseState,
  type KyosanPreviewPart,
} from "./report-preview";

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
 *
 * 🔴 그리고 겹침 열쇠에는 **갈래가 들어간다**(2026-09-22). 같은 부품이 고장분과
 * 예방분에 둘 다 적힌 장이 실측 **84장**이고, 갈래를 안 보던 동안 **164줄**이
 * 삼켜졌다. 갈래가 다르면 **두 줄**, 갈래가 같으면 **한 줄**이다 — 그 둘을
 * 각각의 시험이 못 박는다.
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
  /**
   * 🔴 **뜻을 다시 정한 시험** (2026-09-22). 예전 제목은 「두 시트에 같은 부품이
   * 있으면 두 번 들어가지 않는다」였는데, 그 규칙이 **갈래를 보지 않아서**
   * 고장분·예방분에 같은 부품이 적힌 장에서 한쪽 갈래를 통째로 삼켰다.
   * 새 규칙은 「**같은 갈래**에서 두 번 들어가지 않는다」다 — 아래 시험이 같은
   * 자료로 그 뜻을 못 박고, 갈래가 다를 때는 `갈래가 다르면 두 줄로 남는다`
   * 시험이 못 박는다.
   */
  test("🔴 두 시트에 같은 갈래·같은 부품이 있으면 두 번 들어가지 않는다 — 수량만 詳細에서 온다", () => {
    const report = reportOf({
      detailParts: [detailPartOf({ name: "값-부품A", quantity: 4, kind: "fault" })],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-부품A", quantity: 4 },
      { kind: "preventive", text: "값-부품B" },
    ]);
  });

  /**
   * 🔴 사용자가 화면에서 짚은 결함이다(2026-09-22, `kyosan-xlsm/0357.xlsm`).
   * 부품 셋이 **고장분(3枚)에도 예방분(7枚)에도 정당하게** 적혀 있었는데, 겹침
   * 열쇠에 갈래가 없어서 먼저 들어간 고장분이 자리를 차지하고 **예방분 세 줄이
   * 통째로 사라졌다.** 수량도 고장분 쪽 3 만 남아 예방 7 을 잃었다.
   *
   * 🔴 실측(연락서 469장): 같은 이름이 양쪽에 있는 장이 **84장**, 그렇게 삼켜진
   * 줄이 **164줄**이다.
   */
  test("🔴 같은 부품이 고장분에도 예방분에도 있으면 두 줄로 남는다 — 수량도 갈래별로", () => {
    const report = reportOf({
      card: cardOf(
        { intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" },
        { faultParts: ["값-양쪽부품"], preventiveParts: ["값-양쪽부품"] }
      ),
      detailParts: [
        detailPartOf({ name: "값-양쪽부품", kind: "fault", quantity: 3 }),
        detailPartOf({ name: "값-양쪽부품", kind: "preventive", quantity: 7 }),
      ],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-양쪽부품", quantity: 3 },
      { kind: "preventive", text: "값-양쪽부품", quantity: 7 },
    ]);
  });

  /**
   * 🔴 수량을 **글자만으로** 짝지으면 갈래가 뒤바뀐 수량이 붙는다. Card 시트에는
   * 수량 칸이 없으므로, Card 로 들어온 줄의 수량은 **같은 갈래의 詳細 줄**에서만
   * 와야 한다.
   */
  test("🔴 Card 로 들어온 줄에 다른 갈래의 수량이 붙지 않는다", () => {
    const report = reportOf({
      card: cardOf(
        { intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" },
        { faultParts: ["값-수량없는부품"] }
      ),
      // 詳細 시트에는 **예방분**으로만 적혀 있다 — 수량 7 은 예방분의 것이다.
      detailParts: [detailPartOf({ name: "값-수량없는부품", kind: "preventive", quantity: 7 })],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [
      // 🔴 고장분 줄에는 수량 열쇠가 아예 없어야 한다(넣는 쪽이 1 로 본다).
      { kind: "fault", text: "값-수량없는부품" },
      { kind: "preventive", text: "값-수량없는부품", quantity: 7 },
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

  /**
   * ⚠️ 이 규칙은 **바뀌지 않았다.** 같은 갈래 안의 겹침은 지금처럼 한 번만
   * 넣는다(실측 예: `終段AMPゲート基板` 이 `予防③`·`予防⑩` 두 줄). 화면이
   * `` `${kind}-${text}` `` 를 React key 로 쓰므로 같은 갈래에서 두 줄을 내면
   * 열쇠가 부딪친다.
   */
  test("🔴 같은 갈래에서 같은 이름이 詳細 시트에 두 줄이면 한 번만, 수량은 첫 줄에서", () => {
    const report = reportOf({
      card: cardOf({ intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" }),
      detailParts: [
        detailPartOf({ name: "값-부품E", quantity: 3, kind: "fault", sheetName: "交換部品詳細(RF)" }),
        detailPartOf({ name: "값-부품E", quantity: 9, kind: "fault", sheetName: "交換部品詳細(DC)" }),
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

/**
 * 🔴 사용자 지시(2026-09-22, 화면을 보고): 「교체 부품이 고장분과 예방분이 잘
 * 나눠졌는데 **사용부품 칸에 내용을 넣을 때는 그 구분 없이 부품명대로 수량을
 * 넣어 줘.**」 — 자리마다 담는 모양이 다르다는 뜻이다.
 *
 *   「교체 부품」 미리보기 · 작업 기록 메모 → 갈래별로 그대로(위 describe 가 지킨다)
 *   🔴 `repair_case_used_parts`            → 이름으로 묶고 수량을 더한다(여기)
 *
 * 🔴 이 수는 **청구 금액에 닿는다**(`repair_case_used_parts.quantity`). 그래서
 * 값으로 시험이 붙는 순수 함수로 두었고, **수량 합계 보존**을 따로 못 박는다.
 */
describe("사용 부품 칸 — 갈래 없이 부품 이름으로 묶는다", () => {
  /** 묶기 전/후의 수량 합. 수량이 없는 줄은 1 로 센다(넣는 쪽의 규칙). */
  function quantitySum(parts: readonly KyosanPreviewPart[]): number {
    return parts.reduce((sum, part) => sum + (part.quantity ?? 1), 0);
  }

  /**
   * 🔴 사용자가 짚은 그 장이다(`kyosan-xlsm/0357.xlsm`) — 부품 셋이 고장 3枚 ·
   * 예방 7枚 로 두 줄인데, 사용 부품 칸에는 **수량 10 한 줄**이어야 한다.
   */
  test("🔴 같은 부품이 고장·예방 양쪽에 있으면 한 줄이고 수량은 합이다", () => {
    const merged = mergeKyosanPartsForUsedParts([
      { kind: "fault", text: "終段AMP基板", quantity: 3 },
      { kind: "preventive", text: "終段AMP基板", quantity: 7 },
    ]);
    assert.deepEqual(merged, [{ text: "終段AMP基板", quantity: 10 }]);
  });

  /**
   * 🔴 **같은 자료로 양쪽을 함께 본다.** 「교체 부품」 목록과 작업 기록 메모는
   * 갈래별로 **두 줄 그대로**여야 하고(이 조각이 되돌리면 안 되는 것), 사용 부품
   * 칸만 한 줄이어야 한다. 한 시험 안에 두 단언을 나란히 둔 까닭은, 둘 중 한쪽만
   * 고치는 변경이 여기서 걸리게 하려는 것이다.
   */
  test("🔴 같은 자료에서 「교체 부품」은 두 줄 그대로 · 사용 부품만 한 줄", () => {
    const report = reportOf({
      card: cardOf(
        { intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" },
        { faultParts: ["값-양쪽부품"], preventiveParts: ["값-양쪽부품"] }
      ),
      detailParts: [
        detailPartOf({ name: "값-양쪽부품", kind: "fault", quantity: 3 }),
        detailPartOf({ name: "값-양쪽부품", kind: "preventive", quantity: 7 }),
      ],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;

    // 🔴 미리보기 · 작업 기록이 쓰는 목록 — 갈래별로 두 줄이다.
    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-양쪽부품", quantity: 3 },
      { kind: "preventive", text: "값-양쪽부품", quantity: 7 },
    ]);

    // 🔴 사용 부품 칸 몫 — 한 줄, 수량 10.
    assert.deepEqual(mergeKyosanPartsForUsedParts(preview.plan.parts), [
      { text: "값-양쪽부품", quantity: 10 },
    ]);
  });

  test("🔴 수량이 없는 줄은 1 로 세어 더한다", () => {
    const merged = mergeKyosanPartsForUsedParts([
      // 둘 다 수량 열쇠가 없다 — 1 + 1.
      { kind: "fault", text: "값-부품A" },
      { kind: "preventive", text: "값-부품A" },
      // 한쪽만 없다 — 4 + 1.
      { kind: "fault", text: "값-부품B", quantity: 4 },
      { kind: "preventive", text: "값-부품B" },
    ]);
    assert.deepEqual(merged, [
      { text: "값-부품A", quantity: 2 },
      { text: "값-부품B", quantity: 5 },
    ]);
  });

  test("다른 부품끼리는 묶이지 않는다 — 이름 글자가 한 글자라도 다르면 따로다", () => {
    const merged = mergeKyosanPartsForUsedParts([
      { kind: "fault", text: "값-부품A", quantity: 2 },
      { kind: "fault", text: "값-부품A ", quantity: 3 },
      { kind: "preventive", text: "값-부품B", quantity: 5 },
    ]);
    assert.deepEqual(merged, [
      { text: "값-부품A", quantity: 2 },
      { text: "값-부품A ", quantity: 3 },
      { text: "값-부품B", quantity: 5 },
    ]);
  });

  /**
   * 차례는 **먼저 나온 자리**를 지킨다. 고장분이 앞에 오므로 「교체 부품」에
   * 보이는 차례와 같아지고, 예방분에만 있는 부품이 그 뒤에 붙는다.
   */
  test("차례는 먼저 나온 자리를 지킨다 — 뒤에 합쳐진 줄이 앞으로 오지 않는다", () => {
    const merged = mergeKyosanPartsForUsedParts([
      { kind: "fault", text: "값-첫째", quantity: 1 },
      { kind: "fault", text: "값-둘째", quantity: 1 },
      { kind: "preventive", text: "값-첫째", quantity: 9 },
      { kind: "preventive", text: "값-셋째", quantity: 2 },
    ]);
    assert.deepEqual(merged, [
      { text: "값-첫째", quantity: 10 },
      { text: "값-둘째", quantity: 1 },
      { text: "값-셋째", quantity: 2 },
    ]);
  });

  /**
   * 🔴 **묶는 것이므로 합계는 변하면 안 된다.** 실측 469장에서도 1,327줄 →
   * 1,163줄로 줄었지만 수량 합계 2,990 은 전후가 같았다.
   */
  test("🔴 수량 합계가 보존된다 — 줄 수만 줄어든다", () => {
    const parts: readonly KyosanPreviewPart[] = [
      { kind: "fault", text: "값-부품A", quantity: 3 },
      { kind: "preventive", text: "값-부품A", quantity: 7 },
      { kind: "fault", text: "값-부품B" },
      { kind: "preventive", text: "값-부품B", quantity: 6 },
      { kind: "fault", text: "값-부품C", quantity: 1 },
    ];
    const merged = mergeKyosanPartsForUsedParts(parts);
    assert.equal(merged.length, 3, "다섯 줄이 세 줄이 된다");
    assert.equal(
      merged.reduce((sum, line) => sum + line.quantity, 0),
      quantitySum(parts)
    );
    assert.equal(quantitySum(parts), 18);
  });

  test("부품이 없으면 빈 목록이다", () => {
    assert.deepEqual(mergeKyosanPartsForUsedParts([]), []);
  });
});
