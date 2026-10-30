import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  bucketTotalMismatch,
  classifyRequestedDueDates,
  summarizeRequestedDueDateSync,
  type SurveyCase,
} from "./requested-due-date-sync-survey";

/**
 * ============================================================================
 * 납기일을 묶기 전에 **세는 규칙**의 시험 (2026-10-30)
 * ============================================================================
 * 이 셈이 틀리면 **설계 결정이 틀린다** — 「내자 납기요청일과 고객 요청 납기일을 묶어도
 * 되는가」를 그 수 하나로 정하고, 묶는 순간 다르게 적힌 값은 덮여서 돌아오지 않는다.
 * 그런데 그 수는 운영 자료를 봐야 나오는 수라 **아무도 눈으로 검산할 수 없다.** 그래서
 * 셈만 떼어 값으로 못 박는다(`scripts/lib/part-name-overlap.test.ts` 와 같은 이유).
 *
 * ── 🔴 여기서 지키는 경계 ───────────────────────────────────────────────
 *   ① **한쪽만 적힌 건은 「다름」이 아니다.** 그 건은 지금 상대 값을 빌려 그리고 있고,
 *      묶어도 덮일 값이 없다. 이 선이 흐려지면 ③ 이 부풀어 「덮일 건이 이만큼이나
 *      된다」는 잘못된 그림이 나온다.
 *   ② **빈 값·공백만 적힌 값**은 화면과 같은 자(`foldBlankToNull`)로 접는다.
 *   ③ **같은 날짜가 두 행**이면 날짜는 한 가지지만 **행은 둘**이다 — 묶을 때 사라지는
 *      것은 가짓수가 아니라 행이다(비고가 거기 달려 있다).
 *   ④ 방향 꼬리표는 **가장 이른 하루** 기준이다 — 내자 날짜가 여럿이면 그 꼬리표가
 *      묶음 전체를 말하지 못하고, 그 사실이 따로 세어져 나와야 한다.
 *   ⑤ ⑦(거절당하는 건)의 잣대는 **수리 건 저장이 쓰는 그 자**와 같아야 한다 —
 *      `mutations/repair-cases.ts` 849줄이 `!isNotEarlierThan(due, receivedAt)` 일 때
 *      거절하므로 🔴 **인수일과 같은 날은 거절이 아니다.** 이 경계가 뒤집히면 인수일
 *      당일에 납기를 잡은 건이 통째로 ⑦ 에 들어와, 다음 조각이 없는 문제를 푼다.
 *
 * ── 🔴 이름·번호는 전부 **지어낸 것**이다 ───────────────────────────────
 * 실제 접수번호·고객사를 시험에 적지 않는다. 한 번 적힌 글자는 이력에 영영 남는다.
 * ============================================================================
 */

/** 지어낸 접수번호. 규칙(`D` + 연 2자리 + 월 2자리 + 일련 2자리)만 흉내 낸 값이다. */
const CASE_NO = {
  differDomesticLater: "D990101",
  differCaseLater: "D990102",
  differSameEarliest: "D990103",
  caseOnly: "D990104",
  domesticOnly: "D990105",
  same: "D990106",
  neither: "D990107",
} as const;

function due(dueDate: string, hasNote = false) {
  return { dueDate, hasNote };
}

/**
 * 표본의 인수일. 🔵 아래 날짜들보다 **넉넉히 앞**이라, ⑦(인수일보다 이른 날짜)을 재는
 * 묶음 말고는 ⑦ 이 섞이지 않는다 — 다른 단언이 ⑦ 때문에 흔들리지 않게 하려는 값이다.
 */
const RECEIVED = "2025-01-10";

/**
 * 일곱 건짜리 표본. **다섯 칸과 세 방향이 전부 한 번씩 나온다** — 아래 첫 묶음이 그것을
 * 먼저 단언한다(표본이 한쪽으로 쏠려 있으면 나머지 단언이 공짜로 통과한다).
 */
