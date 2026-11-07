import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  classifyDeliveredDateLine,
  deliveredDateSurveyMismatch,
  summarizeDeliveredDateSync,
  type SurveyOrderLine,
} from "./delivered-date-sync-survey";

/**
 * ============================================================================
 * 납품일 ↔ 실제 출하일을 **옮기기 전에 세는 규칙**의 시험 (2026-11-07)
 * ============================================================================
 * 이 셈이 틀리면 **설계 결정이 틀린다** — 「어느 쪽 값을 살리나」를 그 수로 정하고,
 * 옮기는 순간 진 쪽 값은 돌아오지 않는다. 그런데 그 수는 운영 자료를 봐야 나오는 수라
 * **아무도 눈으로 검산할 수 없다.** 그래서 셈만 떼어 값으로 못 박는다
 * (이웃 `requested-due-date-sync-survey.test.ts` 와 같은 이유).
 *
 * ── 🔴 여기서 지키는 경계 ───────────────────────────────────────────────
 *   ① **갈래는 `linkedToRepairCase` 하나가 정한다.** 수리 건이 실려 왔는지로 가르면
 *      조인이 샌 날 수리 건이 붙은 줄이 조용히 기타건으로 세어진다. 그 어긋남은
 *      「말이 어긋난 줄」로 세어져 검산에서 멈춰야 한다.
 *   ② **「못 읽었다」와 「없다」는 다른 말이다.** 수리 건을 못 읽은 줄은 `case-unreadable`
 *      이지 「출하일이 없는 줄」이 아니다.
 *   ③ **「다르다」에 여유가 없다** — 하루만 달라도 다름이다. 며칠까지 같은 것으로 쳐
 *      주면, 운송 때문에 벌어진 줄이 「같다」로 세어져 사람이 거꾸로 판단한다.
 *   ④ **잴 줄이 없으면 날수는 `null` 이다 — 0 이 아니다.** 0 으로 찍으면 「차이가 0일인
 *      줄들이 있다」로 읽힌다.
 *   ⑤ **본보기에 나가는 글자는 접수번호뿐이다.** 납품자 이름 · 비고 글자는 타입에
 *      들어올 자리가 없고, 기타건 줄은 본보기를 만들지 않는다.
 *
 * ── 🔴 이름·번호는 전부 **지어낸 것**이다 ───────────────────────────────
 * 실제 접수번호·고객사를 시험에 적지 않는다. 한 번 적힌 글자는 이력에 영영 남는다.
 * ============================================================================
 */

/** 지어낸 접수번호. 규칙(`D` + 연 2자리 + 월 2자리 + 일련 2자리)만 흉내 낸 값이다. */
const CASE_NO = {
  differDeliveredLater: "D990101",
  differDeliveredEarlier: "D990102",
  same: "D990103",
  deliveredOnly: "D990104",
  shipmentOnly: "D990105",
  neither: "D990106",
  unreadable: "D990107",
} as const;

function due(dueDate: string, hasNote = false) {
  return { dueDate, hasNote };
}

/** 수리 건이 붙은 줄 하나. 안 적은 것은 전부 「비어 있음」이다. */
function linkedLine(
  intakeNumber: string,
  overrides: Partial<SurveyOrderLine> & { actualShipmentDate?: string | null; caseDeleted?: boolean } = {}
): SurveyOrderLine {
  const { actualShipmentDate = null, caseDeleted = false, ...rest } = overrides;
  return {
    linkedToRepairCase: true,
    repairCase: {
      // 🔵 열쇠는 접수번호와 **따로** 둔다 — 그 칸은 UNIQUE 가 아니다(아래 ⑭ 시험).
      key: `key-${intakeNumber}`,
      intakeNumber,
      actualShipmentDate,
      isDeleted: caseDeleted,
    },
    deliveredDate: null,
    hasDeliveredBy: false,
    hasLegacyRequestedDueDate: false,
    dueDateRows: [],
    ...rest,
  };
}

