import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CARD_FIELDS, CARD_LISTS, type CardFieldKey, type CardFields, type CardListKey } from "./card-fields";
import { buildKyosanServiceReportValues, kyosanOriginHeading } from "./report-save-values";
import type { KyosanImportPlan } from "./report-preview";
import { toServiceReportColumns } from "@/lib/validation/service-report-save-input";

/**
 * ============================================================================
 * 미리보기 그림 → 보고서 저장값 (조각 S3b)
 * ============================================================================
 * 못 박는 것은 넷이다.
 *  1. 🔴 **원문이 한 글자도 안 바뀐다** — 일본어 자유 기술을 번역하지도 다듬지도
 *     않는다(2026-09-21 사용자 결정 1). 근거는 머리글 줄로 따로 붙인다.
 *  2. 🔴 **교체 부품이 보고서 줄에도 들어간다**(2026-09-18 결정 — 둘 다).
 *  3. 🔴 **지어내지 않는다** — 읽지 못한 칸은 비워 둔다. 특히 숫자 칸에 자유
 *     글자를 넣으면 저장이 VALIDATION_ERROR 로 막힌다.
 *  4. 🔴 **저장이 실제로 받는 값이다** — `toServiceReportColumns` 가 통과해야
 *     한다. 그것이 이 사전이 맞는지의 유일한 자동 증거다.
 * ============================================================================
 */

function emptyCard(overrides: Partial<Record<CardFieldKey, string>> = {}): CardFields {
  const fields: Record<string, { value: string | null; labelAddress: null; valueAddress: null }> = {};
  for (const spec of CARD_FIELDS) {
    fields[spec.key] = { value: overrides[spec.key] ?? null, labelAddress: null, valueAddress: null };
  }
  const lists: Record<string, { values: string[]; labelCount: number; usedLegacy: boolean }> = {};
  for (const spec of CARD_LISTS) {
    lists[spec.key as CardListKey] = { values: [], labelCount: 0, usedLegacy: false };
  }
  return { fields, lists } as unknown as CardFields;
}

function planOf(overrides: Partial<KyosanImportPlan> = {}): KyosanImportPlan {
  return {
    repairCaseId: "11111111-1111-4111-8111-111111111111",
    intakeNumber: "D210105",
    lines: [],
    parts: [],
    causeMarks: [],
    actionMarks: [],
    photoCount: 0,
    formAssetCount: 0,
    ...overrides,
  };
}

const TODAY = "2026-09-21";

function build(plan: KyosanImportPlan, card: CardFields = emptyCard(), causeMarks: readonly string[] = []) {
  return buildKyosanServiceReportValues({ plan, card, causeMarks, today: TODAY });
}

describe("🔴 원문을 고치지 않는다", () => {
  test("내용 줄은 한 글자도 안 바뀌고, 근거는 머리글 줄로 따로 붙는다", () => {
    const { values } = build(
      planOf({
        lines: [
          { section: "FINDINGS", text: "ﾊﾞｲｱｽ電圧が出ない", origin: "고객 고장 상황" },
          { section: "FINDINGS", text: "  前置きの空白も残す", origin: "고객 고장 상황" },
          { section: "FINDINGS", text: "その他", origin: "원인(○ 표시)" },
        ],
      })
    );

    assert.equal(
      values.findings,
      [
        kyosanOriginHeading("고객 고장 상황"),
        "ﾊﾞｲｱｽ電圧が出ない",
        "  前置きの空白も残す",
        "",
        kyosanOriginHeading("원인(○ 표시)"),
        "その他",
      ].join("\n")
    );
    // 🔴 줄 앞에 라벨을 붙이지 않았다 — 붙이면 모든 줄이 원문이 아니게 된다.
    assert.equal(values.findings.includes("고객 고장 상황: "), false);
  });

  test("구역이 다르면 다른 칸으로 간다 — 비고는 비고로", () => {
    const { values } = build(
      planOf({
        lines: [
          { section: "ACTIONS", text: "部品交換", origin: "처치(○ 표시)" },
          { section: "REMARK", text: "再発時連絡", origin: "비고" },
        ],
      })
    );
    assert.equal(values.actions, [kyosanOriginHeading("처치(○ 표시)"), "部品交換"].join("\n"));
    assert.equal(values.remark, [kyosanOriginHeading("비고"), "再発時連絡"].join("\n"));
    assert.equal(values.findings, "");
    assert.equal(values.summary, "");
  });
});

describe("🔴 교체 부품은 보고서 줄에도 들어간다 (2026-09-18 결정)", () => {
  test("고장분·예방분이 조치 칸 끝에 머리글과 함께 붙는다", () => {
    const { values } = build(
      planOf({
        lines: [{ section: "ACTIONS", text: "点検", origin: "처치(○ 표시)" }],
        parts: [
          { kind: "fault", text: "RF-MODULE-A" },
          { kind: "preventive", text: "FAN-12V" },
        ],
      })
    );

    assert.equal(
      values.actions,
      [
        kyosanOriginHeading("처치(○ 표시)"),
        "点検",
        "",
        kyosanOriginHeading("교체 부품(고장)"),
        "RF-MODULE-A",
        "",
        kyosanOriginHeading("교체 부품(예방)"),
        "FAN-12V",
      ].join("\n")
    );
  });

  test("부품만 있고 처치 줄이 없으면 앞의 빈 줄이 생기지 않는다", () => {
    const { values } = build(planOf({ parts: [{ kind: "fault", text: "RF-MODULE-A" }] }));
    assert.equal(values.actions, [kyosanOriginHeading("교체 부품(고장)"), "RF-MODULE-A"].join("\n"));
  });
});