const SAMPLE_CASES: SurveyCase[] = [
  {
    // 내자가 더 늦다 — 발주를 미룬 쪽
    intakeNumber: CASE_NO.differDomesticLater,
    customerRequestedDueDate: "2026-03-01",
    receivedAt: RECEIVED,
    lines: [{ dueDates: [due("2026-03-20")] }],
  },
  {
    // 수리 건이 더 늦다 — 고객이 당긴 쪽일 수 있다
    intakeNumber: CASE_NO.differCaseLater,
    customerRequestedDueDate: "2026-03-01",
    receivedAt: RECEIVED,
    lines: [{ dueDates: [due("2026-02-10")] }],
  },
  {
    // 가장 이른 하루는 같은데 내자에 날짜가 더 있다(분할 납품)
    intakeNumber: CASE_NO.differSameEarliest,
    customerRequestedDueDate: "2026-03-01",
    receivedAt: RECEIVED,
    lines: [{ dueDates: [due("2026-03-01", true), due("2026-04-15", true)] }],
  },
  {
    // 수리 건에만 적혔다 — 붙은 내자 줄이 지금 그 값을 빌려 그린다
    intakeNumber: CASE_NO.caseOnly,
    customerRequestedDueDate: "2026-03-01",
    receivedAt: RECEIVED,
    lines: [{ dueDates: [] }],
  },
  {
    // 내자에만 적혔다 — 수리 건 화면이 지금 그 값을 빌려 그린다
    intakeNumber: CASE_NO.domesticOnly,
    customerRequestedDueDate: null,
    receivedAt: RECEIVED,
    lines: [{ dueDates: [due("2026-05-05")] }],
  },
  {
    // 양쪽 다 적혔고 같다
    intakeNumber: CASE_NO.same,
    customerRequestedDueDate: "2026-06-01",
    receivedAt: RECEIVED,
    lines: [{ dueDates: [due("2026-06-01")] }],
  },
  {
    // 양쪽 다 비었다
    intakeNumber: CASE_NO.neither,
    customerRequestedDueDate: null,
    receivedAt: RECEIVED,
    lines: [{ dueDates: [] }],
  },
];

describe("무엇을 재고 있는가 — 표본이 비어 공짜로 통과하지 않게", () => {
  const survey = summarizeRequestedDueDateSync(SAMPLE_CASES);

  test("🔴 다섯 칸이 전부 한 번씩 나온다 — 한쪽으로 쏠린 표본이 아니다", () => {
    assert.equal(survey.cases, 7);
    assert.deepEqual(survey.buckets, {
      differ: 3,
      "case-only": 1,
      "domestic-only": 1,
      same: 1,
      neither: 1,
    });
  });

  test("🔴 세 방향이 전부 한 번씩 나온다", () => {
    assert.deepEqual(survey.directions, {
      "domestic-later": 1,
      "case-later": 1,
      "same-earliest-plus-more": 1,
    });
  });

  test("🔴 칸의 합이 전체 건수와 같다(검산이 실제로 돈다)", () => {
    assert.equal(bucketTotalMismatch(survey), null);
  });

  test("🔴 검산이 어긋남을 실제로 잡는다", () => {
    const broken = { ...survey, cases: survey.cases + 1 };
    const message = bucketTotalMismatch(broken);
    assert.notEqual(message, null);
    assert.match(String(message), /셈이 샜습니다/);
  });
});