/** 기타건 줄 하나 — 수리 건이 안 붙은 줄이다. */
function miscLine(overrides: Partial<SurveyOrderLine> = {}): SurveyOrderLine {
  return {
    linkedToRepairCase: false,
    repairCase: null,
    deliveredDate: null,
    hasDeliveredBy: false,
    hasLegacyRequestedDueDate: false,
    dueDateRows: [],
    ...overrides,
  };
}

/**
 * 여덟 줄짜리 표본. **여섯 칸과 두 갈래와 두 방향, 그리고 납기요청일 0·1·2행이 전부 한
 * 번씩 나온다** — 아래 첫 묶음이 그것을 먼저 단언한다(표본이 한쪽으로 쏠려 있으면 나머지
 * 단언이 공짜로 통과한다).
 */
const SAMPLE_LINES: SurveyOrderLine[] = [
  // ⑤ 다름 — 납품일이 이틀 늦다(보낸 뒤에 받았다)
  linkedLine(CASE_NO.differDeliveredLater, {
    actualShipmentDate: "2026-03-10",
    deliveredDate: "2026-03-12",
    dueDateRows: [due("2026-03-01")],
  }),
  // ⑤ 다름 — 납품일이 닷새 이르다. 납기요청일이 2행이고 납품일이 그중 하나와 같다
  linkedLine(CASE_NO.differDeliveredEarlier, {
    actualShipmentDate: "2026-04-20",
    deliveredDate: "2026-04-15",
    dueDateRows: [due("2026-04-10", true), due("2026-04-15")],
  }),
  // ⑥ 같음 + 옛 칸에 값이 남아 있다
  linkedLine(CASE_NO.same, {
    actualShipmentDate: "2026-05-05",
    deliveredDate: "2026-05-05",
    hasLegacyRequestedDueDate: true,
    dueDateRows: [due("2026-05-01")],
  }),
  // ⑦ 납품일만 — 그리고 납기요청일이 0행이라 **달 행이 없다**(⑬)
  linkedLine(CASE_NO.deliveredOnly, { deliveredDate: "2026-06-06" }),
  // ⑦ 실제 출하일만 — 그 수리 건은 휴지통에 들어 있다(그래도 갈래는 「붙은 줄」이다)
  linkedLine(CASE_NO.shipmentOnly, {
    actualShipmentDate: "2026-07-07",
    caseDeleted: true,
    dueDateRows: [due("2026-07-01")],
  }),
  // 둘 다 빔 — 그런데 납품자는 적혀 있다(누가 했는지는 아는데 언제인지 모른다)
  linkedLine(CASE_NO.neither, { hasDeliveredBy: true, dueDateRows: [due("2026-08-01")] }),
  // 🔴 수리 건을 못 읽었다 — 「출하일이 없는 줄」이 아니다
  { ...linkedLine(CASE_NO.unreadable), repairCase: null },
  // 기타건 — 납기요청일 2행 + 납품일(어느 행과도 다르다) + 납품자 + 옛 칸
  miscLine({
    deliveredDate: "2026-08-08",
    hasDeliveredBy: true,
    hasLegacyRequestedDueDate: true,
    dueDateRows: [due("2026-08-01"), due("2026-08-20")],
  }),
];

