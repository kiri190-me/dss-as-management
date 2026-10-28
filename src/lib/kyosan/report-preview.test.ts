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
import type {
  KyosanEstimatedPart,
  KyosanEstimatedRepairBlock,
} from "./estimated-repair-block";
import type { KyosanReport } from "./kyosan-report";
import type { KyosanDetailPart } from "./parts-detail-sheet";
import { matchKyosanReport, readKyosanIdentity, type KyosanCaseCandidate } from "./report-match";
import { KYOSAN_FORM_ASSET_SHA256 } from "./report-photo-filter";
import type { KyosanPhoto } from "./report-photos";
import {
  buildKyosanReportPreview,
  mergeKyosanPartsForUsedParts,
  KYOSAN_OVERHAUL_RECOMMENDATION_ORIGIN,
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
    // 🔴 **옵셔널로 두지 않았다.** 이 도움 함수가 기본값을 정하는 유일한 자리다 —
    //    새 출처를 안 태우는 경로가 조용히 생기지 않게 리터럴에 적는다.
    estimatedRepair: null,
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
/**
 * 🔴 `model`(`型式`)을 따로 주지 않으면 **이름과 같은 글자**를 채운다
 * (2026-10-28). 판독기가 이름을 `型式` 칸에서 가져오므로, 이름이 있는데 세 곁
 * 칸이 다 비어 있는 줄은 **실제로는 나올 수 없다** — 그런 본보기를 두면 다음
 * 사람이 그것을 사실로 읽는다. 미리보기가 보는 것은 `name`·`kind`·`quantity`
 * 뿐이라 아래 시험들의 결과는 이 채움과 무관하다.
 */
function detailPartOf(overrides: Partial<KyosanDetailPart> = {}): KyosanDetailPart {
  const part: KyosanDetailPart = {
    name: "값-부품A",
    model: null,
    partName: null,
    spec: null,
    kind: "fault",
    quantity: null,
    status: null,
    measure: null,
    sheetName: "交換部品詳細",
    address: "D8",
    ...overrides,
  };
  return part.model === null ? { ...part, model: part.name } : part;
}

describe("교체 부품 — 🔴 출처를 장마다 하나만 고른다(`交換部品詳細` 먼저, 없으면 Card)", () => {
  /**
   * 🔴 **뜻을 다시 정한 시험 — 제목이 두 번 바뀌었다.**
   *
   *   2026-09-22 「두 시트에 같은 부품이 있으면 두 번 들어가지 않는다」
   *     → 그 규칙이 **갈래를 안 보아** 한쪽 갈래를 통째로 삼켰다. 갈래를 넣어
   *       고쳤고, 그 뜻은 `같은 부품이 고장분에도 예방분에도 있으면…` 시험이 잇는다.
   *   2026-10-28 🔴 **이 시험이 이번 결함을 통과시킨 자리다.** 기대값에 Card 줄
   *     (`값-부품B`)이 들어 있어서 「Card 이름이 함께 들어간다」가 초록 ✔ 로
   *     지켜지고 있었다. 사용자가 실물을 열어 **`交換部品詳細` 에 2줄인 연락서에
   *     사용 부품이 4건** 들어간 것을 짚었다(일본어 설명 둘이 한글로 번역돼
   *     품번 둘과 나란히 들어가 있었다).
   *
   * 🔵 **되살아나면 깨지는 단언**: `交換部品詳細` 가 부품을 내면 Card 의 이름은
   * **하나도** 들어가지 않는다. 그래서 詳細의 이름을 Card 와 **겹치지 않는 글자**로
   * 둔다 — 겹치면 「겹침을 걸렀을 뿐」인지 「Card 를 안 담았는지」를 못 가린다.
   */
  test("🔴 `交換部品詳細` 가 부품을 내면 Card 의 이름은 하나도 안 들어간다 — 품번만 남는다", () => {
    const report = reportOf({
      detailParts: [detailPartOf({ name: "값-품번A", quantity: 4, kind: "fault" })],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-품번A", quantity: 4 }]);
    // 🔴 Card 의 `값-부품A`(고장) · `값-부품B`(예방)가 **둘 다** 빠졌다.
    assert.equal(
      preview.plan.parts.some((part) => part.text === "값-부품A" || part.text === "값-부품B"),
      false
    );
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
   * 🔴 **받아들인 손해를 값으로 적어 둔다** (2026-10-28). `交換部品詳細` 가 부품을
   * 낸 장에서는 **Card 에만 있고 詳細에는 없는 부품이 들어가지 않는다.** 사용자가
   * 「`型式`(품번)만 나오는 것이 맞다」를 골랐으므로 **받아들인 손해**이고, 몰래
   * 넘어가지 않게 시험으로 적는다. 🔴 그런 부품이 실제로 몇 건인지는 **재지
   * 못했다** — 연락서 원본(xlsm)이 저장소에 없다.
   *
   * ⚠️ 예전 제목은 「🔴 Card 로 들어온 줄에 다른 갈래의 수량이 붙지 않는다」였다.
   * 그 규칙(`quantityByKindAndText` 가 갈래까지 본다)은 **그대로 살아 있고**, 이제
   * `交換部品詳細` 안의 두 갈래로 재는 쪽(`같은 부품이 고장분에도 예방분에도 있으면
   * 두 줄로 남는다 — 수량도 갈래별로`)이 혼자 지킨다. Card 줄이 아예 안 생겨서다.
   */
  test("🔴 Card 에만 있는 부품은 `交換部品詳細` 가 부품을 낸 장에서 빠진다 — 받아들인 손해", () => {
    const report = reportOf({
      card: cardOf(
        { intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" },
        { faultParts: ["값-카드에만있는부품"] }
      ),
      detailParts: [detailPartOf({ name: "값-품번A", kind: "fault", quantity: 2 })],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-품번A", quantity: 2 }]);
  });

  /**
   * ⚠️ 예전 제목은 「🔴 詳細 시트에만 있는 부품이 **뒤에 이어 붙는다**」였다 —
   * Card 가 앞에 오고 詳細가 뒤에 붙던 때의 글이다. 2026-10-28 뒤로 **앞에 붙을
   * Card 줄이 없다.** 지켜야 할 것(詳細 안의 차례가 흩어지지 않는다 · (RF)/(DC)
   * 두 시트가 이어 붙는다)은 그대로라 자료를 그대로 두고 기대값만 고쳤다.
   */
  test("🔴 `交換部品詳細` 의 차례 그대로 들어간다 — Card 가 앞에 붙지 않는다", () => {
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
   * ⚠️ **줄을 하나로 묶는 규칙은 바뀌지 않았다.** 같은 갈래 안의 겹침은 지금처럼
   * 한 번만 넣는다(실측 예: `終段AMPゲート基板` 이 `予防③`·`予防⑩` 두 줄).
   * 화면이 `` `${kind}-${text}` `` 를 React key 로 쓰므로 같은 갈래에서 두 줄을
   * 내면 열쇠가 부딪친다.
   *
   * 🔴 **바뀐 것은 수량이다** (2026-10-29). 예전 제목과 기대값을 인용해 남긴다:
   *
   *     「🔴 같은 갈래에서 같은 이름이 詳細 시트에 두 줄이면 한 번만,
   *       **수량은 첫 줄에서**」 · `[{ kind: "fault", text: "값-부품E", quantity: 3 }]`
   *
   * 🔴 수량 9 가 **아무 까닭 없이 버려지고 있었다.** 위 문단이 대는 근거는
   * 「줄을 하나로 묶는다」뿐이고, 수량까지 버려야 할 까닭은 어디에도 적혀 있지
   * 않았다. `予防③` 과 `予防⑩` 은 **두 번의 서로 다른 교체**다. 같은 파일의
   * `推定修理内容` 경로는 2026-09-22 부터 「먼저 나온 줄만 남기면 뒤 줄의 수량이
   * 사라진다」며 **더하고** 있었고, 두 경로가 서로 다른 규칙으로 돌고 있었다.
   * (`report-preview.ts` 의 「같은 갈래 안의 겹침」 절.)
   */
  test("🔴 같은 갈래에서 같은 이름이 詳細 시트에 두 줄이면 한 번만, 수량은 **더한다**", () => {
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
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-부품E", quantity: 12 }]);
  });

  /**
   * 🔵 **수량이 안 적힌 줄이 섞인 자리.** 더하기를 넣으면서 여기가
   * `undefined + 9` 가 되지 않는지, 그리고 **한 줄뿐인 빈 수량**은 여전히 열쇠
   * 없이 남는지(바로 아래 시험)를 함께 못 박는다. 안 적힌 줄은 1 로 센다 —
   * 넣는 쪽의 `?? 1` 과 같은 규칙이다(`kyosan-report-import.ts`).
   */
  test("🔴 수량이 안 적힌 줄이 섞이면 1 로 세어 더한다 — `undefined` 로 새지 않는다", () => {
    const report = reportOf({
      card: cardOf({ intakeNumber: "D210105", model: "FAKE-100", serialNumber: "SN-0001" }),
      detailParts: [
        detailPartOf({ name: "값-부품G", quantity: null, kind: "fault" }),
        detailPartOf({ name: "값-부품G", quantity: 9, kind: "fault" }),
      ],
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-부품G", quantity: 10 }]);
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

  /**
   * 🔵 **Card 로 떨어지는 길이 살아 있다.** `交換部品詳細` 가 부품을 못 내는 장에서
   * Card 는 **유일한 출처**다. 🔴 2026-10-28 에 「詳細가 부품을 내면 그 줄만 쓴다」로
   * 좁혔는데, 이것을 「Card 를 통째로 걷어낸다」로 읽으면 그런 장들이 부품을 **전부**
   * 잃는다 — 이 시험이 그 오독을 막는다.
   */
  test("🔴 詳細 시트가 비면 Card 시트만으로 뽑는다 — Card 로 떨어지는 길이 살아 있다", () => {
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

  test("다른 부품끼리는 묶이지 않는다", () => {
    const merged = mergeKyosanPartsForUsedParts([
      { kind: "fault", text: "값-부품A", quantity: 2 },
      { kind: "fault", text: "값-부품AA", quantity: 3 },
      { kind: "preventive", text: "값-부품B", quantity: 5 },
    ]);
    assert.deepEqual(merged, [
      { text: "값-부품A", quantity: 2 },
      { text: "값-부품AA", quantity: 3 },
      { text: "값-부품B", quantity: 5 },
    ]);
  });

  /**
   * 🔴 **표기 변이는 눌러 묶는다** (2026-09-22, 사용자 승인). 손으로 적은 이름은
   * 같은 물건이 표기만 달라지는 일이 흔하다 — 실측 전수 11묶음이고 **서로 다른
   * 부품이 잘못 붙는 경우는 0건**이다.
   *
   * 🔴 여기 쓰는 세 글자는 **실측 글자 그대로**다(`report-preview.ts` 머리말의
   * 목록에 있는 것). 자리표로 바꾸면 장음류가 무엇인지 시험이 못 말한다.
   */
  test("🔴 표기 변이는 한 줄로 묶인다 — 장음류와 공백을 눌러 견준다", () => {
    const merged = mergeKyosanPartsForUsedParts([
      { kind: "fault", text: "スプリッタ基板", quantity: 1 },
      { kind: "fault", text: "スプリッター基板", quantity: 2 },
      // `―`(U+2015) 를 장음 대신 쓴 것. 실측에 있는 표기다.
      { kind: "preventive", text: "スプリッタ―基板", quantity: 4 },
      // 공백만 다른 것. NFKC + 공백 제거로 같아진다.
      { kind: "preventive", text: "RF コントロール パネル", quantity: 1 },
      { kind: "fault", text: "RFコントロールパネル", quantity: 2 },
    ]);
    assert.deepEqual(merged, [
      { text: "スプリッタ基板", quantity: 7 },
      { text: "RF コントロール パネル", quantity: 3 },
    ]);
  });

  /**
   * 🔴 **보이는 이름은 그 묶음에서 가장 많이 쓰인 표기**다. 누른 값을 그대로
   * 보여 주면 `RFコントロルパネル` 처럼 **연락서에 없는 글자**가 사용 부품 칸에
   * 적힌다.
   */
  test("🔴 보이는 이름은 가장 많이 쓰인 표기다 — 누른 값이 아니다", () => {
    const merged = mergeKyosanPartsForUsedParts([
      { kind: "fault", text: "スプリッタ―基板", quantity: 1 },
      { kind: "fault", text: "スプリッター基板", quantity: 2 },
      { kind: "preventive", text: "スプリッター基板", quantity: 3 },
    ]);
    // 먼저 나온 것이 아니라 **두 번 나온 표기**가 남는다.
    assert.deepEqual(merged, [{ text: "スプリッター基板", quantity: 6 }]);
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
   * 🔴 **묶는 것이므로 합계는 변하면 안 된다.** 실측 469장에서도 1,235줄 →
   * 1,085줄로 줄었지만 수량 합계 2,874 는 전후가 같았다(2026-09-22,
   * `推定修理内容` 을 세 번째 출처로 들인 뒤. 들이기 전에는 1,327 → 1,163 ·
   * 수량 2,990 이었고, 추정 블록을 떼고 재면 지금 코드로도 그 값이 나온다).
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

// ── 推定修理内容 — 세 번째 출처 · 장 단위 갈아타기 ────────────────────────

function estimatedPartOf(
  overrides: Partial<KyosanEstimatedPart> = {}
): KyosanEstimatedPart {
  return {
    name: "값-손글씨부품",
    kind: "fault",
    quantity: 1,
    group: "fault",
    mood: "will",
    sheetName: "進捗状況連絡書",
    address: "A131",
    sourceLine: "・값-손글씨부품の交換…1個",
    ...overrides,
  };
}

function estimatedOf(
  overrides: Partial<KyosanEstimatedRepairBlock> = {}
): KyosanEstimatedRepairBlock {
  return {
    sheetName: "進捗状況連絡書",
    labelAddress: "A130",
    endAddress: "A150",
    parts: [],
    overhaulRecommendations: [],
    ...overrides,
  };
}

/**
 * 🔴 `reportOf()` 의 기본값에는 Card 목록의 `값-부품A`(고장) · `값-부품B`(예방)가
 * 들어 있다. 아래 시험들은 그것이 **나타나는가/사라지는가**로 갈아타기를 잰다.
 */
describe("推定修理内容 — 🔴 장 단위로 갈아탄다", () => {
  /**
   * 🔴 **뜻을 뒤집은 시험** (2026-10-28). 예전 제목은 「🔴 추정수리내용이 부품을
   * 냈으면 그 이름만 쓴다 — 대장 이름은 섞이지 않는다」였고, 같은 자료에서
   * `값-손글씨A`·`값-손글씨B` 만 나오는 것을 못 박고 있었다.
   *
   * 🔵 사용자가 실물 연락서 두 장을 열어 보여 주었다 — **재고관리 부품명과 같은
   * 글자(품번)는 `交換部品詳細` 시트에만 있다.** 그런데 옛 차례 때문에 **두 장
   * 다 품번이 멀쩡히 있는데도 손글씨 이름을 쓰고 있었다.** 그래서 이기는 쪽을
   * 뒤집었다.
   *
   * 🔵 **되살아나면 깨지는 단언이다** — 되돌리면 손글씨 둘만 남아 여기서 깨진다.
   *
   * ⚠️ **기대값이 같은 날 한 번 더 바뀌었다** (2026-10-28, 두 번째 고침). 처음에는
   * `[값-부품A, 값-부품B, 값-품번A]` — **Card 두 줄이 함께 들어간 모양**이었고,
   * 그것이 사용자가 짚은 「2줄짜리 연락서에 4건」의 모양이다. 지금은 `交換部品詳細`
   * 의 줄만 남는다. 🔴 **세 출처 가운데 하나만 나온다**는 것이 요점이다.
   */
  test("🔴 `交換部品詳細` 가 부품을 냈으면 **그것만** 쓴다 — 추정수리내용도 Card 도 안 섞인다", () => {
    const report = reportOf({
      detailParts: [detailPartOf({ name: "값-품번A", quantity: 4, kind: "fault" })],
      estimatedRepair: estimatedOf({
        parts: [
          estimatedPartOf({ name: "값-손글씨A", kind: "fault", quantity: 3 }),
          estimatedPartOf({ name: "값-손글씨B", kind: "preventive", quantity: 7 }),
        ],
      }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-품번A", quantity: 4 }]);
    // 🔴 손글씨도 Card 도 **하나도** 없다.
    assert.equal(
      preview.plan.parts.some((part) => part.text.startsWith("값-손글씨")),
      false
    );
    assert.equal(
      preview.plan.parts.some((part) => part.text === "값-부품A" || part.text === "값-부품B"),
      false
    );
  });

  /**
   * 🔵 **그 길은 그대로 산다** — `交換部品詳細` 가 부품 줄을 **못 내면** 지금처럼
   * `推定修理内容` 으로 떨어진다. 🔴 이것이 없으면 뒤집기가 「손글씨 출처를
   * 걷어낸 것」이 되어 버린다(사용자가 화면을 보고 두 번 짚어 들인 출처다).
   */
  test("🔴 `交換部品詳細` 가 비면 추정수리내용으로 떨어진다 — 손글씨 출처가 살아 있다", () => {
    const report = reportOf({
      detailParts: [],
      estimatedRepair: estimatedOf({
        parts: [
          estimatedPartOf({ name: "값-손글씨A", kind: "fault", quantity: 3 }),
          estimatedPartOf({ name: "값-손글씨B", kind: "preventive", quantity: 7 }),
        ],
      }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    // Card 의 `값-부품A`·`값-부품B` 도 들어오지 않는다 — 한 장에서 두 출처를 섞지 않는다.
    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-손글씨A", quantity: 3 },
      { kind: "preventive", text: "값-손글씨B", quantity: 7 },
    ]);
  });

  // ⚠️ 2026-10-28 뒤로 이 장은 **첫 관문**에서 `交換部品詳細` 로 간다(詳細에 줄이
  //    있다). 「추정수리내용이 비면」을 홀로 재는 자리는 아래 `O/H 권유만` 짝
  //    시험으로 옮겨 두었다. 기대값에서 Card 줄(`값-부품B`)이 빠진 것은 같은 날
  //    두 번째 고침이다 — 詳細가 이긴 장에는 Card 가 안 담긴다.
  test("추정수리내용이 부품을 못 냈으면 `交換部品詳細` 의 줄을 쓴다", () => {
    const report = reportOf({
      detailParts: [detailPartOf({ name: "값-품번A", quantity: 4, kind: "fault" })],
      estimatedRepair: estimatedOf({ parts: [] }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-품번A", quantity: 4 }]);
  });

  /**
   * 🔴 지시서의 글은 「O/H 권유만 적힌 장은 빈 장으로 떨어진다」였는데, 그러면
   * 그 19장에서 `交換部品詳細` 에 적혀 있는 부품이 통째로 사라진다(그중 16장에
   * 부품이 있다). 실측 기대값 「부품 0건 장 106」도 되돌리는 쪽에서만 맞는다 —
   * 떨어뜨리면 122장이 된다. 그래서 **되돌린다.**
   */
  test("🔴 O/H 권유만 있는 장은 `交換部品詳細` 쪽으로 되돌린다 — 부품을 통째로 잃지 않는다", () => {
    const report = reportOf({
      detailParts: [detailPartOf({ name: "값-품번A", quantity: 4, kind: "fault" })],
      estimatedRepair: estimatedOf({
        parts: [],
        overhaulRecommendations: ["O/Hとして以下の作業を推奨致します。", "・값-오버홀부품の交換…7枚"],
      }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-품번A", quantity: 4 }]);
    // 🔴 O/H 권유는 **수량에 안 들어가고** 원문이 줄로 남는다.
    assert.equal(
      preview.plan.parts.some((part) => part.text === "값-오버홀부품"),
      false
    );
  });

  /**
   * 🔴 **위 시험의 짝** (2026-10-28). 이기는 쪽이 뒤집힌 뒤로 위 장은 `交換部品詳細`
   * 에 줄이 있어 **첫 관문에서** 지금까지의 길로 간다 — 그래서 「O/H 권유만 적힌
   * 장을 빈 장으로 떨어뜨리지 않는다」는 멈춤막(`parts.length > 0`)을 더 이상
   * 혼자 재지 못한다. 이 시험이 그 자리를 이어받는다: `交換部品詳細` 가 비어 있고
   * 추정수리내용에 **O/H 권유만** 있는 장이다. 멈춤막을 걷어내면 부품이 0줄이 되어
   * 여기서 깨진다.
   */
  test("🔴 `交換部品詳細` 도 비고 O/H 권유만 있으면 Card 로 떨어진다 — 부품을 통째로 잃지 않는다", () => {
    const report = reportOf({
      detailParts: [],
      estimatedRepair: estimatedOf({
        parts: [],
        overhaulRecommendations: ["O/Hとして以下の作業を推奨致します。", "・값-오버홀부품の交換…7枚"],
      }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [
      { kind: "fault", text: "값-부품A" },
      { kind: "preventive", text: "값-부품B" },
    ]);
  });

  test("같은 갈래·같은 이름이 두 줄이면 **수량을 더한다** — 뒤 줄을 잃지 않는다", () => {
    const report = reportOf({
      estimatedRepair: estimatedOf({
        parts: [
          estimatedPartOf({ name: "값-손글씨A", kind: "fault", quantity: 3 }),
          estimatedPartOf({ name: "값-손글씨A", kind: "fault", quantity: 1 }),
          // 수량이 안 적힌 줄은 1 로 센다.
          estimatedPartOf({ name: "값-손글씨A", kind: "fault", quantity: null }),
        ],
      }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-손글씨A", quantity: 5 }]);
  });

  test("수량이 한 줄도 없으면 열쇠 자체를 두지 않는다 — 넣는 쪽이 1 로 센다", () => {
    const report = reportOf({
      estimatedRepair: estimatedOf({
        parts: [estimatedPartOf({ name: "값-손글씨A", quantity: null })],
      }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(preview.plan.parts, [{ kind: "fault", text: "값-손글씨A" }]);
  });
});

describe("推定修理内容 — 🔴 O/H 권유 원문은 작업 이력으로", () => {
  test("원문이 미리보기 줄로 나온다 — 항목 이름이 그것을 말한다", () => {
    const report = reportOf({
      estimatedRepair: estimatedOf({
        parts: [estimatedPartOf({ name: "값-손글씨A", quantity: 3 })],
        overhaulRecommendations: ["O/Hとして以下の作業を推奨致します。", "・값-오버홀부품の交換…7枚"],
      }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.deepEqual(
      preview.plan.lines
        .filter((line) => line.origin === KYOSAN_OVERHAUL_RECOMMENDATION_ORIGIN)
        .map((line) => [line.section, line.text]),
      [
        ["ACTIONS", "O/Hとして以下の作業を推奨致します。"],
        ["ACTIONS", "・값-오버홀부품の交換…7枚"],
      ]
    );
  });

  // 🔴 그 줄이 **어느 칸으로 가는가**는 `report-detail-values.test.ts` 가 못 박는다.

  test("권유가 없으면 줄도 없다", () => {
    const report = reportOf({
      estimatedRepair: estimatedOf({ parts: [estimatedPartOf({ name: "값-손글씨A" })] }),
    });
    const preview = previewOf(report, caseOf(), stateOf());
    assert.ok(preview.plan);
    if (!preview.plan) return;
    assert.equal(
      preview.plan.lines.some((line) => line.origin === KYOSAN_OVERHAUL_RECOMMENDATION_ORIGIN),
      false
    );
  });
});