describe("🔴 「다르다」의 경계 — 한쪽만 적힌 건은 다름이 아니다", () => {
  test("수리 건에만 적혔으면 case-only 다(differ 가 아니다)", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.caseOnly,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [] }],
    });
    assert.equal(verdict.bucket, "case-only");
    assert.equal(verdict.direction, null);
    assert.deepEqual(verdict.domesticDueDates, []);
  });

  test("내자에만 적혔으면 domestic-only 다(differ 가 아니다)", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.domesticOnly,
      customerRequestedDueDate: null,
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-05-05")] }],
    });
    assert.equal(verdict.bucket, "domestic-only");
    assert.equal(verdict.direction, null);
  });

  test("내자 줄은 있는데 날짜가 하나도 없고 수리 건도 비었으면 neither 다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.neither,
      customerRequestedDueDate: null,
      receivedAt: RECEIVED,
      lines: [{ dueDates: [] }, { dueDates: [] }],
    });
    assert.equal(verdict.bucket, "neither");
    assert.equal(verdict.lineCount, 2);
    assert.equal(verdict.linesWithoutDueDate, 2);
    // 빌려 올 값이 없으므로 「빌려 그리는 줄」은 0 이다.
    assert.equal(verdict.linesBorrowingFromCase, 0);
  });

  test("🔴 공백만 적힌 수리 건 날짜는 **없는 것**이다 — differ 가 아니라 domestic-only", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.domesticOnly,
      customerRequestedDueDate: "   ",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-05-05")] }],
    });
    assert.equal(verdict.bucket, "domestic-only");
    assert.equal(verdict.caseDueDate, null);
  });

  test("🔴 빈 글자로 들어온 내자 날짜 행은 **행으로 세지 않는다**", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.caseOnly,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due(" "), due("")] }],
    });
    assert.equal(verdict.bucket, "case-only");
    assert.deepEqual(verdict.domesticDueDates, []);
    assert.equal(verdict.multiDueDateLines, 0);
    assert.equal(verdict.linesWithoutDueDate, 1);
    assert.equal(verdict.linesBorrowingFromCase, 1);
  });

  test("수리 건 날짜 앞뒤 공백은 떼고 견준다 — 그래도 같은 날이면 same 이다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.same,
      customerRequestedDueDate: " 2026-06-01 ",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-06-01")] }],
    });
    assert.equal(verdict.bucket, "same");
    assert.equal(verdict.caseDueDate, "2026-06-01");
  });
});

describe("🔴 날짜가 여럿일 때", () => {
  test("같은 날짜가 두 행이면 **날짜는 한 가지, 행은 둘** — 칸은 same 이다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.same,
      customerRequestedDueDate: "2026-06-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-06-01", true), due("2026-06-01")] }],
    });
    assert.equal(verdict.bucket, "same");
    assert.deepEqual(verdict.domesticDueDates, ["2026-06-01"]);
    // 🔴 묶어서 날짜를 하나로 만들면 **행 하나와 그 비고가 사라진다.** 칸이 same 이라고
    //    잃을 것이 없다는 뜻이 아니다 — 그래서 행을 따로 센다.
    assert.equal(verdict.multiDueDateLines, 1);
    assert.equal(verdict.multiDistinctDueDateLines, 0);
    assert.equal(verdict.notedDueDateRows, 1);
  });

  test("서로 다른 날짜가 둘이면 가장 이른 하루가 같아도 differ 다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differSameEarliest,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-03-01"), due("2026-04-15")] }],
    });
    assert.equal(verdict.bucket, "differ");
    assert.equal(verdict.direction, "same-earliest-plus-more");
    assert.equal(verdict.multiDistinctDueDateLines, 1);
    assert.equal(verdict.linesDifferingFromCase, 1);
  });

  test("여러 줄에 걸친 날짜를 **통틀어** 모으고 중복은 한 가지로 센다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differCaseLater,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [
        { dueDates: [due("2026-02-10")] },
        { dueDates: [due("2026-02-10"), due("2026-01-05")] },
      ],
    });
    assert.deepEqual(verdict.domesticDueDates, ["2026-01-05", "2026-02-10"]);
    assert.equal(verdict.lineCount, 2);
    assert.equal(verdict.bucket, "differ");
    // 가장 이른 하루(01-05)가 수리 건(03-01)보다 이르다 → 수리 건이 더 늦다
    assert.equal(verdict.direction, "case-later");
    // 두 줄 다 수리 건 날짜와 다르다 → 묶으면 둘 다 덮인다
    assert.equal(verdict.linesDifferingFromCase, 2);
  });

  test("한 줄은 같고 한 줄은 다르면 **다른 줄만** 덮일 줄로 센다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differDomesticLater,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-03-01")] }, { dueDates: [due("2026-03-20")] }],
    });
    assert.equal(verdict.bucket, "differ");
    assert.equal(verdict.direction, "same-earliest-plus-more");
    assert.equal(verdict.linesDifferingFromCase, 1);
  });
});