describe("무엇을 재고 있는가 — 표본이 비어 공짜로 통과하지 않게", () => {
  const survey = summarizeDeliveredDateSync(SAMPLE_LINES);

  test("🔴 여섯 칸이 전부 한 번씩 나온다 — 한쪽으로 쏠린 표본이 아니다", () => {
    assert.equal(survey.lines, 8);
    assert.deepEqual(survey.buckets, {
      differ: 2,
      same: 1,
      "delivered-only": 1,
      "shipment-only": 1,
      neither: 1,
      "case-unreadable": 1,
    });
  });

  test("🔴 두 갈래가 전부 나온다 — 기타건이 빠진 표본이 아니다", () => {
    assert.equal(survey.linkedLines, 7);
    assert.equal(survey.miscLines, 1);
  });

  test("🔴 두 방향이 전부 나온다", () => {
    assert.equal(survey.differ.deliveredLater, 1);
    assert.equal(survey.differ.deliveredEarlier, 1);
    assert.equal(survey.differ.unmeasured, 0);
  });

  test("🔴 납기요청일 0행 · 1행 · 2행 이상이 전부 나온다", () => {
    assert.deepEqual(survey.dueDateRowBuckets.linked, { none: 2, one: 4, many: 1 });
    assert.deepEqual(survey.dueDateRowBuckets.misc, { none: 0, one: 0, many: 1 });
  });

  test("🔴 검산이 통과한다 — 갈래의 합 · 칸의 합 · 방향의 합 · 행 분포의 합", () => {
    assert.equal(deliveredDateSurveyMismatch(survey), null);
  });

  test("② 납품일 · ③ 납품자 · ④ 실제 출하일을 갈래별로 센다", () => {
    assert.deepEqual(survey.deliveredDateLines, { linked: 4, misc: 1 });
    assert.deepEqual(survey.deliveredByLines, { linked: 1, misc: 1 });
    assert.deepEqual(survey.deliveredByWithoutDateLines, { linked: 1, misc: 0 });
    assert.equal(survey.shipmentDateLines, 4);
  });

  test("⑤ 벌어진 날수 — 가장 큰 것 · 가운데쯤 · 부호를 살린 양 끝", () => {
    // 두 줄의 벌어짐은 +2일과 -5일이다.
    assert.equal(survey.differ.gapDaysMaxAbs, 5);
    assert.equal(survey.differ.gapDaysMedianAbs, 2);
    assert.equal(survey.differ.gapDaysMin, -5);
    assert.equal(survey.differ.gapDaysMax, 2);
  });

  test("⑨ 행 수 합계 · ⑩ 비고가 적힌 행", () => {
    assert.deepEqual(survey.dueDateRows, { linked: 6, misc: 2 });
    assert.deepEqual(survey.notedDueDateRows, { linked: 1, misc: 0 });
  });

  test("⑪ 2행 이상인데 납품일이 적힌 줄 — 그중 행과 같은 줄을 따로 센다", () => {
    assert.deepEqual(survey.ambiguousTargetLines, { linked: 1, misc: 1 });
    // 수리 건 쪽 줄은 납품일(04-15)이 행 하나와 같고, 기타건 쪽은 어느 행과도 다르다.
    assert.deepEqual(survey.ambiguousTargetLinesMatchingADueDate, { linked: 1, misc: 0 });
  });

  test("⑫ 옛 칸에 값이 남은 줄 · ⑬ 달 행이 없는데 납품일이 적힌 줄", () => {
    assert.deepEqual(survey.legacyRequestedDueDateLines, { linked: 1, misc: 1 });
    assert.deepEqual(survey.deliveredWithoutDueDateRowLines, { linked: 1, misc: 0 });
  });

  test("🔵 수리 건이 휴지통인 줄은 **갈래를 바꾸지 않고** 따로 세어진다", () => {
    assert.equal(survey.caseInTrashLines, 1);
    // 빼지 않았으므로 두 갈래의 합은 그대로 전체다.
    assert.equal(survey.linkedLines + survey.miscLines, survey.lines);
  });

  test("🔴 본보기는 **수리 건이 붙은 줄만** 담는다 — 기타건 줄은 가리킬 글자가 없다", () => {
    assert.deepEqual(
      survey.samples.differ.map((sample) => sample.intakeNumber),
      [CASE_NO.differDeliveredLater, CASE_NO.differDeliveredEarlier]
    );
    assert.deepEqual(
      survey.samples.noDueDateRow.map((sample) => sample.intakeNumber),
      [CASE_NO.deliveredOnly]
    );
    // 기타건 줄도 ⑪ 에 걸려 있지만(위 단언), 본보기에는 그 줄이 없다.
    assert.deepEqual(
      survey.samples.ambiguous.map((sample) => sample.intakeNumber),
      [CASE_NO.differDeliveredEarlier]
    );
  });

  test("🔴 본보기에는 **접수번호와 날짜·수뿐**이다 — 수리 건 열쇠도 납품자도 없다", () => {
    const sample = survey.samples.differ[0];
    assert.ok(sample);
    assert.deepEqual(Object.keys(sample).sort(), [
      "actualShipmentDate",
      "deliveredDate",
      "dueDateRowCount",
      "gapDays",
      "intakeNumber",
    ]);
  });
});