describe("머리 칸 — 읽은 것만 싣는다", () => {
  test("고객사·모델·L/N·S/N·인수일이 그대로 온다", () => {
    const { values } = build(
      planOf(),
      emptyCard({
        customer: "ICD Co.,Ltd",
        model: "RFK300FH-AD1",
        lotNumber: "WU8042",
        serialNumber: "8502021",
        receivedDate: "2026-03-04",
        filledDate: "2026-03-10",
      })
    );
    assert.equal(values.customerName, "ICD Co.,Ltd");
    assert.equal(values.modelName, "RFK300FH-AD1");
    assert.equal(values.lotNumber, "WU8042");
    assert.equal(values.serialNumber, "8502021");
    assert.equal(values.receivedOn, "2026-03-04");
    assert.equal(values.issuedOn, "2026-03-10");
  });

  test("발행일은 기입일 → 수리 완료일 → 조사 완료일 → 오늘 차례로 고른다", () => {
    assert.equal(build(planOf(), emptyCard({ repairEndDate: "2026-04-01" })).issuedOnOrigin, "수리 완료일");
    assert.equal(
      build(planOf(), emptyCard({ investigationEndDate: "2026-04-02" })).issuedOnOrigin,
      "조사 완료일"
    );

    const none = build(planOf(), emptyCard());
    assert.equal(none.issuedOnOrigin, "오늘");
    assert.equal(none.values.issuedOn, TODAY);
  });

  test("🔴 달력에 없는 날짜는 싣지 않는다 — 빈 칸이 된다", () => {
    const { values } = build(planOf(), emptyCard({ receivedDate: "2026-02-30", filledDate: "３月" }));
    assert.equal(values.receivedOn, "");
    assert.equal(values.issuedOn, TODAY);
  });

  test("🔴 문서번호를 지어내지 않는다 — 우리가 발행한 척이 되면 안 된다", () => {
    const { values } = build(planOf(), emptyCard({ repairReportNo: "KY-2026-118" }));
    assert.equal(values.reportNumberPrefix, "");
    assert.equal(values.reportNumberMiddle, "");
    assert.equal(values.reportNumberTail, "");
  });

  test("🔴 숫자 칸에 자유 글자를 넣지 않는다 — 넣으면 저장이 막힌다", () => {
    const { values } = build(planOf(), emptyCard({ usagePeriod: "11年3ヶ月" }));
    assert.equal(values.usedYears, "");
    assert.equal(values.usedMonths, "");
    assert.equal(values.manufacturedYear, "");
    assert.equal(values.manufacturedMonth, "");
  });

  test("🔴 「처치」 ○ 는 체크칸으로 옮기지 않는다 — 문서가 사실과 달라질 수 있다", () => {
    const { values } = build(planOf({ actionMarks: ["現品引取", "処置完了"] }));
    assert.equal(values.onSiteRepair, false);
    assert.equal(values.replacementDelivery, false);
    assert.equal(values.goodsReceiptChecked, false);
    assert.equal(values.completionChecked, false);
  });

  test("findingsIntro 는 「안 줌」(null) 이다 — 채우개가 정형 문구를 넣는다", () => {
    assert.equal(build(planOf()).values.findingsIntro, null);
  });
});

describe("원인", () => {
  test("○ 가 우리 원인으로 들어가고, 대응 없는 것은 「기타」로", () => {
    const mapped = build(planOf(), emptyCard(), ["部品不良", "謎の原因"]);
    assert.deepEqual(mapped.values.causes, ["PART_DEFECT", "OTHER"]);
    assert.deepEqual(mapped.unmappedCauseMarks, ["謎の原因"]);
  });
});

describe("🔴 저장이 실제로 받는 값이다", () => {
  test("빈 연락서도 toServiceReportColumns 를 통과한다 — 발행일이 NOT NULL 이다", () => {
    const converted = toServiceReportColumns(build(planOf()).values);
    assert.equal(converted.ok, true, JSON.stringify(converted));
  });

  test("칸이 다 찬 연락서도 통과하고, 본문이 줄 표로 쪼개진다", () => {
    const { values } = build(
      planOf({
        lines: [
          { section: "FINDINGS", text: "不具合①", origin: "고객 고장 상황" },
          { section: "SUMMARY", text: "正常動作確認", origin: "사내 확인 결과" },
        ],
        parts: [{ kind: "fault", text: "RF-MODULE-A" }],
      }),
      emptyCard({ customer: "ICD Co.,Ltd", filledDate: "2026-03-10" }),
      ["その他"]
    );

    const converted = toServiceReportColumns(values);
    assert.equal(converted.ok, true, JSON.stringify(converted));
    if (!converted.ok) return;

    assert.equal(converted.data.columns.issuedOn, "2026-03-10");
    assert.equal(converted.data.columns.customerNameText, "ICD Co.,Ltd");
    // 발생 년월일을 아예 안 적었으므로 mode 는 NULL 이다.
    assert.equal(converted.data.columns.occurredOnMode, null);
    assert.deepEqual(converted.data.causes, ["OTHER"]);
    assert.deepEqual(
      converted.data.lines.map((line) => `${line.section}/${line.lineNo}/${line.text}`),
      [
        "FINDINGS/1/[고객 고장 상황]",
        "FINDINGS/2/不具合①",
        "ACTIONS/1/[교체 부품(고장)]",
        "ACTIONS/2/RF-MODULE-A",
        "SUMMARY/1/[사내 확인 결과]",
        "SUMMARY/2/正常動作確認",
      ]
    );
  });
});