describe("🔴 방향 — 가장 이른 하루로 가른다", () => {
  test("내자의 가장 이른 하루가 늦으면 domestic-later", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differDomesticLater,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-03-20"), due("2026-04-01")] }],
    });
    assert.equal(verdict.direction, "domestic-later");
  });

  test("수리 건 날짜가 늦으면 case-later", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differCaseLater,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-02-10")] }],
    });
    assert.equal(verdict.direction, "case-later");
  });

  test("🔴 하루만 달라도 방향이 갈린다 — 같은 날은 differ 가 아니다", () => {
    const earlier = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differCaseLater,
      customerRequestedDueDate: "2026-03-02",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-03-01")] }],
    });
    const later = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differDomesticLater,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-03-02")] }],
    });
    const equal = classifyRequestedDueDates({
      intakeNumber: CASE_NO.same,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-03-01")] }],
    });
    assert.equal(earlier.direction, "case-later");
    assert.equal(later.direction, "domestic-later");
    assert.equal(equal.bucket, "same");
    assert.equal(equal.direction, null);
  });

  test("🔴 해를 넘겨도 날짜순으로 센다(글자 길이가 같은 형식이라 사전순 = 날짜순)", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differCaseLater,
      customerRequestedDueDate: "2026-01-05",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2025-12-31")] }],
    });
    assert.equal(verdict.direction, "case-later");
  });
});

describe("지금 빌려 그리고 있는 것 · 묶으면 덮일 것", () => {
  test("날짜가 없는 줄은 수리 건 날짜가 있을 때만 「빌려 그리는 줄」이다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.caseOnly,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [] }, { dueDates: [] }, { dueDates: [due("2026-03-01")] }],
    });
    assert.equal(verdict.lineCount, 3);
    assert.equal(verdict.linesWithoutDueDate, 2);
    assert.equal(verdict.linesBorrowingFromCase, 2);
    // 날짜가 적힌 그 한 줄은 수리 건과 같으므로 덮일 줄이 아니다.
    assert.equal(verdict.linesDifferingFromCase, 0);
    assert.equal(verdict.bucket, "same");
  });

  test("수리 건에 날짜가 없으면 덮일 줄도 0 이다(덮을 값이 없다)", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.domesticOnly,
      customerRequestedDueDate: null,
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-05-05")] }, { dueDates: [due("2026-06-06")] }],
    });
    assert.equal(verdict.linesDifferingFromCase, 0);
    assert.equal(verdict.bucket, "domestic-only");
  });
});