describe("🔴 갈래를 가르는 자 — `repair_case_id` 하나다", () => {
  test("수리 건이 안 붙은 줄은 기타건이고, 칸을 받지 않는다", () => {
    const verdict = classifyDeliveredDateLine(miscLine({ deliveredDate: "2026-03-01" }));
    assert.equal(verdict.kind, "misc");
    assert.equal(verdict.bucket, null);
    assert.equal(verdict.actualShipmentDate, null);
  });

  test("🔴 수리 건이 실려 왔다고 갈래가 바뀌지 않는다 — 말이 어긋난 줄로 센다", () => {
    const contradictory: SurveyOrderLine = {
      ...linkedLine(CASE_NO.same, { actualShipmentDate: "2026-05-05", deliveredDate: "2026-05-05" }),
      linkedToRepairCase: false,
    };
    const verdict = classifyDeliveredDateLine(contradictory);
    assert.equal(verdict.kind, "misc");
    assert.equal(verdict.bucket, null);
    // 🔴 실려 온 출하일을 쓰지 않는다 — 썼다면 여기서 "2026-05-05" 가 나온다.
    assert.equal(verdict.actualShipmentDate, null);
    assert.equal(verdict.contradictory, true);

    const survey = summarizeDeliveredDateSync([contradictory]);
    assert.equal(survey.contradictoryLines, 1);
    // 🔴 그 줄의 접수번호는 본보기로도 새 나가지 않는다.
    assert.deepEqual(survey.samples.differ, []);
    const message = deliveredDateSurveyMismatch(survey);
    assert.match(String(message), /조회가 샜습니다/);
  });

  test("🔴 수리 건을 **못 읽은** 줄은 「출하일이 없는 줄」이 아니다", () => {
    const unreadable: SurveyOrderLine = { ...linkedLine(CASE_NO.unreadable), repairCase: null };
    const verdict = classifyDeliveredDateLine(unreadable);
    assert.equal(verdict.kind, "linked");
    assert.equal(verdict.bucket, "case-unreadable");

    // 납품일이 적혀 있어도 `delivered-only` 로 접지 않는다 — 견줄 상대를 못 읽었다.
    const withDelivered: SurveyOrderLine = { ...unreadable, deliveredDate: "2026-06-06" };
    assert.equal(classifyDeliveredDateLine(withDelivered).bucket, "case-unreadable");

    const survey = summarizeDeliveredDateSync([unreadable, withDelivered]);
    assert.equal(survey.buckets["case-unreadable"], 2);
    assert.equal(survey.buckets["delivered-only"], 0);
    assert.equal(survey.shipmentDateLines, 0);
    // 🔴 그래도 칸의 합은 수리 건이 붙은 줄 수와 같다 — 검산이 통과해야 한다.
    assert.equal(deliveredDateSurveyMismatch(survey), null);
  });
});

describe("🔴 「다르다」의 경계 — 여유를 두지 않는다", () => {
  test("하루만 달라도 다름이고, 같은 날이면 같음이다", () => {
    const oneDay = classifyDeliveredDateLine(
      linkedLine(CASE_NO.differDeliveredLater, {
        actualShipmentDate: "2026-03-10",
        deliveredDate: "2026-03-11",
      })
    );
    const sameDay = classifyDeliveredDateLine(
      linkedLine(CASE_NO.same, {
        actualShipmentDate: "2026-03-10",
        deliveredDate: "2026-03-10",
      })
    );
    assert.equal(oneDay.bucket, "differ");
    assert.equal(oneDay.gapDays, 1);
    assert.equal(sameDay.bucket, "same");
    assert.equal(sameDay.gapDays, null);
  });

  test("한쪽만 적힌 줄은 다름이 아니다 — 덮일 값이 없다", () => {
    const deliveredOnly = classifyDeliveredDateLine(
      linkedLine(CASE_NO.deliveredOnly, { deliveredDate: "2026-06-06" })
    );
    const shipmentOnly = classifyDeliveredDateLine(
      linkedLine(CASE_NO.shipmentOnly, { actualShipmentDate: "2026-07-07" })
    );
    assert.equal(deliveredOnly.bucket, "delivered-only");
    assert.equal(shipmentOnly.bucket, "shipment-only");
    assert.equal(deliveredOnly.gapDays, null);
    assert.equal(shipmentOnly.gapDays, null);
  });

  test("🔴 공백만 적힌 날짜는 **없는 것**이다 — differ 가 아니라 shipment-only", () => {
    const verdict = classifyDeliveredDateLine(
      linkedLine(CASE_NO.shipmentOnly, {
        actualShipmentDate: "2026-07-07",
        deliveredDate: "   ",
      })
    );
    assert.equal(verdict.bucket, "shipment-only");
    assert.equal(verdict.deliveredDate, null);
  });

  test("앞뒤 공백은 떼고 견준다 — 그래도 같은 날이면 same 이다", () => {
    const verdict = classifyDeliveredDateLine(
      linkedLine(CASE_NO.same, {
        actualShipmentDate: " 2026-05-05 ",
        deliveredDate: "2026-05-05",
      })
    );
    assert.equal(verdict.bucket, "same");
    assert.equal(verdict.actualShipmentDate, "2026-05-05");
  });

  test("양쪽 다 비면 neither 다", () => {
    const verdict = classifyDeliveredDateLine(linkedLine(CASE_NO.neither));
    assert.equal(verdict.bucket, "neither");
  });
});

describe("🔴 벌어진 날수 — 부호와 달력", () => {
  function gap(deliveredDate: string, actualShipmentDate: string) {
    return classifyDeliveredDateLine(
      linkedLine(CASE_NO.differDeliveredLater, { actualShipmentDate, deliveredDate })
    );
  }

  test("🔴 양수는 **납품일이 더 늦다**(보낸 뒤에 받았다)", () => {
    assert.equal(gap("2026-03-12", "2026-03-10").gapDays, 2);
    assert.equal(gap("2026-03-08", "2026-03-10").gapDays, -2);
  });

  test("🔴 달과 해를 넘겨도 달력 날수로 센다 — 글자 빼기가 아니다", () => {
    assert.equal(gap("2026-01-02", "2025-12-31").gapDays, 2);
    assert.equal(gap("2026-03-01", "2026-02-27").gapDays, 2);
    // 윤년의 2월 29일을 건너뛰지 않는다.
    assert.equal(gap("2028-03-01", "2028-02-27").gapDays, 3);
  });

  test("🔴 날짜 꼴이 아니면 날수를 **지어내지 않는다** — 0 이 아니라 「못 쟀다」", () => {
    const verdict = gap("2026/03/12", "2026-03-10");
    assert.equal(verdict.bucket, "differ");
    assert.equal(verdict.gapDays, null);
    assert.equal(verdict.gapUnmeasured, true);

    const survey = summarizeDeliveredDateSync([
      linkedLine(CASE_NO.differDeliveredLater, {
        actualShipmentDate: "2026-03-10",
        deliveredDate: "2026/03/12",
      }),
    ]);
    assert.equal(survey.buckets.differ, 1);
    assert.equal(survey.differ.unmeasured, 1);
    assert.equal(survey.differ.deliveredLater, 0);
    assert.equal(survey.differ.deliveredEarlier, 0);
    // 🔴 잰 줄이 하나도 없으므로 날수는 null 이다 — 0 이면 「차이가 없다」로 읽힌다.
    assert.equal(survey.differ.gapDaysMaxAbs, null);
    assert.equal(survey.differ.gapDaysMedianAbs, null);
    // 🔴 못 잰 줄도 방향의 합에 들어가야 검산이 선다.
    assert.equal(deliveredDateSurveyMismatch(survey), null);
  });

  test("🔴 가운데쯤은 **아래쪽 가운데값**이다 — 없는 날수를 지어내지 않는다", () => {
    const fourLines = [1, 2, 3, 10].map((days, index) =>
      linkedLine(`D9902${String(index).padStart(2, "0")}`, {
        actualShipmentDate: "2026-03-10",
        // 🔵 10일을 더해도 달을 넘지 않는 날짜다.
        deliveredDate: `2026-03-${String(10 + days).padStart(2, "0")}`,
      })
    );
    const survey = summarizeDeliveredDateSync(fourLines);
    assert.equal(survey.buckets.differ, 4);
    // 짝수 개라 가운데가 둘(2일 · 3일)이다 — 평균 2.5 가 아니라 **작은 쪽**을 고른다.
    assert.equal(survey.differ.gapDaysMedianAbs, 2);
    assert.equal(survey.differ.gapDaysMaxAbs, 10);
    assert.equal(survey.differ.deliveredLater, 4);
  });

  test("가장 크게 벌어진 것은 **부호를 지운 뒤** 고른다", () => {
    const survey = summarizeDeliveredDateSync([
      linkedLine(CASE_NO.differDeliveredLater, {
        actualShipmentDate: "2026-03-10",
        deliveredDate: "2026-03-12",
      }),
      linkedLine(CASE_NO.differDeliveredEarlier, {
        actualShipmentDate: "2026-03-30",
        deliveredDate: "2026-03-10",
      }),
    ]);
    assert.equal(survey.differ.gapDaysMaxAbs, 20);
    assert.equal(survey.differ.gapDaysMin, -20);
    assert.equal(survey.differ.gapDaysMax, 2);
  });
});