describe("합계와 본보기", () => {
  const survey = summarizeRequestedDueDateSync([
    ...SAMPLE_CASES,
    {
      // 줄이 둘 + 한 줄에 날짜가 둘 — ①·② 가 함께 서는 건
      intakeNumber: "D990108",
      customerRequestedDueDate: "2026-07-01",
      receivedAt: RECEIVED,
      lines: [
        { dueDates: [due("2026-07-01"), due("2026-08-01", true)] },
        { dueDates: [due("2026-09-01")] },
      ],
    },
  ]);

  test("줄 수 · 날짜 행 수 · 비고가 적힌 행 수를 따로 센다", () => {
    assert.equal(survey.cases, 8);
    assert.equal(survey.lines, 9);
    assert.equal(survey.dueDateRows, 9);
    assert.equal(survey.notedDueDateRows, 3);
  });

  test("① 줄이 여럿인 건과 그 줄 수", () => {
    assert.equal(survey.multiLineCases, 1);
    assert.equal(survey.multiLineLines, 2);
    assert.deepEqual(
      survey.samples.multiLine.map((sample) => sample.intakeNumber),
      ["D990108"]
    );
  });

  test("② 날짜 행이 여럿인 줄 · 그런 줄을 가진 건", () => {
    assert.equal(survey.multiDueDateLines, 2);
    assert.equal(survey.multiDistinctDueDateLines, 2);
    assert.equal(survey.multiDueDateCases, 2);
    assert.deepEqual(
      survey.samples.multiDueDate.map((sample) => sample.intakeNumber),
      [CASE_NO.differSameEarliest, "D990108"]
    );
  });

  test("🔴 ③ 가운데 내자 날짜가 여럿인 건을 따로 센다 — 방향 꼬리표가 전부를 말하지 못한다", () => {
    assert.equal(survey.buckets.differ, 4);
    assert.equal(survey.differWithMultipleDomesticDates, 2);
  });

  test("🔴 본보기에는 **접수번호와 날짜뿐**이다 — 고객사·L/N·S/N 이 들어올 자리가 없다", () => {
    const sample = survey.samples.differ[0];
    assert.ok(sample);
    assert.deepEqual(Object.keys(sample).sort(), [
      "caseDueDate",
      "domesticDueDates",
      "intakeNumber",
      "receivedAt",
    ]);
  });

  test("본보기는 들어온 차례대로 상한만큼만 담는다", () => {
    const many = Array.from({ length: 5 }, (_unused, index) => ({
      intakeNumber: `D9902${String(index + 1).padStart(2, "0")}`,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED,
      lines: [{ dueDates: [due("2026-04-01")] }],
    }));
    const limited = summarizeRequestedDueDateSync(many, 2);
    assert.equal(limited.buckets.differ, 5);
    assert.deepEqual(
      limited.samples.differ.map((sample) => sample.intakeNumber),
      ["D990201", "D990202"]
    );
  });

  test("한 건도 없으면 전부 0 이고 검산도 통과한다", () => {
    const empty = summarizeRequestedDueDateSync([]);
    assert.equal(empty.cases, 0);
    assert.equal(empty.lines, 0);
    assert.equal(bucketTotalMismatch(empty), null);
    assert.deepEqual(empty.samples.differ, []);
    assert.equal(empty.blockedByReceivedAt, 0);
    assert.equal(empty.receivedAtUnknown, 0);
  });
});

/**
 * ============================================================================
 * ⑦ — 「내자 → 수리 건」이 **거절당하는 건**
 * ============================================================================
 * 🔴 잣대는 `mutations/repair-cases.ts` 849줄 그대로다:
 *
 *     if (due !== null && !isNotEarlierThan(due, effectiveReceivedAt)) → 거절
 *
 * 그 함수가 `a >= b` 이므로 **인수일과 같은 날은 거절이 아니다.** 아래 첫 시험이
 * 그 경계 셋(하루 전 · 같은 날 · 하루 뒤)을 나란히 세워 놓는다 — `>` 가 `>=` 로
 * 뒤집히면 가운데가 깨진다.
 * ============================================================================
 */