describe("🔴 납기요청일 쪽 — 행에 달 수 있나", () => {
  test("날짜가 빈 행은 **행으로 세지 않는다**", () => {
    const verdict = classifyDeliveredDateLine(
      linkedLine(CASE_NO.deliveredOnly, {
        deliveredDate: "2026-06-06",
        dueDateRows: [due(" "), due("")],
      })
    );
    assert.equal(verdict.dueDateRowCount, 0);
    // 그러므로 이 줄은 ⑬(달 행이 없는데 납품일이 적힌 줄)이다.
    const survey = summarizeDeliveredDateSync([
      linkedLine(CASE_NO.deliveredOnly, {
        deliveredDate: "2026-06-06",
        dueDateRows: [due(" ")],
      }),
    ]);
    assert.deepEqual(survey.deliveredWithoutDueDateRowLines, { linked: 1, misc: 0 });
    assert.deepEqual(survey.dueDateRowBuckets.linked, { none: 1, one: 0, many: 0 });
  });

  test("🔴 비고는 **적혀 있나만** 센다 — 날짜가 빈 행의 비고는 세지 않는다", () => {
    const verdict = classifyDeliveredDateLine(
      linkedLine(CASE_NO.same, {
        dueDateRows: [due("2026-05-01", true), due("2026-05-02"), due("", true)],
      })
    );
    assert.equal(verdict.dueDateRowCount, 2);
    assert.equal(verdict.notedDueDateRows, 1);
  });

  test("⑪ 납품일이 그 행들 가운데 하나와 같은지를 가른다", () => {
    const matching = classifyDeliveredDateLine(
      linkedLine(CASE_NO.deliveredOnly, {
        deliveredDate: "2026-06-10",
        dueDateRows: [due("2026-06-01"), due("2026-06-10")],
      })
    );
    const notMatching = classifyDeliveredDateLine(
      linkedLine(CASE_NO.deliveredOnly, {
        deliveredDate: "2026-06-11",
        dueDateRows: [due("2026-06-01"), due("2026-06-10")],
      })
    );
    assert.equal(matching.deliveredDateMatchesADueDate, true);
    assert.equal(notMatching.deliveredDateMatchesADueDate, false);
  });

  test("🔴 납품일이 없으면 ⑪ 에 걸리지 않는다 — 달 값이 없다", () => {
    const survey = summarizeDeliveredDateSync([
      linkedLine(CASE_NO.neither, { dueDateRows: [due("2026-06-01"), due("2026-06-10")] }),
    ]);
    assert.deepEqual(survey.ambiguousTargetLines, { linked: 0, misc: 0 });
    assert.deepEqual(survey.dueDateRowBuckets.linked, { none: 0, one: 0, many: 1 });
  });

  test("🔴 수리 건이 붙었는데 2행 이상인 줄을 갈래별로 가른다 — 「분할 납품은 기타건뿐」의 반례", () => {
    const survey = summarizeDeliveredDateSync([
      linkedLine(CASE_NO.same, { dueDateRows: [due("2026-05-01"), due("2026-05-20")] }),
      miscLine({ dueDateRows: [due("2026-05-01"), due("2026-05-20")] }),
    ]);
    assert.equal(survey.dueDateRowBuckets.linked.many, 1);
    assert.equal(survey.dueDateRowBuckets.misc.many, 1);
  });
});

describe("🔴 ⑭ 한 수리 건에 내자 줄이 여럿", () => {
  test("같은 건의 두 줄을 묶고, 납품일이 서로 다르면 따로 센다", () => {
    const first = linkedLine(CASE_NO.same, { deliveredDate: "2026-05-05" });
    const second = linkedLine(CASE_NO.same, { deliveredDate: "2026-05-20" });
    const survey = summarizeDeliveredDateSync([first, second]);
    assert.equal(survey.multiLineCases, 1);
    assert.equal(survey.multiLineCaseLines, 2);
    assert.equal(survey.multiLineCasesWithDifferentDeliveredDates, 1);
    assert.deepEqual(
      survey.samples.multiLine.map((sample) => sample.deliveredDate),
      ["2026-05-05", "2026-05-20"]
    );
  });

  test("납품일이 같거나 한쪽이 비어 있으면 「서로 다른 건」이 아니다", () => {
    const sameDates = summarizeDeliveredDateSync([
      linkedLine(CASE_NO.same, { deliveredDate: "2026-05-05" }),
      linkedLine(CASE_NO.same, { deliveredDate: "2026-05-05" }),
    ]);
    const oneEmpty = summarizeDeliveredDateSync([
      linkedLine(CASE_NO.same, { deliveredDate: "2026-05-05" }),
      linkedLine(CASE_NO.same),
    ]);
    assert.equal(sameDates.multiLineCases, 1);
    assert.equal(sameDates.multiLineCasesWithDifferentDeliveredDates, 0);
    assert.equal(oneEmpty.multiLineCases, 1);
    assert.equal(oneEmpty.multiLineCasesWithDifferentDeliveredDates, 0);
  });

  test("🔴 묶는 열쇠는 **접수번호가 아니다** — 그 칸은 UNIQUE 가 아니다", () => {
    const firstCase = linkedLine(CASE_NO.same);
    const secondCase: SurveyOrderLine = {
      ...firstCase,
      // 접수번호는 같은데 **다른 수리 건**이다(옛 자료에 실제로 겹치는 값이 있다).
      repairCase: {
        key: "key-another",
        intakeNumber: CASE_NO.same,
        actualShipmentDate: null,
        isDeleted: false,
      },
    };
    const survey = summarizeDeliveredDateSync([firstCase, secondCase]);
    assert.equal(survey.multiLineCases, 0);
    assert.equal(survey.multiLineCaseLines, 0);
  });

  test("기타건 줄은 ⑭ 에 묶이지 않는다 — 묶을 건이 없다", () => {
    const survey = summarizeDeliveredDateSync([miscLine(), miscLine(), miscLine()]);
    assert.equal(survey.multiLineCases, 0);
    assert.equal(survey.miscLines, 3);
  });
});