describe("🔴 ⑦ 인수일보다 이른 내자 날짜 — 묶으면 저장이 거절된다", () => {
  const RECEIVED_AT = "2026-03-10";

  function blocked(dueDate: string) {
    return classifyRequestedDueDates({
      intakeNumber: CASE_NO.domesticOnly,
      customerRequestedDueDate: null,
      receivedAt: RECEIVED_AT,
      lines: [{ dueDates: [due(dueDate)] }],
    });
  }

  test("🔴 경계 — 하루 전은 막히고, **같은 날은 막히지 않고**, 하루 뒤도 막히지 않는다", () => {
    assert.equal(blocked("2026-03-09").blockedByReceivedAt, true);
    assert.equal(blocked("2026-03-10").blockedByReceivedAt, false);
    assert.equal(blocked("2026-03-11").blockedByReceivedAt, false);
  });

  test("막히는 날짜의 가짓수를 센다 — 하나라도 이르면 막힌다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.differCaseLater,
      customerRequestedDueDate: "2026-04-01",
      receivedAt: RECEIVED_AT,
      lines: [{ dueDates: [due("2026-03-01"), due("2026-03-10"), due("2026-05-01")] }],
    });
    assert.equal(verdict.blockedByReceivedAt, true);
    assert.equal(verdict.datesEarlierThanReceivedAt, 1);
    // 전부 이른 것은 아니다 — 다른 날짜를 미는 설계라면 피할 수 있는 건이다.
    assert.equal(verdict.allDatesEarlierThanReceivedAt, false);
  });

  test("🔴 전부 이르면 어느 날짜를 골라도 막힌다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.domesticOnly,
      customerRequestedDueDate: null,
      receivedAt: RECEIVED_AT,
      lines: [{ dueDates: [due("2026-03-01")] }, { dueDates: [due("2026-02-20")] }],
    });
    assert.equal(verdict.datesEarlierThanReceivedAt, 2);
    assert.equal(verdict.allDatesEarlierThanReceivedAt, true);
  });

  test("내자 날짜가 하나도 없으면 ⑦ 이 아니다 — 밀 값이 없다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.caseOnly,
      customerRequestedDueDate: "2026-03-01",
      receivedAt: RECEIVED_AT,
      lines: [{ dueDates: [] }],
    });
    assert.equal(verdict.blockedByReceivedAt, false);
    assert.equal(verdict.allDatesEarlierThanReceivedAt, false);
  });

  test("🔴 인수일을 못 읽으면 ⑦ 로도 아닌 것으로도 세지 않는다 — 「못 쟀다」로 센다", () => {
    const verdict = classifyRequestedDueDates({
      intakeNumber: CASE_NO.domesticOnly,
      customerRequestedDueDate: null,
      receivedAt: "   ",
      lines: [{ dueDates: [due("2020-01-01")] }],
    });
    assert.equal(verdict.receivedAt, null);
    assert.equal(verdict.blockedByReceivedAt, false);

    const survey = summarizeRequestedDueDateSync([
      {
        intakeNumber: CASE_NO.domesticOnly,
        customerRequestedDueDate: null,
        receivedAt: "   ",
        lines: [{ dueDates: [due("2020-01-01")] }],
      },
    ]);
    assert.equal(survey.receivedAtUnknown, 1);
    assert.equal(survey.blockedByReceivedAt, 0);
  });

  test("🔴 칸별로 갈라 센다 — ③ 이면서 ⑦ 인 건이 가장 까다롭다", () => {
    const survey = summarizeRequestedDueDateSync([
      {
        // ③ 다름 + ⑦ 막힘 — 덮을 값도 있고 거절도 당한다
        intakeNumber: CASE_NO.differCaseLater,
        customerRequestedDueDate: "2026-04-01",
        receivedAt: RECEIVED_AT,
        lines: [{ dueDates: [due("2026-03-01")] }],
      },
      {
        // ④ 내자에만 적힘 + ⑦ 막힘 — 지금 잘 보이던 건이 묶는 순간 오류가 된다
        intakeNumber: CASE_NO.domesticOnly,
        customerRequestedDueDate: null,
        receivedAt: RECEIVED_AT,
        lines: [{ dueDates: [due("2026-02-01")] }],
      },
      {
        // ⑤ 같음 + ⑦ 막힘 — 저장된 고객 요청 납기일 자체가 잣대를 어기고 있는 건이다
        intakeNumber: CASE_NO.same,
        customerRequestedDueDate: "2026-03-05",
        receivedAt: RECEIVED_AT,
        lines: [{ dueDates: [due("2026-03-05")] }],
      },
      {
        // 막히지 않는 건 — 같은 날이라 통과한다
        intakeNumber: CASE_NO.differDomesticLater,
        customerRequestedDueDate: "2026-03-20",
        receivedAt: RECEIVED_AT,
        lines: [{ dueDates: [due("2026-03-10")] }],
      },
    ]);

    assert.equal(survey.blockedByReceivedAt, 3);
    assert.equal(survey.blockedAllDates, 3);
    assert.deepEqual(survey.blockedByBucket, {
      differ: 1,
      "case-only": 0,
      "domestic-only": 1,
      same: 1,
      neither: 0,
    });
    assert.equal(survey.receivedAtUnknown, 0);
    // 본보기에는 인수일이 함께 담긴다 — 사람이 「정말 이른가」를 눈으로 본다.
    assert.deepEqual(
      survey.samples.blocked.map((sample) => `${sample.intakeNumber} ${sample.receivedAt}`),
      [
        `${CASE_NO.differCaseLater} ${RECEIVED_AT}`,
        `${CASE_NO.domesticOnly} ${RECEIVED_AT}`,
        `${CASE_NO.same} ${RECEIVED_AT}`,
      ]
    );
  });
});