describe("🔴 검산 — 어긋나면 그 자리에서 말한다", () => {
  const survey = summarizeDeliveredDateSync(SAMPLE_LINES);

  test("갈래의 합이 전체와 다르면 잡는다", () => {
    const broken = { ...survey, lines: survey.lines + 1 };
    assert.match(String(deliveredDateSurveyMismatch(broken)), /갈래 가르기가 샜습니다/);
  });

  test("칸의 합이 수리 건이 붙은 줄 수와 다르면 잡는다", () => {
    const broken = { ...survey, buckets: { ...survey.buckets, same: survey.buckets.same + 1 } };
    assert.match(String(deliveredDateSurveyMismatch(broken)), /칸의 합/);
  });

  test("방향의 합이 「다른 줄」 수와 다르면 잡는다", () => {
    const broken = {
      ...survey,
      differ: { ...survey.differ, deliveredLater: survey.differ.deliveredLater + 1 },
    };
    assert.match(String(deliveredDateSurveyMismatch(broken)), /방향의 합/);
  });

  test("납기요청일 행 분포의 합이 그 갈래의 줄 수와 다르면 잡는다 — 갈래마다 본다", () => {
    const brokenLinked = {
      ...survey,
      dueDateRowBuckets: {
        ...survey.dueDateRowBuckets,
        linked: { ...survey.dueDateRowBuckets.linked, none: 99 },
      },
    };
    const brokenMisc = {
      ...survey,
      dueDateRowBuckets: {
        ...survey.dueDateRowBuckets,
        misc: { ...survey.dueDateRowBuckets.misc, many: 0 },
      },
    };
    assert.match(String(deliveredDateSurveyMismatch(brokenLinked)), /행 분포의 합/);
    assert.match(String(deliveredDateSurveyMismatch(brokenMisc)), /행 분포의 합/);
  });

  test("말이 어긋난 줄이 있으면 잡는다", () => {
    const broken = { ...survey, contradictoryLines: 1 };
    assert.match(String(deliveredDateSurveyMismatch(broken)), /조회가 샜습니다/);
  });

  test("한 줄도 없으면 전부 0 이고 **날수는 null** 이며 검산도 통과한다", () => {
    const empty = summarizeDeliveredDateSync([]);
    assert.equal(empty.lines, 0);
    assert.equal(empty.linkedLines, 0);
    assert.equal(empty.miscLines, 0);
    assert.equal(empty.differ.gapDaysMaxAbs, null);
    assert.equal(empty.differ.gapDaysMedianAbs, null);
    assert.equal(empty.differ.gapDaysMin, null);
    assert.equal(empty.differ.gapDaysMax, null);
    assert.deepEqual(empty.samples.differ, []);
    assert.equal(deliveredDateSurveyMismatch(empty), null);
  });
});

describe("본보기 — 차례와 상한", () => {
  test("들어온 차례대로 상한만큼만 담는다", () => {
    const many = Array.from({ length: 5 }, (_unused, index) =>
      linkedLine(`D9903${String(index + 1).padStart(2, "0")}`, {
        actualShipmentDate: "2026-03-10",
        deliveredDate: "2026-03-12",
      })
    );
    const limited = summarizeDeliveredDateSync(many, 2);
    assert.equal(limited.buckets.differ, 5);
    assert.deepEqual(
      limited.samples.differ.map((sample) => sample.intakeNumber),
      ["D990301", "D990302"]
    );
  });

  test("본보기에 벌어진 날수와 납기요청일 행 수가 함께 담긴다 — 눈으로 확인할 거리", () => {
    const survey = summarizeDeliveredDateSync([
      linkedLine(CASE_NO.differDeliveredLater, {
        actualShipmentDate: "2026-03-10",
        deliveredDate: "2026-03-12",
        dueDateRows: [due("2026-03-01"), due("2026-03-05")],
      }),
    ]);
    assert.deepEqual(survey.samples.differ, [
      {
        intakeNumber: CASE_NO.differDeliveredLater,
        deliveredDate: "2026-03-12",
        actualShipmentDate: "2026-03-10",
        gapDays: 2,
        dueDateRowCount: 2,
      },
    ]);
  });
});
